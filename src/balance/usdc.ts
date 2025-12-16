/**
 * USDC balance reader
 *
 * Reads USDC balance from any supported EVM chain.
 */

import { createPublicClient, http, formatUnits } from 'viem';
import { getChainConfig, getChain, getUSDCAddress, DEFAULT_NETWORK, toCaip2 } from '../utils/networks.js';
import { log } from '../utils/logger.js';

// Minimal ERC-20 ABI for balanceOf
const ERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export interface BalanceResult {
  balance: bigint;
  formatted: number;
  formattedString: string;
  decimals: number;
  network: string;
  usdcAddress: string;
}

/**
 * Get USDC balance for an address on a specific network
 *
 * @param address - Wallet address
 * @param network - Network identifier (CAIP-2 or v1 name). Defaults to Base mainnet.
 */
export async function getUSDCBalance(
  address: `0x${string}`,
  network: string = DEFAULT_NETWORK
): Promise<BalanceResult> {
  const caip2Network = toCaip2(network);
  const chain = getChain(caip2Network);
  const usdcAddress = getUSDCAddress(caip2Network);

  if (!chain) {
    throw new Error(`Unsupported network: ${network} (${caip2Network})`);
  }

  if (!usdcAddress) {
    throw new Error(`No USDC address configured for network: ${network}`);
  }

  log.debug(`Reading USDC balance for ${address} on ${chain.name}`);

  const client = createPublicClient({
    chain,
    transport: http(),
  });

  const balance = await client.readContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
  });

  // USDC has 6 decimals
  const decimals = 6;
  const formatted = Number(balance) / Math.pow(10, decimals);
  const formattedString = `$${formatted.toFixed(2)}`;

  log.debug(`Balance: ${formattedString}`);

  return {
    balance,
    formatted,
    formattedString,
    decimals,
    network: caip2Network,
    usdcAddress,
  };
}

/**
 * Get balances across multiple networks
 *
 * @param address - Wallet address
 * @param networks - Array of network identifiers. If not provided, checks all supported networks.
 */
export async function getMultiNetworkBalance(
  address: `0x${string}`,
  networks?: string[]
): Promise<Record<string, BalanceResult>> {
  const networksToCheck = networks || [
    'eip155:8453', // Base
    'eip155:84532', // Base Sepolia
  ];

  const results: Record<string, BalanceResult> = {};

  await Promise.all(
    networksToCheck.map(async (network) => {
      try {
        results[network] = await getUSDCBalance(address, network);
      } catch (err) {
        log.debug(`Failed to get balance for ${network}: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );

  return results;
}

/**
 * Check if address has sufficient balance for a payment
 *
 * @param address - Wallet address
 * @param requiredAmount - Required amount in raw USDC units (6 decimals)
 * @param network - Network identifier
 */
export async function hasSufficientBalance(
  address: `0x${string}`,
  requiredAmount: bigint | string,
  network: string = DEFAULT_NETWORK
): Promise<{
  sufficient: boolean;
  currentBalance: bigint;
  requiredAmount: bigint;
  shortfall: bigint;
}> {
  const required = typeof requiredAmount === 'string' ? BigInt(requiredAmount) : requiredAmount;
  const { balance } = await getUSDCBalance(address, network);

  const sufficient = balance >= required;
  const shortfall = sufficient ? 0n : required - balance;

  return {
    sufficient,
    currentBalance: balance,
    requiredAmount: required,
    shortfall,
  };
}
