/**
 * Wallet tools - balance checking
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpSuccess, mcpError } from "../response";
import { getWallet, keystorePath } from "../keystore";
import { getUSDCBalance } from "../balance";
import {
  DEFAULT_NETWORK,
  getChainName,
  getExplorerUrl,
  getUSDCAddress,
  isTestnet,
} from "../networks";

export function registerWalletTools(server: McpServer): void {
  server.registerTool(
    "check_balance",
    {
      description:
        "Check wallet address and USDC balance. Creates wallet if needed.",
    },
    async () => {
      try {
        const { address, isNew } = await getWallet();

        try {
          const balance = await getUSDCBalance(address, DEFAULT_NETWORK);
          return mcpSuccess({
            address,
            network: balance.network,
            networkName: getChainName(balance.network),
            balanceUSDC: balance.formatted,
            balanceFormatted: balance.formattedString,
            walletFile: keystorePath,
            isNewWallet: isNew,
            ...(balance.formatted < 1
              ? {
                  fundingInstructions: getFundingInstructions(
                    address,
                    balance.network
                  ),
                  suggestion:
                    balance.formatted === 0
                      ? "Your wallet has no USDC. Send USDC to the address above to start making paid API calls."
                      : "Your balance is low. Consider topping up.",
                }
              : {}),
          });
        } catch (err) {
          return mcpSuccess({
            address,
            network: DEFAULT_NETWORK,
            networkName: getChainName(DEFAULT_NETWORK),
            balanceUSDC: null,
            balanceError:
              err instanceof Error ? err.message : "Failed to fetch balance",
            walletFile: keystorePath,
            isNewWallet: isNew,
            fundingInstructions: getFundingInstructions(
              address,
              DEFAULT_NETWORK
            ),
          });
        }
      } catch (err) {
        return mcpError(err, { tool: "check_balance" });
      }
    }
  );
}

function getFundingInstructions(
  address: string,
  network: string
): Record<string, unknown> {
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
