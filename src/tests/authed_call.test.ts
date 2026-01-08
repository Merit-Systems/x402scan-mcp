/**
 * Tests for authed_call handler
 *
 * Tests the actual authed_call logic with mocked fetch responses.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { handleAuthedCall } from '../tools/authed_call.js';
import {
  parseSIWxHeader,
  verifySIWxSignature,
  SOLANA_MAINNET,
} from '../vendor/sign-in-with-x/index.js';

// Test wallet
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const testAccount = privateKeyToAccount(TEST_PRIVATE_KEY);

// Create mock httpClient that returns our test data
function createMockHttpClient(paymentRequired: unknown) {
  return {
    getPaymentRequiredResponse: () => paymentRequired,
  } as any;
}

// Helper to check if result is an error
function isErrorResult(result: { content: { type: string; text: string }[]; isError?: boolean }): boolean {
  return result.isError === true;
}

// Create a mock 402 response (just needs status and headers.entries for our code)
function createMock402Response() {
  return {
    status: 402,
    ok: false,
    headers: {
      get: () => null,
      entries: () => [['content-type', 'application/json']],
    },
    json: async () => ({}),
    clone: () => ({ json: async () => ({}) }),
    text: async () => '{}',
  } as unknown as Response;
}

// Helper to create a success response
function createSuccessResponse(data: unknown) {
  return {
    status: 200,
    ok: true,
    headers: {
      get: (name: string) => name === 'content-type' ? 'application/json' : null,
      entries: () => [['content-type', 'application/json']],
    },
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

describe('handleAuthedCall', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: Mock;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('retries with SIGN-IN-WITH-X header on 402 with SIWX extension', async () => {
    const paymentRequired = {
      x402Version: 2,
      accepts: [{
        scheme: 'exact',
        network: 'base',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        amount: '1000000',
        payTo: '0x1234567890123456789012345678901234567890',
        maxTimeoutSeconds: 30,
      }],
      extensions: {
        'sign-in-with-x': {
          info: {
            domain: 'api.example.com',
            uri: 'https://api.example.com/resource',
            version: '1',
            chainId: 'eip155:8453',
            nonce: 'abc123xyz456',
            issuedAt: new Date().toISOString(),
            expirationTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          },
          schema: {},
        },
      },
    };

    // First call returns 402
    mockFetch.mockResolvedValueOnce(createMock402Response());
    // Second call succeeds
    mockFetch.mockResolvedValueOnce(createSuccessResponse({ success: true }));

    const result = await handleAuthedCall(
      { url: 'https://api.example.com/resource', method: 'GET' },
      {
        account: testAccount,
        address: testAccount.address,
        httpClient: createMockHttpClient(paymentRequired),
      }
    );

    // Should have made 2 requests
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify second call has SIGN-IN-WITH-X header
    const secondCall = mockFetch.mock.calls[1];
    const secondHeaders = secondCall[1].headers as Record<string, string>;
    expect(secondHeaders['SIGN-IN-WITH-X']).toBeDefined();

    // Verify the header contains a valid signed payload
    const siwxHeader = secondHeaders['SIGN-IN-WITH-X'];
    const parsed = parseSIWxHeader(siwxHeader);
    expect(parsed.address.toLowerCase()).toBe(testAccount.address.toLowerCase());
    expect(parsed.chainId).toBe('eip155:8453');
    expect(parsed.nonce).toBe('abc123xyz456');

    // Verify signature is valid
    const verification = await verifySIWxSignature(parsed);
    expect(verification.valid).toBe(true);

    // Verify result is success
    expect(isErrorResult(result)).toBe(false);
  });

  it('returns error for Solana chainId', async () => {
    const paymentRequired = {
      x402Version: 2,
      accepts: [{
        scheme: 'exact',
        network: 'base',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        amount: '1000000',
        payTo: '0x1234567890123456789012345678901234567890',
        maxTimeoutSeconds: 30,
      }],
      extensions: {
        'sign-in-with-x': {
          info: {
            domain: 'api.example.com',
            uri: 'https://api.example.com/resource',
            version: '1',
            chainId: SOLANA_MAINNET,
            nonce: 'abc123xyz456',
            issuedAt: new Date().toISOString(),
          },
          schema: {},
        },
      },
    };

    mockFetch.mockResolvedValueOnce(createMock402Response());

    const result = await handleAuthedCall(
      { url: 'https://api.example.com/resource', method: 'GET' },
      {
        account: testAccount,
        address: testAccount.address,
        httpClient: createMockHttpClient(paymentRequired),
      }
    );

    // Should only make 1 request (no retry for Solana)
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify error response
    expect(isErrorResult(result)).toBe(true);
    const content = result.content[0];
    expect(content.type).toBe('text');
    expect(content.text).toContain('Solana authentication not supported');
  });

  it('passes through non-402 responses', async () => {
    // Return success directly
    mockFetch.mockResolvedValueOnce(createSuccessResponse({ data: 'hello' }));

    const result = await handleAuthedCall(
      { url: 'https://api.example.com/resource', method: 'GET' },
      {
        account: testAccount,
        address: testAccount.address,
        httpClient: createMockHttpClient({}), // Won't be used
      }
    );

    // Should only make 1 request
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify success
    expect(isErrorResult(result)).toBe(false);
  });

  it('returns error for 402 without SIWX extension', async () => {
    const paymentRequired = {
      x402Version: 2,
      accepts: [{
        scheme: 'exact',
        network: 'base',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        amount: '1000000',
        payTo: '0x1234567890123456789012345678901234567890',
        maxTimeoutSeconds: 30,
      }],
      // No extensions
    };

    mockFetch.mockResolvedValueOnce(createMock402Response());

    const result = await handleAuthedCall(
      { url: 'https://api.example.com/resource', method: 'GET' },
      {
        account: testAccount,
        address: testAccount.address,
        httpClient: createMockHttpClient(paymentRequired),
      }
    );

    // Should only make 1 request
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify error
    expect(isErrorResult(result)).toBe(true);
    const content = result.content[0];
    expect(content.text).toContain('no sign-in-with-x extension found');
  });
});
