/**
 * SIWE (Sign-In with Ethereum) proof tool
 *
 * Creates SIWE proofs for wallet authentication with any API.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SiweMessage, generateNonce } from 'siwe';
import { getOrCreateWallet } from '../wallet/manager.js';
import { mcpSuccess, mcpError } from '../utils/helpers.js';

// Common chain IDs for reference
const CHAIN_IDS = {
  mainnet: 1,
  base: 8453,
  'base-sepolia': 84532,
  optimism: 10,
  arbitrum: 42161,
  polygon: 137,
  sepolia: 11155111,
} as const;

export function registerCreateSiweProofTool(server: McpServer): void {
  server.tool(
    'create_siwe_proof',
    'Create a SIWE (Sign-In with Ethereum) proof for wallet authentication. Returns a proof string to use in X-SIWE-PROOF header.',
    {
      domain: z
        .string()
        .describe(
          'Domain requesting auth (e.g., "localhost:3000" or "stablestudio.io")'
        ),
      uri: z
        .string()
        .url()
        .describe('Full URI of the API (e.g., "http://localhost:3000")'),
      statement: z
        .string()
        .optional()
        .default('Authenticate to API')
        .describe('Human-readable statement'),
      chainId: z
        .number()
        .optional()
        .describe(
          'Chain ID (default: 8453 for Base). Common IDs: 1=mainnet, 8453=base, 84532=base-sepolia, 10=optimism'
        ),
      chain: z
        .enum(['mainnet', 'base', 'base-sepolia', 'optimism', 'arbitrum', 'polygon', 'sepolia'])
        .optional()
        .describe('Chain name (alternative to chainId). Default: base'),
      expirationMinutes: z
        .number()
        .optional()
        .default(60)
        .describe('Proof validity in minutes'),
    },
    async ({ domain, uri, statement, chainId, chain, expirationMinutes }) => {
      try {
        const { account, address } = await getOrCreateWallet();

        // Resolve chain ID: explicit chainId > chain name > default (base)
        const resolvedChainId = chainId ?? (chain ? CHAIN_IDS[chain] : CHAIN_IDS.base);

        const siweMessage = new SiweMessage({
          domain,
          address,
          statement,
          uri,
          version: '1',
          chainId: resolvedChainId,
          nonce: generateNonce(),
          issuedAt: new Date().toISOString(),
          expirationTime: new Date(
            Date.now() + expirationMinutes * 60 * 1000
          ).toISOString(),
        });

        const message = siweMessage.prepareMessage();
        const signature = await account.signMessage({ message });

        const proof = JSON.stringify({
          message: JSON.stringify(siweMessage),
          signature,
        });

        return mcpSuccess({
          proof,
          address,
          chainId: resolvedChainId,
          expiresAt: siweMessage.expirationTime,
          usage: 'Add to request headers as: X-SIWE-PROOF: <proof>',
        });
      } catch (err) {
        return mcpError(err, { tool: 'create_siwe_proof' });
      }
    }
  );
}
