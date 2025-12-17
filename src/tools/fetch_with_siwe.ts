/**
 * Fetch with SIWE authentication tool
 *
 * Makes HTTP requests with automatic SIWE wallet authentication.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SiweMessage, generateNonce } from 'siwe';
import { getOrCreateWallet } from '../wallet/manager.js';
import { mcpSuccess, mcpError } from '../utils/helpers.js';
import type { PrivateKeyAccount } from 'viem/accounts';

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

async function createSiweProof(
  account: PrivateKeyAccount,
  domain: string,
  uri: string,
  chainId: number
): Promise<string> {
  const siweMessage = new SiweMessage({
    domain,
    address: account.address,
    statement: 'Authenticate to API',
    uri,
    version: '1',
    chainId,
    nonce: generateNonce(),
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 3600000).toISOString(),
  });

  const message = siweMessage.prepareMessage();
  const signature = await account.signMessage({ message });

  return JSON.stringify({
    message: JSON.stringify(siweMessage),
    signature,
  });
}

export function registerFetchWithSiweTool(server: McpServer): void {
  server.tool(
    'fetch_with_siwe',
    'Make an HTTP request with automatic SIWE wallet authentication. Useful for APIs that require wallet ownership proof.',
    {
      url: z.string().url().describe('The URL to fetch'),
      method: z
        .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
        .optional()
        .default('GET'),
      body: z.unknown().optional().describe('Request body for POST/PUT/PATCH'),
      headers: z
        .record(z.string())
        .optional()
        .describe('Additional headers'),
      siweHeader: z
        .string()
        .optional()
        .default('X-SIWE-PROOF')
        .describe('Header name for SIWE proof'),
      chainId: z
        .number()
        .optional()
        .describe(
          'Chain ID for SIWE proof (default: 8453 for Base). Common IDs: 1=mainnet, 8453=base, 84532=base-sepolia'
        ),
      chain: z
        .enum(['mainnet', 'base', 'base-sepolia', 'optimism', 'arbitrum', 'polygon', 'sepolia'])
        .optional()
        .describe('Chain name (alternative to chainId). Default: base'),
    },
    async ({ url, method, body, headers, siweHeader, chainId, chain }) => {
      try {
        const { account } = await getOrCreateWallet();
        const parsedUrl = new URL(url);

        // Resolve chain ID: explicit chainId > chain name > default (base)
        const resolvedChainId = chainId ?? (chain ? CHAIN_IDS[chain] : CHAIN_IDS.base);

        // Create SIWE proof
        const proof = await createSiweProof(
          account,
          parsedUrl.host,
          parsedUrl.origin,
          resolvedChainId
        );

        // Make request with SIWE header
        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            [siweHeader]: proof,
            ...headers,
          },
          body: body ? JSON.stringify(body) : undefined,
        });

        const responseHeaders = Object.fromEntries(response.headers.entries());

        if (!response.ok) {
          let errorBody: unknown;
          try {
            errorBody = await response.json();
          } catch {
            errorBody = await response.text();
          }
          return mcpError(`HTTP ${response.status}`, {
            statusCode: response.status,
            headers: responseHeaders,
            body: errorBody,
          });
        }

        let data: unknown;
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        return mcpSuccess({
          statusCode: response.status,
          headers: responseHeaders,
          data,
        });
      } catch (err) {
        return mcpError(err, { tool: 'fetch_with_siwe', url });
      }
    }
  );
}
