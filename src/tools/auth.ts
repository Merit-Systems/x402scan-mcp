/**
 * Auth tools - SIWE proof creation, authenticated fetch, and authed_call
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpSuccess, mcpError } from '../response';
import { getWallet } from '../keystore';
import { createProof, siweToCaip2, SIWE_NETWORKS } from '../siwe';
import { getParseClient } from '../x402/client';
import { normalizePaymentRequired } from '../x402/protocol';
import {
  createSIWxPayload,
  encodeSIWxHeader,
  type SIWxExtensionInfo,
} from '../vendor/sign-in-with-x/index';

export function registerAuthTools(server: McpServer): void {
  // create_siwe_proof - create CAIP-122 compliant proof
  server.registerTool(
    'create_siwe_proof',
    {
      description: 'Create a CAIP-122 compliant Sign-In-With-X proof for wallet authentication.',
      inputSchema: {
        domain: z.string().describe('Domain requesting auth (e.g., "api.example.com")'),
        uri: z.string().url().describe('Full URI of the resource'),
        statement: z.string().optional().default('Authenticate to API'),
        network: z.enum(SIWE_NETWORKS).optional().default('base'),
        expirationMinutes: z.number().optional().default(5),
      },
    },
    async ({ domain, uri, statement, network, expirationMinutes }) => {
      try {
        const { account, address } = await getWallet();
        const caip2 = siweToCaip2(network);
        const { proof, expiresAt } = await createProof(account, {
          domain,
          uri,
          network: caip2,
          statement,
          expirationMinutes,
        });

        return mcpSuccess({
          proof,
          address,
          network: caip2,
          expiresAt,
          usage: 'Add to request headers as: SIGN-IN-WITH-X: <proof>',
        });
      } catch (err) {
        return mcpError(err, { tool: 'create_siwe_proof' });
      }
    }
  );

  // fetch_with_siwe - HTTP fetch with automatic SIWE auth
  server.registerTool(
    'fetch_with_siwe',
    {
      description: 'Make an HTTP request with automatic CAIP-122 Sign-In-With-X wallet authentication.',
      inputSchema: {
        url: z.string().url().describe('The URL to fetch'),
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().default('GET'),
        body: z.unknown().optional().describe('Request body for POST/PUT/PATCH'),
        headers: z.record(z.string()).optional().describe('Additional headers'),
        network: z.enum(SIWE_NETWORKS).optional().default('base'),
      },
    },
    async ({ url, method, body, headers, network }) => {
      try {
        const { account } = await getWallet();
        const parsedUrl = new URL(url);
        const caip2 = siweToCaip2(network);

        const { proof } = await createProof(account, {
          domain: parsedUrl.host,
          uri: parsedUrl.origin,
          network: caip2,
        });

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

  // authed_call - server-driven SIWX authentication (x402 v2)
  server.registerTool(
    'authed_call',
    {
      description: 'Make a request to a SIWX-protected endpoint. Handles auth flow automatically: detects SIWX requirement from 402 response, signs proof with server-provided challenge, retries.',
      inputSchema: {
        url: z.string().url().describe('The SIWX-protected endpoint URL'),
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET').describe('HTTP method'),
        body: z.unknown().optional().describe('Request body for POST/PUT/PATCH methods'),
        headers: z.record(z.string()).optional().describe('Additional headers to include'),
      },
    },
    async ({ url, method, body, headers = {} }) => {
      try {
        const { account, address } = await getWallet();
        const httpClient = getParseClient();

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
      } catch (err) {
        return mcpError(err, { tool: 'authed_call', url });
      }
    }
  );
}
