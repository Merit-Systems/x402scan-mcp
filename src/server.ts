/**
 * MCP server setup and tool registration
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { log } from './log';
import { registerPaymentTools } from './tools/payment';
import { registerAuthTools } from './tools/auth';
import { registerWalletTools } from './tools/wallet';

export async function startServer(): Promise<void> {
  log.info('Starting x402scan-mcp...');

  const server = new McpServer({
    name: 'x402scan',
    version: '0.0.6',
  });

  registerPaymentTools(server);
  registerAuthTools(server);
  registerWalletTools(server);

  log.info('Registered 6 tools: check_balance, query_endpoint, validate_payment, execute_call, create_siwe_proof, fetch_with_siwe');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info(`Ready. Log file: ${log.path}`);

  const shutdown = async () => {
    log.info('Shutting down...');
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
