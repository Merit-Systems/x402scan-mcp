/**
 * Sign-In-With-X (SIWx) proof tool
 *
 * Creates CAIP-122 compliant proofs for wallet authentication.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SiweMessage, generateNonce } from 'siwe';
import { getOrCreateWallet } from '../wallet/manager.js';
import { mcpSuccess, mcpError } from '../utils/helpers.js';

// CAIP-2 network identifiers
const NETWORKS = {
  mainnet: 'eip155:1',
  base: 'eip155:8453',
  'base-sepolia': 'eip155:84532',
  optimism: 'eip155:10',
  arbitrum: 'eip155:42161',
  polygon: 'eip155:137',
  sepolia: 'eip155:11155111',
} as const;

type NetworkName = keyof typeof NETWORKS;

function parseChainId(network: string): number {
  const parts = network.split(':');
  return parseInt(parts[1], 10);
}

export function registerCreateSiweProofTool(server: McpServer): void {
  server.tool(
    'create_siwe_proof',
    'Create a CAIP-122 compliant Sign-In-With-X proof for wallet authentication (x402 v2 extension). Returns a flat proof object for the SIGN-IN-WITH-X header.',
    {
      domain: z
        .string()
        .describe('Domain requesting auth (e.g., "api.example.com")'),
      uri: z
        .string()
        .url()
        .describe('Full URI of the resource (e.g., "https://api.example.com")'),
      statement: z
        .string()
        .optional()
        .default('Authenticate to API')
        .describe('Human-readable statement'),
      network: z
        .enum(['mainnet', 'base', 'base-sepolia', 'optimism', 'arbitrum', 'polygon', 'sepolia'])
        .optional()
        .default('base')
        .describe('Network name (default: base)'),
      expirationMinutes: z
        .number()
        .optional()
        .default(5)
        .describe('Proof validity in minutes (default: 5)'),
    },
    async ({ domain, uri, statement, network, expirationMinutes }) => {
      try {
        const { account, address } = await getOrCreateWallet();
        const caip2Network = NETWORKS[network as NetworkName];
        const numericChainId = parseChainId(caip2Network);
        const nonce = generateNonce();
        const issuedAt = new Date().toISOString();
        const expirationTime = new Date(
          Date.now() + expirationMinutes * 60 * 1000
        ).toISOString();

        const siweMessage = new SiweMessage({
          domain,
          address,
          statement,
          uri,
          version: '1',
          chainId: numericChainId,
          nonce,
          issuedAt,
          expirationTime,
          resources: [uri],
        });

        const message = siweMessage.prepareMessage();
        const signature = await account.signMessage({ message });

        // Flat CAIP-122 compliant payload
        const proof = {
          domain,
          address,
          statement,
          uri,
          version: '1',
          chainId: caip2Network,
          nonce,
          issuedAt,
          expirationTime,
          resources: [uri],
          signature,
        };

        return mcpSuccess({
          proof: JSON.stringify(proof),
          address,
          network: caip2Network,
          expiresAt: expirationTime,
          usage: 'Add to request headers as: SIGN-IN-WITH-X: <proof>',
        });
      } catch (err) {
        return mcpError(err, { tool: 'create_siwe_proof' });
      }
    }
  );
}
