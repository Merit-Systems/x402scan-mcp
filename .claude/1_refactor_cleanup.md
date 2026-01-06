# Refactor & Cleanup

The codebase works but feels scattered - too many directories, duplicated code between SIWE tools, a grab-bag `utils/` folder, and unnecessary `.js` import extensions everywhere. This refactor consolidates to a cleaner structure where every file has a clear purpose, adds unit tests for the schema validation logic, and removes the cruft.

---

## Target Structure

```
src/
├── index.ts              # Entry point
├── server.ts             # MCP server setup + tool registration
├── networks.ts           # CAIP-2 chain configs (root - used by x402 and siwe)
├── keystore.ts           # Private key management
├── balance.ts            # USDC balance reading
├── siwe.ts               # SIWE proof creation
├── log.ts                # Logger
├── response.ts           # mcpSuccess/mcpError helpers
├── x402/                 # Protocol layer
│   ├── client.ts         # x402 HTTP client + parse-only client
│   └── protocol.ts       # v1/v2 normalization, V1 schema extraction
└── tools/                # Thin orchestration layer
    ├── payment.ts        # query_endpoint, validate_payment, execute_call
    ├── auth.ts           # create_siwe_proof, fetch_with_siwe
    └── wallet.ts         # check_balance

test/
├── protocol.test.ts      # v1/v2 normalization, schema extraction
├── networks.test.ts      # CAIP-2 conversion, chain lookups
├── siwe.test.ts          # Proof creation (mocked signing)
└── response.test.ts      # Response helpers, USDC formatting
```

## Abstraction Layers

**Tools** - thin orchestration (~30-50 lines each after refactor):
1. Validate params (zod)
2. Get wallet if needed
3. Call domain function
4. Format response

**Domain** - hides complexity:
- `x402/client.ts` - tools call `makeRequest()`, don't know about 5-phase flow
- `x402/protocol.ts` - tools get normalized data, don't know v1 vs v2
- `keystore.ts` - tools call `getWallet()`, don't care if from env or file
- `siwe.ts` - tools call `createProof()`, don't build SIWE messages
- `balance.ts` - tools call `getUSDCBalance()`, don't touch viem directly

**Infrastructure** - shared utilities:
- `networks.ts` - chain configs used by both x402 and siwe
- `log.ts` - logging
- `response.ts` - MCP response formatting

---

## Changes

### 1. Remove `.js` Import Extensions

With `moduleResolution: "bundler"` and tsup, explicit `.js` extensions are unnecessary. Remove them everywhere:

```typescript
// Before
import { log } from '../utils/logger.js';

// After
import { log } from '../log';
```

### 2. Structural Consolidation

| Old | New | Notes |
|-----|-----|-------|
| `src/utils/logger.ts` | `src/log.ts` | Simplified API |
| `src/utils/helpers.ts` | `src/response.ts` | Clearer name |
| `src/utils/networks.ts` | `src/networks.ts` | Root level (used by x402 + siwe) |
| `src/wallet/manager.ts` | `src/keystore.ts` | Flattened |
| `src/balance/usdc.ts` | `src/balance.ts` | Flattened |
| `src/x402/normalize.ts` | `src/x402/protocol.ts` | Merged + V1 extraction |
| `src/tools/*.ts` (6 files) | `src/tools/*.ts` (3 files) | Grouped by purpose |

Delete after migration:
- `src/utils/` directory
- `src/wallet/` directory
- `src/balance/` directory

### 3. Logger Cleanup

Single export, no legacy functions:

```typescript
export const log = {
  info: (msg: string, ...args: unknown[]) => write('INFO', msg, args),
  error: (msg: string, ...args: unknown[]) => write('ERROR', msg, args),
  debug: (msg: string, ...args: unknown[]) => DEBUG && write('DEBUG', msg, args),
  path: LOG_FILE,
};
```

### 4. SIWE Deduplication

Extract shared logic to `src/siwe.ts`:
- `SIWE_NETWORKS` constant (used in zod schemas)
- `toCaip2()` for network conversion
- `createProof()` for proof generation

Both `tools/auth.ts` tools import from here.

### 5. Parse-Only Client

Add cached client in `x402/client.ts` for query operations:

```typescript
let parseClient: x402HTTPClient | null = null;
const DUMMY_KEY = '0x0000000000000000000000000000000000000000000000000000000000000001';

export function getParseClient(): x402HTTPClient {
  if (!parseClient) {
    const core = new x402Client();
    registerExactEvmScheme(core, { signer: privateKeyToAccount(DUMMY_KEY) });
    parseClient = new x402HTTPClient(core);
  }
  return parseClient;
}
```

### 6. Unit Tests

Add `bun:test` for pure functions that don't need network:

**`test/protocol.test.ts`**
- `normalizePaymentRequired()` with v1 input → normalized output
- `normalizePaymentRequired()` with v2 input → normalized output
- `isV1Response()` detection
- `extractV1Schema()` extraction

**`test/networks.test.ts`**
- `toCaip2()` conversions (v1 name → CAIP-2)
- `getChainConfig()` lookups
- `getChainId()` extraction
- `isTestnet()` detection

**`test/siwe.test.ts`**
- `toCaip2()` for SIWE networks
- Proof structure validation (mock the signing)

**`test/response.test.ts`**
- `mcpSuccess()` response shape
- `mcpError()` with Error vs string
- `formatUSDC()` formatting

Add to package.json:
```json
"scripts": {
  "test": "bun test"
}
```

---

## Migration Order

1. Add test infrastructure + write tests for existing code
2. Create new flat files (`log.ts`, `mcp.ts`, `keystore.ts`, `balance.ts`, `siwe.ts`)
3. Restructure `x402/` (merge normalize → protocol, add parse client)
4. Create grouped tool files
5. Update `server.ts` + `index.ts`
6. Remove `.js` extensions globally
7. Delete old directories
8. Verify: `bun run build && bun run typecheck && bun test`
