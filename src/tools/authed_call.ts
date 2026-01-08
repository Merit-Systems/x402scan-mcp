/**
 * authed_call MCP tool
 *
 * Make requests to SIWX-protected endpoints with server-driven authentication.
 * Uses the server's challenge (from 402 response) rather than creating proofs from scratch.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { x402HTTPClient } from '@x402/core/http';
import { x402Client } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { randomBytes } from 'crypto';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { getOrCreateWallet } from '../wallet/manager.js';
import { mcpSuccess, mcpError } from '../utils/helpers.js';
import { normalizePaymentRequired } from '../x402/normalize.js';
import {
  createSIWxPayload,
  encodeSIWxHeader,
  type SIWxExtensionInfo,
} from '../vendor/sign-in-with-x/index.js';

export interface AuthedCallArgs {
  url: string;
  method: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface AuthedCallDeps {
  account: PrivateKeyAccount;
  address: string;
  httpClient: x402HTTPClient;
}

/**
 * Core handler for authed_call. Exported for testing.
 */
export async function handleAuthedCall(
  args: AuthedCallArgs,
  deps: AuthedCallDeps
) {
  const { url, method, body, headers = {} } = args;
  const { account, address, httpClient } = deps;

  // Step 1: Make initial request
  const firstResponse = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // If not 402, return the response directly
  if (firstResponse.status !== 402) {
    const responseHeaders = Object.fromEntries(firstResponse.headers.entries());

    if (firstResponse.ok) {
      let data: unknown;
      const contentType = firstResponse.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        data = await firstResponse.json();
      } else {
        data = await firstResponse.text();
      }
      return mcpSuccess({
        statusCode: firstResponse.status,
        headers: responseHeaders,
        data,
      });
    }

    let errorBody: unknown;
    try {
      errorBody = await firstResponse.json();
    } catch {
      errorBody = await firstResponse.text();
    }
    return mcpError(`HTTP ${firstResponse.status}`, {
      statusCode: firstResponse.status,
      headers: responseHeaders,
      body: errorBody,
    });
  }

  // Step 2: Parse 402 response
  let rawBody: unknown;
  try {
    rawBody = await firstResponse.clone().json();
  } catch {
    rawBody = undefined;
  }

  const rawPaymentRequired = httpClient.getPaymentRequiredResponse(
    (name) => firstResponse.headers.get(name),
    rawBody
  );
  const paymentRequired = normalizePaymentRequired(rawPaymentRequired);

  // Step 3: Check for sign-in-with-x extension
  const siwxExtension = paymentRequired.extensions?.['sign-in-with-x'] as
    | { info?: SIWxExtensionInfo }
    | undefined;

  if (!siwxExtension?.info) {
    return mcpError('Endpoint returned 402 but no sign-in-with-x extension found', {
      statusCode: 402,
      x402Version: paymentRequired.x402Version,
      extensions: Object.keys(paymentRequired.extensions || {}),
      hint: 'This endpoint may require payment instead of authentication. Use execute_call for paid requests.',
    });
  }

  const serverInfo = siwxExtension.info;

  // Validate required fields
  const requiredFields = ['domain', 'uri', 'version', 'chainId', 'nonce', 'issuedAt'];
  const missingFields = requiredFields.filter(
    (f) => !serverInfo[f as keyof SIWxExtensionInfo]
  );
  if (missingFields.length > 0) {
    return mcpError('Invalid sign-in-with-x extension: missing required fields', {
      missingFields,
      receivedInfo: serverInfo,
    });
  }

  // Step 4: Check for unsupported chain types
  if (serverInfo.chainId.startsWith('solana:')) {
    return mcpError('Solana authentication not supported', {
      chainId: serverInfo.chainId,
      hint: 'This endpoint requires a Solana wallet. The MCP server currently only supports EVM wallets.',
    });
  }

  // Step 5: Create signed proof using server-provided challenge
  const payload = await createSIWxPayload(serverInfo, account);
  const siwxHeader = encodeSIWxHeader(payload);

  // Step 6: Retry with SIGN-IN-WITH-X header
  const authedResponse = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'SIGN-IN-WITH-X': siwxHeader,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseHeaders = Object.fromEntries(authedResponse.headers.entries());

  if (!authedResponse.ok) {
    let errorBody: unknown;
    try {
      errorBody = await authedResponse.json();
    } catch {
      errorBody = await authedResponse.text();
    }
    return mcpError(`HTTP ${authedResponse.status} after authentication`, {
      statusCode: authedResponse.status,
      headers: responseHeaders,
      body: errorBody,
      authAddress: address,
    });
  }

  // Parse successful response
  let data: unknown;
  const contentType = authedResponse.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    data = await authedResponse.json();
  } else {
    data = await authedResponse.text();
  }

  return mcpSuccess({
    statusCode: authedResponse.status,
    headers: responseHeaders,
    data,
    authentication: {
      address,
      domain: serverInfo.domain,
      chainId: serverInfo.chainId,
    },
  });
}

export function registerAuthedCallTool(server: McpServer): void {
  server.registerTool(
    'authed_call',
    {
      description: 'Make a request to a SIWX-protected endpoint. Handles auth flow automatically: detects SIWX requirement from 402 response, signs proof with server-provided challenge, retries.',
      inputSchema: {
        url: z.string().url().describe('The SIWX-protected endpoint URL'),
        method: z
          .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
          .default('GET')
          .describe('HTTP method'),
        body: z.unknown().optional().describe('Request body for POST/PUT/PATCH methods'),
        headers: z.record(z.string()).optional().describe('Additional headers to include'),
      },
    },
    async ({ url, method, body, headers = {} }) => {
      try {
        const { account, address } = await getOrCreateWallet();

        // Create a temporary client for parsing 402 responses
        const tempKey = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
        const tempAccount = privateKeyToAccount(tempKey);
        const coreClient = new x402Client();
        registerExactEvmScheme(coreClient, { signer: tempAccount });
        const httpClient = new x402HTTPClient(coreClient);

        return await handleAuthedCall(
          { url, method, body, headers },
          { account, address, httpClient }
        );
      } catch (err) {
        return mcpError(err, { tool: 'authed_call', url });
      }
    }
  );
}
