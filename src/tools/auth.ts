/**
 * Auth tools - SIWE proof creation and authenticated fetch
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpSuccess, mcpError } from '../response';
import { getWallet } from '../keystore';
import { createProof, siweToCaip2, SIWE_NETWORKS } from '../siwe';

export function registerAuthTools(server: McpServer): void {
  // create_siwe_proof - create CAIP-122 compliant proof
  server.tool(
    'create_siwe_proof',
    'Create a CAIP-122 compliant Sign-In-With-X proof for wallet authentication.',
    {
      domain: z.string().describe('Domain requesting auth (e.g., "api.example.com")'),
      uri: z.string().url().describe('Full URI of the resource'),
      statement: z.string().optional().default('Authenticate to API'),
      network: z.enum(SIWE_NETWORKS).optional().default('base'),
      expirationMinutes: z.number().optional().default(5),
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
  server.tool(
    'fetch_with_siwe',
    'Make an HTTP request with automatic CAIP-122 Sign-In-With-X wallet authentication.',
    {
      url: z.string().url().describe('The URL to fetch'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().default('GET'),
      body: z.unknown().optional().describe('Request body for POST/PUT/PATCH'),
      headers: z.record(z.string()).optional().describe('Additional headers'),
      network: z.enum(SIWE_NETWORKS).optional().default('base'),
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
}
