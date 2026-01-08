/**
 * execute_call MCP tool
 *
 * Make a paid request to an x402-protected endpoint.
 * Handles the full payment flow automatically.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getOrCreateWallet } from '../wallet/manager.js';
import { createX402Client, makeX402Request } from '../x402/client.js';
import { mcpSuccess, mcpError, formatUSDC } from '../utils/helpers.js';
import { getChainName } from '../utils/networks.js';

export function registerExecuteCallTool(server: McpServer): void {
  server.registerTool(
    'execute_call',
    {
      description: 'Make a paid request to an x402-protected endpoint. Handles 402 payment flow automatically: detects payment requirements, signs payment, and executes request.',
      inputSchema: {
        url: z.string().url().describe('The x402-protected endpoint URL'),
        method: z
          .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
          .default('GET')
          .describe('HTTP method'),
        body: z.unknown().optional().describe('Request body for POST/PUT/PATCH methods'),
        headers: z
          .record(z.string())
          .optional()
          .describe('Additional headers to include in the request'),
      },
    },
    async ({ url, method, body, headers }) => {
      try {
        // Get wallet
        const { account, address } = await getOrCreateWallet();

        // Create x402 client
        const { httpClient } = createX402Client({ account });

        // Make the request
        const result = await makeX402Request(httpClient, url, {
          method,
          body,
          headers,
        });

        if (!result.success) {
          const errorResponse: Record<string, unknown> = {
            success: false,
            statusCode: result.statusCode,
            error: result.error,
          };

          // Include payment requirements if we got that far
          if (result.paymentRequired) {
            errorResponse.paymentRequired = {
              x402Version: result.paymentRequired.x402Version,
              requirements: result.paymentRequired.accepts.map((req) => ({
                network: req.network,
                networkName: getChainName(req.network),
                price: formatUSDC(BigInt(req.amount)),
                priceRaw: req.amount,
              })),
            };
          }

          return mcpError(result.error?.message || 'Request failed', errorResponse);
        }

        // Success response
        const response: Record<string, unknown> = {
          success: true,
          statusCode: result.statusCode,
          data: result.data,
        };

        // Add settlement info if payment was made
        if (result.settlement) {
          response.settlement = {
            transactionHash: result.settlement.transactionHash,
            network: result.settlement.network,
            networkName: getChainName(result.settlement.network),
            payer: address,
          };

          // Add amount paid from payment requirements
          if (result.paymentRequired?.accepts?.[0]) {
            response.settlement = {
              ...response.settlement as Record<string, unknown>,
              amountPaid: formatUSDC(BigInt(result.paymentRequired.accepts[0].amount)),
            };
          }
        }

        // Add protocol version info
        if (result.paymentRequired) {
          response.x402Version = result.paymentRequired.x402Version;
        }

        return mcpSuccess(response);
      } catch (err) {
        return mcpError(err, { tool: 'execute_call', url });
      }
    }
  );
}
