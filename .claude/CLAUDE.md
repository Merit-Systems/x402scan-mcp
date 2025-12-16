# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
bun install              # Install dependencies
bun run build            # Build for npm (tsup)
bun run build:mcpb       # Build bundled .mcpb for Claude Desktop
bun run dev              # Run with tsx
bun run dev:bun          # Run with bun
bun run typecheck        # TypeScript type checking
```

For local development with Claude Code:
```bash
claude mcp add x402scan-dev -- bun run /path/to/x402scan-mcp/src/index.ts
```

## Architecture

This is an MCP (Model Context Protocol) server that enables AI assistants to make payments to x402-protected APIs. The x402 protocol uses HTTP 402 Payment Required responses to negotiate cryptocurrency payments.

### Core Flow

1. **Wallet Management** (`src/wallet/manager.ts`): Auto-generates and persists an EVM wallet at `~/.x402scan-mcp/wallet.json`. Can be overridden via `X402_PRIVATE_KEY` env var.

2. **x402 Client** (`src/x402/client.ts`): Wraps `@x402/core` and `@x402/evm` libraries. Handles the 402 payment flow:
   - Initial request → 402 response with payment requirements
   - Parse requirements (supports both x402 v1 and v2 protocols)
   - Sign payment with EVM wallet
   - Retry request with payment header
   - Parse settlement response

3. **MCP Tools** (`src/tools/`): Four tools exposed to AI assistants:
   - `check_balance` - Wallet address and USDC balance
   - `query_endpoint` - Probe endpoint for pricing without payment
   - `validate_payment` - Pre-flight payment check
   - `execute_call` - Make paid API request

### Key Dependencies

- `@modelcontextprotocol/sdk` - MCP server implementation
- `@x402/core`, `@x402/evm` - x402 payment protocol
- `viem` - EVM wallet/chain interactions
- `zod` - Tool parameter validation

### Network Support

Configured in `src/utils/networks.ts` with CAIP-2 identifiers. Supports Base, Base Sepolia, Ethereum, Optimism, Arbitrum, Polygon. USDC addresses are hardcoded per network.

### Build Outputs

tsup produces two builds:
- `dist/` - Standard ESM with external deps (for npm)
- `dist-bundle/` - Single bundled file (for .mcpb packaging)
