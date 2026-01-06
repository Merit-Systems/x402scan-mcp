/**
 * query_endpoint MCP tool
 *
 * Probe an x402 endpoint without making a payment.
 * Returns schema, pricing, and payment requirements.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { x402HTTPClient } from '@x402/core/http';
import { x402Client } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'crypto';
import { queryEndpoint } from '../x402/client.js';
import { mcpSuccess, mcpError, formatUSDC } from '../utils/helpers.js';
import { getChainName, toCaip2 } from '../utils/networks.js';
import { extractDiscoveryInfoV1, isDiscoverableV1 } from '@x402/extensions/bazaar';
import type { PaymentRequirementsV1 } from '@x402/core/types';

export function registerQueryEndpointTool(server: McpServer): void {
  server.tool(
    'query_endpoint',
    'Probe an x402-protected endpoint to get pricing and requirements without payment. Returns payment options, Bazaar schema, and Sign-In-With-X auth requirements (x402 v2) if available.',
    {
      url: z.string().url().describe('The x402-protected endpoint URL to probe'),
      method: z
        .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
        .default('GET')
        .describe('HTTP method to use'),
      body: z.unknown().optional().describe('Request body for POST/PUT/PATCH methods'),
    },
    async ({ url, method, body }) => {
      try {
        // Create a temporary client just for parsing (we don't need signing for query)
        const tempKey = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
        const tempAccount = privateKeyToAccount(tempKey);
        const coreClient = new x402Client();
        registerExactEvmScheme(coreClient, { signer: tempAccount });
        const httpClient = new x402HTTPClient(coreClient);

        const result = await queryEndpoint(url, httpClient, {
          method,
          body,
        });

        if (!result.success) {
          return mcpError(result.error || 'Failed to query endpoint', {
            statusCode: result.statusCode,
            parseErrors: result.parseErrors,
            rawHeaders: result.rawHeaders,
            rawBody: result.rawBody,
          });
        }

        // Not a 402 endpoint
        if (result.statusCode !== 402) {
          return mcpSuccess({
            isX402Endpoint: false,
            statusCode: result.statusCode,
            message: 'This endpoint does not require payment (no 402 response)',
            rawHeaders: result.rawHeaders,
          });
        }

        const pr = result.paymentRequired!;

        // Format payment requirements for display
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

        // Add resource info (v2)
        if (pr.resource) {
          response.resource = {
            url: pr.resource.url,
            description: pr.resource.description,
            mimeType: pr.resource.mimeType,
          };
        }

        // Add Bazaar extension if present (V2)
        if (pr.extensions?.bazaar) {
          const bazaar = pr.extensions.bazaar as Record<string, unknown>;
          response.bazaar = {
            info: bazaar.info,
            schema: bazaar.schema,
            examples: bazaar.examples,
            hasBazaarExtension: true,
          };
        } else if (pr.x402Version === 1 && result.rawBody) {
          // V1 - extract from outputSchema using @x402/extensions utility
          const v1Body = result.rawBody as { accepts?: PaymentRequirementsV1[] };
          const firstAccept = v1Body.accepts?.[0];

          if (firstAccept && isDiscoverableV1(firstAccept)) {
            const discoveryInfo = extractDiscoveryInfoV1(firstAccept);
            if (discoveryInfo) {
              response.bazaar = {
                info: discoveryInfo,
                schema: null,
                hasBazaarExtension: true,
                sourceVersion: 1,
              };
            }
          }
        }

        // Add Sign-In-With-X extension if present (x402 v2)
        if (pr.extensions?.['sign-in-with-x']) {
          const siwx = pr.extensions['sign-in-with-x'] as {
            info?: Record<string, unknown>;
            schema?: Record<string, unknown>;
          };

          // Validate required fields per CAIP-122 / x402 v2 spec
          const info = siwx.info || {};
          const requiredFields = ['domain', 'uri', 'version', 'chainId', 'nonce', 'issuedAt'];
          const missingFields = requiredFields.filter((f) => !info[f]);
          const validationErrors: string[] = [];

          if (!siwx.info) {
            validationErrors.push('Missing "info" object in sign-in-with-x extension');
          } else if (missingFields.length > 0) {
            validationErrors.push(`Missing required fields in info: ${missingFields.join(', ')}`);
          }

          if (!siwx.schema) {
            validationErrors.push('Missing "schema" object in sign-in-with-x extension');
          }

          response.signInWithX = {
            required: true,
            valid: validationErrors.length === 0,
            validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
            info: siwx.info,
            schema: siwx.schema,
            usage: 'Use create_siwe_proof or fetch_with_siwe tools to authenticate',
          };
        }

        // Add error if present in response
        if (pr.error) {
          response.serverError = pr.error;
        }

        return mcpSuccess(response);
      } catch (err) {
        return mcpError(err, { tool: 'query_endpoint', url });
      }
    }
  );
}
