/**
 * MCP server setup and tool registration
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerPaymentTools } from "./tools/payment";
import { registerAuthTools } from "./tools/auth";
import { registerWalletTools } from "./tools/wallet";

import { log } from "./log";
import { getWallet } from "./keystore";

export async function startServer(): Promise<void> {
  log.info("Starting x402scan-mcp...");

  const server = new McpServer({
    name: "x402scan",
    version: "0.0.7",
  });

  // get wallet
  const account = await getWallet();

  const props = {
    server,
    account,
  };

  registerPaymentTools(props);
  registerAuthTools(props);
  registerWalletTools(props);

  log.info(
    "Registered 5 tools: check_balance, query_endpoint, execute_call, authed_call"
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info(`Ready. Log file: ${log.path}`);

  const shutdown = async () => {
    log.info("Shutting down...");
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
