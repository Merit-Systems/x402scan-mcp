/**
 * SIWE (Sign-In-With-Ethereum) proof creation
 */

import { SiweMessage, generateNonce } from 'siwe';
import type { PrivateKeyAccount } from 'viem/accounts';
import { getChainId } from './networks';

export const SIWE_NETWORKS = [
  'mainnet',
  'base',
  'base-sepolia',
  'optimism',
  'arbitrum',
  'polygon',
  'sepolia',
] as const;

export type SiweNetwork = (typeof SIWE_NETWORKS)[number];

const NETWORK_CAIP2: Record<SiweNetwork, string> = {
  mainnet: 'eip155:1',
  base: 'eip155:8453',
  'base-sepolia': 'eip155:84532',
  optimism: 'eip155:10',
  arbitrum: 'eip155:42161',
  polygon: 'eip155:137',
  sepolia: 'eip155:11155111',
};

export function siweToCaip2(network: SiweNetwork): string {
  return NETWORK_CAIP2[network];
}

export interface ProofOptions {
  domain: string;
  uri: string;
  network: string;
  statement?: string;
  expirationMinutes?: number;
}

export interface ProofResult {
  proof: string;
  expiresAt: string;
}

export async function createProof(
  account: PrivateKeyAccount,
  opts: ProofOptions
): Promise<ProofResult> {
  const chainId = getChainId(opts.network);
  if (!chainId) throw new Error(`Unknown network: ${opts.network}`);

  const nonce = generateNonce();
  const issuedAt = new Date().toISOString();
  const expirationTime = new Date(
    Date.now() + (opts.expirationMinutes ?? 5) * 60_000
  ).toISOString();
  const statement = opts.statement ?? 'Authenticate to API';

  const message = new SiweMessage({
    domain: opts.domain,
    address: account.address,
    statement,
    uri: opts.uri,
    version: '1',
    chainId,
    nonce,
    issuedAt,
    expirationTime,
    resources: [opts.uri],
  }).prepareMessage();

  const signature = await account.signMessage({ message });

  return {
    proof: JSON.stringify({
      domain: opts.domain,
      address: account.address,
      statement,
      uri: opts.uri,
      version: '1',
      chainId: opts.network,
      nonce,
      issuedAt,
      expirationTime,
      resources: [opts.uri],
      signature,
    }),
    expiresAt: expirationTime,
  };
}
