/**
 * Payment tools - query, validate, execute
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpSuccess, mcpError, formatUSDC } from '../response';
import { getWallet, walletExists } from '../keystore';
import { createClient, makeRequest, queryEndpoint, type QueryResult } from '../x402/client';
import { extractV1Schema } from '../x402/protocol';
import { getChainConfig, getChainName, toCaip2 } from '../networks';
import { getUSDCBalance, hasSufficientBalance } from '../balance';

// Schema accepts both v1 (maxAmountRequired) and v2 (amount) field names
const PaymentRequirementsSchema = z
  .object({
    scheme: z.string(),
    network: z.string(),
    amount: z.string().optional(),
    maxAmountRequired: z.string().optional(),
    asset: z.string(),
    payTo: z.string(),
    maxTimeoutSeconds: z.number(),
    extra: z.record(z.unknown()).optional(),
  })
  .refine((data) => data.amount || data.maxAmountRequired, {
    message: 'Either amount (v2) or maxAmountRequired (v1) must be provided',
  })
  .transform((data) => ({
    ...data,
    amount: data.amount ?? data.maxAmountRequired!,
  }));

export function registerPaymentTools(server: McpServer): void {
  // query_endpoint - probe for pricing without payment
  server.tool(
    'query_endpoint',
    'Probe an x402-protected endpoint to get pricing and requirements without payment.',
    {
      url: z.string().url().describe('The endpoint URL to probe'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
      body: z.unknown().optional().describe('Request body for POST/PUT/PATCH'),
    },
    async ({ url, method, body }) => {
      try {
        const result = await queryEndpoint(url, { method, body });

        if (!result.success) {
          return mcpError(result.error || 'Failed to query endpoint', {
            statusCode: result.statusCode,
            parseErrors: result.parseErrors,
            rawHeaders: result.rawHeaders,
            rawBody: result.rawBody,
          });
        }

        if (result.statusCode !== 402) {
          return mcpSuccess({
            isX402Endpoint: false,
            statusCode: result.statusCode,
            message: 'This endpoint does not require payment',
            rawHeaders: result.rawHeaders,
          });
        }

        const pr = result.paymentRequired!;
        const requirements = pr.accepts.map((req) => ({
          scheme: req.scheme,
          network: req.network,
          networkName: getChainName(req.network),
          price: formatUSDC(BigInt(req.amount)),
          priceRaw: req.amount,
          asset: req.asset,
          payTo: req.payTo,
          maxTimeoutSeconds: req.maxTimeoutSeconds,
          extra: req.extra,
        }));

        const response: Record<string, unknown> = {
          isX402Endpoint: true,
          x402Version: pr.x402Version,
          requirements,
        };

        // Resource info (v2)
        if (pr.resource) {
          response.resource = pr.resource;
        }

        // Bazaar extension (v2)
        if (pr.extensions?.bazaar) {
          const bazaar = pr.extensions.bazaar as Record<string, unknown>;
          response.bazaar = { info: bazaar.info, schema: bazaar.schema, examples: bazaar.examples, hasBazaarExtension: true };
        } else if (pr.x402Version === 1 && result.rawBody) {
          // V1 - extract from outputSchema
          const v1Body = result.rawBody as { accepts?: unknown[] };
          const firstAccept = v1Body.accepts?.[0];
          if (firstAccept) {
            const discoveryInfo = extractV1Schema(firstAccept);
            if (discoveryInfo) {
              response.bazaar = { info: discoveryInfo, schema: null, hasBazaarExtension: true, sourceVersion: 1 };
            }
          }
        }

        // Sign-In-With-X extension (v2)
        if (pr.extensions?.['sign-in-with-x']) {
          const siwx = pr.extensions['sign-in-with-x'] as { info?: Record<string, unknown>; schema?: Record<string, unknown> };
          const info = siwx.info || {};
          const requiredFields = ['domain', 'uri', 'version', 'chainId', 'nonce', 'issuedAt'];
          const missingFields = requiredFields.filter((f) => !info[f]);
          const validationErrors: string[] = [];

          if (!siwx.info) validationErrors.push('Missing "info" object');
          else if (missingFields.length > 0) validationErrors.push(`Missing: ${missingFields.join(', ')}`);
          if (!siwx.schema) validationErrors.push('Missing "schema" object');

          response.signInWithX = {
            required: true,
            valid: validationErrors.length === 0,
            validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
            info: siwx.info,
            schema: siwx.schema,
            usage: 'Use create_siwe_proof or fetch_with_siwe tools to authenticate',
          };
        }

        if (pr.error) response.serverError = pr.error;

        return mcpSuccess(response);
      } catch (err) {
        return mcpError(err, { tool: 'query_endpoint', url });
      }
    }
  );

  // validate_payment - pre-flight check
  server.tool(
    'validate_payment',
    'Pre-flight check if a payment would succeed. Validates wallet, network, and balance.',
    {
      requirements: PaymentRequirementsSchema.describe('Payment requirements from query_endpoint'),
    },
    async ({ requirements }) => {
      try {
        const errors: string[] = [];
        const warnings: string[] = [];
        const checks: Record<string, boolean> = {};

        // Check wallet exists (without creating)
        const hasWallet = await walletExists();
        checks.walletExists = hasWallet;
        if (!hasWallet) {
          errors.push('No wallet found. Run check_balance first to create a wallet.');
        }

        // Check network support
        const caip2 = toCaip2(requirements.network);
        const chainConfig = getChainConfig(caip2);
        checks.networkSupported = !!chainConfig;
        if (!chainConfig) {
          errors.push(`Network not supported: ${requirements.network}`);
        }

        // Check scheme support
        checks.schemeSupported = requirements.scheme === 'exact';
        if (requirements.scheme !== 'exact') {
          errors.push(`Scheme not supported: ${requirements.scheme}. Only 'exact' is supported.`);
        }

        // Can't check balance without wallet or network
        if (!hasWallet || !chainConfig) {
          return mcpSuccess({ valid: false, readyToExecute: false, checks, errors, warnings });
        }

        // Get wallet for balance check
        const { address } = await getWallet();

        // Check balance
        let balanceResult;
        try {
          balanceResult = await hasSufficientBalance(address, requirements.amount, caip2);
          checks.sufficientBalance = balanceResult.sufficient;
          if (!balanceResult.sufficient) {
            errors.push(
              `Insufficient balance. Required: ${formatUSDC(balanceResult.requiredAmount)}, ` +
                `Available: ${formatUSDC(balanceResult.currentBalance)}`
            );
          }
        } catch (err) {
          checks.sufficientBalance = false;
          errors.push(`Failed to check balance: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Check asset
        const expectedUsdc = chainConfig.usdcAddress.toLowerCase();
        checks.assetIsUSDC = expectedUsdc === requirements.asset.toLowerCase();
        if (!checks.assetIsUSDC) {
          warnings.push(`Asset may not be USDC. Expected: ${expectedUsdc}, Got: ${requirements.asset}`);
        }

        checks.signatureCapable = true;

        const valid = errors.length === 0;
        const response: Record<string, unknown> = {
          valid,
          readyToExecute: valid,
          checks,
          network: { requested: requirements.network, resolved: caip2, name: getChainName(caip2), supported: true },
        };

        if (balanceResult) {
          response.balance = {
            current: formatUSDC(balanceResult.currentBalance),
            required: formatUSDC(balanceResult.requiredAmount),
            sufficient: balanceResult.sufficient,
          };
        }

        if (errors.length > 0) response.errors = errors;
        if (warnings.length > 0) response.warnings = warnings;

        return mcpSuccess(response);
      } catch (err) {
        return mcpError(err, { tool: 'validate_payment' });
      }
    }
  );

  // execute_call - make paid request
  server.tool(
    'execute_call',
    'Make a paid request to an x402-protected endpoint. Handles 402 payment flow automatically.',
    {
      url: z.string().url().describe('The endpoint URL'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
      body: z.unknown().optional().describe('Request body for POST/PUT/PATCH'),
      headers: z.record(z.string()).optional().describe('Additional headers'),
    },
    async ({ url, method, body, headers }) => {
      try {
        const { account, address } = await getWallet();
        const client = createClient(account);
        const result = await makeRequest(client, url, { method, body, headers });

        if (!result.success) {
          const errorResponse: Record<string, unknown> = {
            success: false,
            statusCode: result.statusCode,
            error: result.error,
          };
          if (result.paymentRequired) {
            errorResponse.paymentRequired = {
              x402Version: result.paymentRequired.x402Version,
              requirements: result.paymentRequired.accepts.map((req) => ({
                network: req.network,
                networkName: getChainName(req.network),
                price: formatUSDC(BigInt(req.amount)),
                priceRaw: req.amount,
              })),
            };
          }
          return mcpError(result.error?.message || 'Request failed', errorResponse);
        }

        const response: Record<string, unknown> = {
          success: true,
          statusCode: result.statusCode,
          data: result.data,
        };

        if (result.settlement) {
          const amount = result.paymentRequired?.accepts?.[0]?.amount;
          response.settlement = {
            transactionHash: result.settlement.transactionHash,
            network: result.settlement.network,
            networkName: getChainName(result.settlement.network),
            payer: address,
            ...(amount && { amountPaid: formatUSDC(BigInt(amount)) }),
          };
        }

        if (result.paymentRequired) {
          response.x402Version = result.paymentRequired.x402Version;
        }

        return mcpSuccess(response);
      } catch (err) {
        return mcpError(err, { tool: 'execute_call', url });
      }
    }
  );
}
