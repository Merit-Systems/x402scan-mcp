/**
 * USDC balance reader
 */

import { createPublicClient, http, erc20Abi } from "viem";

import { getChain, getUSDCAddress, DEFAULT_NETWORK, toCaip2 } from "./networks";

import { log } from "./log";

import type { Address } from "viem";

export async function getUSDCBalance(
  address: Address,
  network: string = DEFAULT_NETWORK
) {
  const caip2 = toCaip2(network);
  const chain = getChain(caip2);
  const usdcAddress = getUSDCAddress(caip2);

  if (!chain) throw new Error(`Unsupported network: ${network}`);
  if (!usdcAddress) throw new Error(`No USDC address for network: ${network}`);

  log.debug(`Reading USDC balance for ${address} on ${chain.name}`);

  const client = createPublicClient({ chain, transport: http() });
  const balance = await client.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
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
  address: Address,
  requiredAmount: bigint | string,
  network: string = DEFAULT_NETWORK
) {
  const required =
    typeof requiredAmount === "string"
      ? BigInt(requiredAmount)
      : requiredAmount;
  const { balance } = await getUSDCBalance(address, network);
  const sufficient = balance >= required;

  return {
    sufficient,
    currentBalance: balance,
    requiredAmount: required,
    shortfall: sufficient ? 0n : required - balance,
  };
}
