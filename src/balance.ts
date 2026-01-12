/**
 * USDC balance reader
 */

import { createPublicClient, http } from 'viem';
import { getChain, getUSDCAddress, DEFAULT_NETWORK, toCaip2 } from './networks';
import { log } from './log';

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

export async function getUSDCBalance(
  address: `0x${string}`,
  network: string = DEFAULT_NETWORK
): Promise<BalanceResult> {
  const caip2 = toCaip2(network);
  const chain = getChain(caip2);
  const usdcAddress = getUSDCAddress(caip2);

  if (!chain) throw new Error(`Unsupported network: ${network}`);
  if (!usdcAddress) throw new Error(`No USDC address for network: ${network}`);

  log.debug(`Reading USDC balance for ${address} on ${chain.name}`);

  const client = createPublicClient({ chain, transport: http() });
  const balance = await client.readContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
  });

  const decimals = 6;
  const formatted = Number(balance) / 1_000_000;

  return {
    balance,
    formatted,
    formattedString: `$${formatted.toFixed(2)}`,
    decimals,
    network: caip2,
    usdcAddress,
  };
}

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

  return {
    sufficient,
    currentBalance: balance,
    requiredAmount: required,
    shortfall: sufficient ? 0n : required - balance,
  };
}
