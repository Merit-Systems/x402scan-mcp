/**
 * Wallet tools - balance checking
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mcpSuccess, mcpError } from '../response';
import { getWallet, keystorePath } from '../keystore';
import { DEFAULT_NETWORK, getChainName, getExplorerUrl, getUSDCAddress, isTestnet } from '../networks';
import { ScanClient, type ScanBalanceResult } from '../scan/client';

export function registerWalletTools(server: McpServer): void {
  server.registerTool(
    'check_balance',
    {
      description: 'Check wallet address and USDC balance. Creates wallet if needed.',
    },
    async () => {
      try {
        const { address, isNew } = await getWallet();

        let result: ScanBalanceResult;
        try {
          const scanClient = new ScanClient(process.env.SCAN_URL!);
          result = await scanClient.getBalance(address);
          if (!result.success) {
            return mcpError(result.error!, { tool: 'check_balance' });
          }
        } catch (err) {
          return mcpSuccess({
            address,
            network: DEFAULT_NETWORK,
            networkName: getChainName(DEFAULT_NETWORK),
            balanceUSDC: null,
            balanceError: err instanceof Error ? err.message : 'Failed to fetch balance',
            walletFile: keystorePath,
            isNewWallet: isNew,
            fundingInstructions: getFundingInstructions(address, DEFAULT_NETWORK),
          });
        }

        const data = result.data;

        const response: Record<string, unknown> = {
          address,
          network: DEFAULT_NETWORK,
          networkName: getChainName(DEFAULT_NETWORK),
          balanceUSDC: data?.balance,
          balanceFormatted: Number(data?.balance).toFixed(2),
          walletFile: keystorePath,
          isNewWallet: isNew,
        };

        if (data?.balance && Number(data.balance) < 1) {
          response.fundingInstructions = getFundingInstructions(address, data?.chain.toString() ?? '');
          response.suggestion =
            Number(data?.balance) === 0
              ? 'Your wallet has no USDC. Send USDC to the address above to start making paid API calls.'
              : 'Your balance is low. Consider topping up.';
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
