# SIWX Base64 Encoding Migration

## Background

The x402 v2 specification (CHANGELOG-v2.md line 335) requires the `SIGN-IN-WITH-X` header to be **base64-encoded**:

> Client sends signed SIWx message in SIGN-IN-WITH-X header (base64-encoded)

Currently, x402scan-mcp sends raw JSON in the `SIGN-IN-WITH-X` header. This needs to be updated for spec compliance.

## Why Base64?

1. **Spec Compliance**: Aligns with x402 v2 HTTP transport specification
2. **Header Safety**: Base64 encoding avoids issues with special characters in HTTP headers
3. **Consistency**: Matches `PAYMENT-REQUIRED` header which is also base64-encoded
4. **Interoperability**: Ensures compatibility with canonical x402 SDK implementations

## Current Implementation

### `src/siwe.ts` (lines 78-92)

```typescript
return {
  proof: JSON.stringify({
    domain: opts.domain,
    address: account.address,
    statement,
    uri: opts.uri,
    version: '1',
    chainId: opts.network,
    nonce,
    issuedAt,
    expirationTime,
    resources: [opts.uri],
    signature,
  }),
  expiresAt: expirationTime,
};
```

### `src/tools/auth.ts` (lines 75-82)

```typescript
const response = await fetch(url, {
  method,
  headers: {
    'Content-Type': 'application/json',
    'SIGN-IN-WITH-X': proof,  // Raw JSON
    ...headers,
  },
  body: body ? JSON.stringify(body) : undefined,
});
```

## Required Changes

### 1. Update `src/siwe.ts`

Change `createProof()` to return base64-encoded proof:

```typescript
export async function createProof(
  account: PrivateKeyAccount,
  opts: ProofOptions
): Promise<ProofResult> {
  // ... existing code ...

  const payload = {
    domain: opts.domain,
    address: account.address,
    statement,
    uri: opts.uri,
    version: '1',
    chainId: opts.network,
    nonce,
    issuedAt,
    expirationTime,
    resources: [opts.uri],
    signature,
  };

  return {
    proof: Buffer.from(JSON.stringify(payload)).toString('base64'),  // Base64 encode
    expiresAt: expirationTime,
  };
}
```

### 2. No changes needed to `src/tools/auth.ts`

The header assignment remains the same - it just receives base64 now:

```typescript
'SIGN-IN-WITH-X': proof,  // Now base64-encoded
```

### 3. Update tool descriptions (optional)

Update the `create_siwe_proof` tool description to mention base64:

```typescript
server.registerTool(
  'create_siwe_proof',
  {
    description: 'Create a CAIP-122 compliant Sign-In-With-X proof for wallet authentication. Returns base64-encoded proof for SIGN-IN-WITH-X header.',
    // ...
  }
);
```

## Migration Notes

- This is a **breaking change** for servers expecting raw JSON
- The canonical x402 server implementation (`@x402/extensions/sign-in-with-x`) will support both base64 and raw JSON for backwards compatibility
- StableStudio server needs parallel update to accept base64

## Testing

After changes:
1. Verify `create_siwe_proof` returns base64 string
2. Verify `fetch_with_siwe` sends base64 in header
3. Test against StableStudio (after its update)

## Files to Modify

- `src/siwe.ts` - Change proof encoding to base64
- `src/tools/auth.ts` - Update description (optional)
