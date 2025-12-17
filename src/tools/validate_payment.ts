/**
 * validate_payment MCP tool
 *
 * Pre-flight check if a payment would succeed.
 * Validates wallet exists, network is supported, and balance is sufficient.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getOrCreateWallet, walletExists } from '../wallet/manager.js';
import { hasSufficientBalance, getUSDCBalance } from '../balance/usdc.js';
import { mcpSuccess, mcpError, formatUSDC } from '../utils/helpers.js';
import { getChainConfig, getChainName, toCaip2 } from '../utils/networks.js';

// Schema accepts both v1 (maxAmountRequired) and v2 (amount) field names
const PaymentRequirementsSchema = z
  .object({
    scheme: z.string(),
    network: z.string(),
    amount: z.string().optional(), // v2 field name
    maxAmountRequired: z.string().optional(), // v1 field name
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
    // Normalize to 'amount' internally
    amount: data.amount ?? data.maxAmountRequired!,
  }));

export function registerValidatePaymentTool(server: McpServer): void {
  server.tool(
    'validate_payment',
    'Pre-flight check if a payment would succeed. Validates wallet, network support, and balance. Use after query_endpoint to verify before execute_call.',
    {
      requirements: PaymentRequirementsSchema.describe(
        'Payment requirements from query_endpoint result'
      ),
    },
    async ({ requirements }) => {
      try {
        const errors: string[] = [];
        const warnings: string[] = [];
        const checks: Record<string, boolean> = {};

        // Check 1: Wallet exists
        const hasWallet = await walletExists();
        checks.walletExists = hasWallet;
        if (!hasWallet) {
          errors.push('No wallet found. Run check_balance first to create a wallet.');
        }

        // Check 2: Network is supported
        const caip2Network = toCaip2(requirements.network);
        const chainConfig = getChainConfig(caip2Network);
        checks.networkSupported = !!chainConfig;
        if (!chainConfig) {
          errors.push(
            `Network not supported: ${requirements.network}. ` +
            `Supported networks: Base (eip155:8453), Base Sepolia (eip155:84532), Ethereum, Optimism, Arbitrum, Polygon.`
          );
        }

        // Check 3: Scheme is supported (we only support 'exact' for EVM)
        checks.schemeSupported = requirements.scheme === 'exact';
        if (requirements.scheme !== 'exact') {
          errors.push(
            `Payment scheme not supported: ${requirements.scheme}. Only 'exact' scheme is supported for EVM chains.`
          );
        }

        // If we don't have wallet or network, we can't check balance
        if (!hasWallet || !chainConfig) {
          return mcpSuccess({
            valid: false,
            readyToExecute: false,
            checks,
            errors,
            warnings,
          });
        }

        // Get wallet for balance check
        const { address } = await getOrCreateWallet();

        // Check 4: Sufficient balance
        let balanceResult;
        try {
          balanceResult = await hasSufficientBalance(
            address,
            requirements.amount,
            caip2Network
          );
          checks.sufficientBalance = balanceResult.sufficient;

          if (!balanceResult.sufficient) {
            errors.push(
              `Insufficient balance. ` +
              `Required: ${formatUSDC(balanceResult.requiredAmount)}, ` +
              `Available: ${formatUSDC(balanceResult.currentBalance)}, ` +
              `Shortfall: ${formatUSDC(balanceResult.shortfall)}`
            );
          }
        } catch (err) {
          checks.sufficientBalance = false;
          errors.push(`Failed to check balance: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Check 5: Asset is USDC (we expect USDC for x402)
        const expectedUsdc = chainConfig?.usdcAddress?.toLowerCase();
        const providedAsset = requirements.asset.toLowerCase();
        checks.assetIsUSDC = expectedUsdc === providedAsset;
        if (!checks.assetIsUSDC) {
          warnings.push(
            `Asset may not be USDC. Expected: ${expectedUsdc}, Got: ${providedAsset}. ` +
            `Proceeding anyway, but verify the asset is correct.`
          );
        }

        // Check 6: Signature capability (always true for EVM with our setup)
        checks.signatureCapable = true;

        const valid = errors.length === 0;
        const response: Record<string, unknown> = {
          valid,
          readyToExecute: valid,
          checks,
        };

        // Add balance info
        if (balanceResult) {
          response.balance = {
            current: formatUSDC(balanceResult.currentBalance),
            required: formatUSDC(balanceResult.requiredAmount),
            sufficient: balanceResult.sufficient,
          };
        }

        // Add network info
        response.network = {
          requested: requirements.network,
          resolved: caip2Network,
          name: getChainName(caip2Network),
          supported: !!chainConfig,
        };

        if (errors.length > 0) {
          response.errors = errors;
        }
        if (warnings.length > 0) {
          response.warnings = warnings;
        }

        return mcpSuccess(response);
      } catch (err) {
        return mcpError(err, { tool: 'validate_payment' });
      }
    }
  );
}
