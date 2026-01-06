/**
 * Fetch with Sign-In-With-X authentication tool
 *
 * Makes HTTP requests with automatic CAIP-122 compliant wallet authentication.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SiweMessage, generateNonce } from 'siwe';
import { getOrCreateWallet } from '../wallet/manager.js';
import { mcpSuccess, mcpError } from '../utils/helpers.js';
import type { PrivateKeyAccount } from 'viem/accounts';

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

async function createSiwxProof(
  account: PrivateKeyAccount,
  domain: string,
  uri: string,
  network: string
): Promise<string> {
  const numericChainId = parseChainId(network);
  const nonce = generateNonce();
  const issuedAt = new Date().toISOString();
  const expirationTime = new Date(Date.now() + 300000).toISOString(); // 5 min

  const siweMessage = new SiweMessage({
    domain,
    address: account.address,
    statement: 'Authenticate to API',
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
  return JSON.stringify({
    domain,
    address: account.address,
    statement: 'Authenticate to API',
    uri,
    version: '1',
    chainId: network,
    nonce,
    issuedAt,
    expirationTime,
    resources: [uri],
    signature,
  });
}

export function registerFetchWithSiweTool(server: McpServer): void {
  server.tool(
    'fetch_with_siwe',
    'Make an HTTP request with automatic CAIP-122 Sign-In-With-X wallet authentication (x402 v2 extension).',
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
      network: z
        .enum(['mainnet', 'base', 'base-sepolia', 'optimism', 'arbitrum', 'polygon', 'sepolia'])
        .optional()
        .default('base')
        .describe('Network name (default: base)'),
    },
    async ({ url, method, body, headers, network }) => {
      try {
        const { account } = await getOrCreateWallet();
        const parsedUrl = new URL(url);
        const caip2Network = NETWORKS[network as NetworkName];

        const proof = await createSiwxProof(
          account,
          parsedUrl.host,
          parsedUrl.origin,
          caip2Network
        );

        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'SIGN-IN-WITH-X': proof,
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
