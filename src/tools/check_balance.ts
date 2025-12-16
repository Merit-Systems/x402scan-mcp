/**
 * check_balance MCP tool
 *
 * Returns wallet address, USDC balance, and funding instructions.
 * Creates wallet if it doesn't exist.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getOrCreateWallet, getWalletFilePath } from '../wallet/manager.js';
import { getUSDCBalance } from '../balance/usdc.js';
import { mcpSuccess, mcpError } from '../utils/helpers.js';
import { DEFAULT_NETWORK, getChainName, getExplorerUrl, getUSDCAddress, isTestnet } from '../utils/networks.js';

export function registerCheckBalanceTool(server: McpServer): void {
  server.tool(
    'check_balance',
    'Check wallet address and USDC balance. Creates wallet if needed. Returns address, balance, and funding instructions.',
    {},
    async () => {
      try {
        const { address, isNew } = await getOrCreateWallet();
        const walletFile = getWalletFilePath();

        // Get balance on default network (Base mainnet)
        let balance;
        try {
          balance = await getUSDCBalance(address, DEFAULT_NETWORK);
        } catch (err) {
          // Balance check failed - might be network issue
          return mcpSuccess({
            address,
            network: DEFAULT_NETWORK,
            networkName: getChainName(DEFAULT_NETWORK),
            balanceUSDC: null,
            balanceError: err instanceof Error ? err.message : 'Failed to fetch balance',
            walletFile,
            isNewWallet: isNew,
            fundingInstructions: getFundingInstructions(address, DEFAULT_NETWORK),
          });
        }

        const response: Record<string, unknown> = {
          address,
          network: balance.network,
          networkName: getChainName(balance.network),
          balanceUSDC: balance.formatted,
          balanceFormatted: balance.formattedString,
          walletFile,
          isNewWallet: isNew,
        };

        // Add funding instructions if balance is low
        if (balance.formatted < 1) {
          response.fundingInstructions = getFundingInstructions(address, balance.network);
          response.suggestion = balance.formatted === 0
            ? 'Your wallet has no USDC. Send USDC to the address above to start making paid API calls.'
            : 'Your balance is low. Consider topping up to continue making paid API calls.';
        }

        return mcpSuccess(response);
      } catch (err) {
        return mcpError(err, { tool: 'check_balance' });
      }
    }
  );
}

function getFundingInstructions(address: string, network: string): Record<string, unknown> {
  const explorerUrl = getExplorerUrl(network);
  const usdcAddress = getUSDCAddress(network);
  const chainName = getChainName(network);
  const testnet = isTestnet(network);

  return {
    chainName,
    isTestnet: testnet,
    depositAddress: address,
    usdcContract: usdcAddress,
    explorerUrl: explorerUrl ? `${explorerUrl}/address/${address}` : undefined,
    instructions: testnet
      ? `This is a testnet. Get test USDC from a faucet and send to ${address}`
      : `Send USDC on ${chainName} to ${address}`,
  };
}
