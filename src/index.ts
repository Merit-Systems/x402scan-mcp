#!/usr/bin/env node

/**
 * x402scan-mcp
 *
 * Generic MCP server for calling x402-protected APIs.
 * Handles wallet management, payment signing, and protocol negotiation (v1/v2).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerCheckBalanceTool } from './tools/check_balance.js';
import { registerQueryEndpointTool } from './tools/query_endpoint.js';
import { registerValidatePaymentTool } from './tools/validate_payment.js';
import { registerExecuteCallTool } from './tools/execute_call.js';
import { registerAuthedCallTool } from './tools/authed_call.js';
import { log } from './utils/logger.js';

async function main() {
  log.clear();
  log.info('Starting x402scan-mcp server...');

  // Create MCP server
  const server = new McpServer({
    name: 'x402scan',
    version: '0.0.1',
  });

  // Register all tools
  registerCheckBalanceTool(server);
  registerQueryEndpointTool(server);
  registerValidatePaymentTool(server);
  registerExecuteCallTool(server);
  registerAuthedCallTool(server);

  log.info('Registered 5 tools: check_balance, query_endpoint, validate_payment, execute_call, authed_call');

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info(`Connected to transport, ready for requests. Log file: ${log.path}`);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    log.info('Shutting down...');
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    log.info('Shutting down...');
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  log.error('Fatal error', error);
  process.exit(1);
});
