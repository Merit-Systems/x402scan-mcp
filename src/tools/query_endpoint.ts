/**
 * query_endpoint MCP tool
 *
 * Probe an x402 endpoint without making a payment.
 * Returns schema, pricing, and payment requirements.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { x402HTTPClient } from '@x402/core/http';
import { x402Client } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'crypto';
import { queryEndpoint } from '../x402/client.js';
import { mcpSuccess, mcpError, formatUSDC } from '../utils/helpers.js';
import { getChainName, toCaip2 } from '../utils/networks.js';

export function registerQueryEndpointTool(server: McpServer): void {
  server.tool(
    'query_endpoint',
    'Probe an x402-protected endpoint to get pricing and schema without making a payment. Returns payment requirements, accepted networks, and Bazaar schema if available.',
    {
      url: z.string().url().describe('The x402-protected endpoint URL to probe'),
      method: z
        .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
        .default('GET')
        .describe('HTTP method to use'),
      body: z.unknown().optional().describe('Request body for POST/PUT/PATCH methods'),
    },
    async ({ url, method, body }) => {
      try {
        // Create a temporary client just for parsing (we don't need signing for query)
        const tempKey = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
        const tempAccount = privateKeyToAccount(tempKey);
        const coreClient = new x402Client();
        registerExactEvmScheme(coreClient, { signer: tempAccount });
        const httpClient = new x402HTTPClient(coreClient);

        const result = await queryEndpoint(url, httpClient, {
          method,
          body,
        });

        if (!result.success) {
          return mcpError(result.error || 'Failed to query endpoint', {
            statusCode: result.statusCode,
            parseErrors: result.parseErrors,
            rawHeaders: result.rawHeaders,
            rawBody: result.rawBody,
          });
        }

        // Not a 402 endpoint
        if (result.statusCode !== 402) {
          return mcpSuccess({
            isX402Endpoint: false,
            statusCode: result.statusCode,
            message: 'This endpoint does not require payment (no 402 response)',
            rawHeaders: result.rawHeaders,
          });
        }

        const pr = result.paymentRequired!;

        // Format payment requirements for display
        const requirements = pr.accepts.map((req) => ({
          scheme: req.scheme,
          network: req.network,
          networkName: getChainName(req.network),
          price: formatUSDC(BigInt(req.amount)),
          priceRaw: req.amount,
          asset: req.asset,
          payTo: req.payTo,
          maxTimeoutSeconds: req.maxTimeoutSeconds,
          extra: req.extra,
        }));

        const response: Record<string, unknown> = {
          isX402Endpoint: true,
          x402Version: pr.x402Version,
          requirements,
        };

        // Add resource info (v2)
        if (pr.resource) {
          response.resource = {
            url: pr.resource.url,
            description: pr.resource.description,
            mimeType: pr.resource.mimeType,
          };
        }

        // Add Bazaar extension if present
        if (pr.extensions?.bazaar) {
          const bazaar = pr.extensions.bazaar as Record<string, unknown>;
          response.bazaar = {
            info: bazaar.info,
            schema: bazaar.schema,
            examples: bazaar.examples,
            hasBazaarExtension: true,
          };
        }

        // Add error if present in response
        if (pr.error) {
          response.serverError = pr.error;
        }

        return mcpSuccess(response);
      } catch (err) {
        return mcpError(err, { tool: 'query_endpoint', url });
      }
    }
  );
}
