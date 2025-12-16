/**
 * Network utilities for CAIP-2 chain identification
 *
 * Supports both v1 (simple names) and v2 (CAIP-2) network formats.
 */

import { base, baseSepolia, mainnet, sepolia, optimism, arbitrum, polygon } from 'viem/chains';
import type { Chain } from 'viem';

export interface ChainConfig {
  chain: Chain;
  caip2: string;
  v1Name: string;
  usdcAddress: `0x${string}`;
  rpcUrl?: string;
}

/**
 * Supported chain configurations
 * Maps CAIP-2 identifiers to chain info
 */
export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  // Base Mainnet
  'eip155:8453': {
    chain: base,
    caip2: 'eip155:8453',
    v1Name: 'base',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  // Base Sepolia
  'eip155:84532': {
    chain: baseSepolia,
    caip2: 'eip155:84532',
    v1Name: 'base-sepolia',
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  },
  // Ethereum Mainnet
  'eip155:1': {
    chain: mainnet,
    caip2: 'eip155:1',
    v1Name: 'ethereum',
    usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  // Ethereum Sepolia
  'eip155:11155111': {
    chain: sepolia,
    caip2: 'eip155:11155111',
    v1Name: 'ethereum-sepolia',
    usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  },
  // Optimism
  'eip155:10': {
    chain: optimism,
    caip2: 'eip155:10',
    v1Name: 'optimism',
    usdcAddress: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  },
  // Arbitrum
  'eip155:42161': {
    chain: arbitrum,
    caip2: 'eip155:42161',
    v1Name: 'arbitrum',
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
  // Polygon
  'eip155:137': {
    chain: polygon,
    caip2: 'eip155:137',
    v1Name: 'polygon',
    usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  },
};

/**
 * Map v1 network names to CAIP-2 identifiers
 */
const V1_TO_CAIP2: Record<string, string> = {
  'base': 'eip155:8453',
  'base-sepolia': 'eip155:84532',
  'ethereum': 'eip155:1',
  'ethereum-sepolia': 'eip155:11155111',
  'optimism': 'eip155:10',
  'arbitrum': 'eip155:42161',
  'polygon': 'eip155:137',
};

/**
 * Default network (Base mainnet)
 */
export const DEFAULT_NETWORK = 'eip155:8453';

/**
 * Convert any network identifier to CAIP-2 format
 */
export function toCaip2(network: string): string {
  // Already CAIP-2 format
  if (network.startsWith('eip155:')) {
    return network;
  }

  // Try v1 name lookup
  const caip2 = V1_TO_CAIP2[network.toLowerCase()];
  if (caip2) {
    return caip2;
  }

  // Return as-is if unknown
  return network;
}

/**
 * Get chain config from network identifier (CAIP-2 or v1 name)
 */
export function getChainConfig(network: string): ChainConfig | undefined {
  const caip2 = toCaip2(network);
  return CHAIN_CONFIGS[caip2];
}

/**
 * Get USDC address for a network
 */
export function getUSDCAddress(network: string): `0x${string}` | undefined {
  const config = getChainConfig(network);
  return config?.usdcAddress;
}

/**
 * Get viem Chain object for a network
 */
export function getChain(network: string): Chain | undefined {
  const config = getChainConfig(network);
  return config?.chain;
}

/**
 * Extract chain ID from CAIP-2 identifier
 */
export function getChainId(network: string): number | undefined {
  const caip2 = toCaip2(network);
  const match = caip2.match(/^eip155:(\d+)$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return undefined;
}

/**
 * Get human-readable chain name
 */
export function getChainName(network: string): string {
  const config = getChainConfig(network);
  if (config) {
    return config.chain.name;
  }
  return network;
}

/**
 * Get block explorer URL for a network
 */
export function getExplorerUrl(network: string): string | undefined {
  const config = getChainConfig(network);
  return config?.chain.blockExplorers?.default.url;
}

/**
 * Check if network is a testnet
 */
export function isTestnet(network: string): boolean {
  const config = getChainConfig(network);
  if (!config) return false;
  return config.chain.testnet === true;
}
