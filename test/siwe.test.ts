import { describe, it, expect } from 'bun:test';
import { privateKeyToAccount } from 'viem/accounts';
import { siweToCaip2, createProof, SIWE_NETWORKS } from '../src/siwe';

describe('siweToCaip2', () => {
  it('converts network names to CAIP-2', () => {
    expect(siweToCaip2('mainnet')).toBe('eip155:1');
    expect(siweToCaip2('base')).toBe('eip155:8453');
    expect(siweToCaip2('base-sepolia')).toBe('eip155:84532');
    expect(siweToCaip2('optimism')).toBe('eip155:10');
    expect(siweToCaip2('arbitrum')).toBe('eip155:42161');
    expect(siweToCaip2('polygon')).toBe('eip155:137');
    expect(siweToCaip2('sepolia')).toBe('eip155:11155111');
  });
});

describe('SIWE_NETWORKS', () => {
  it('contains expected networks', () => {
    expect(SIWE_NETWORKS).toContain('mainnet');
    expect(SIWE_NETWORKS).toContain('base');
    expect(SIWE_NETWORKS).toContain('base-sepolia');
    expect(SIWE_NETWORKS).toContain('optimism');
    expect(SIWE_NETWORKS).toContain('arbitrum');
    expect(SIWE_NETWORKS).toContain('polygon');
    expect(SIWE_NETWORKS).toContain('sepolia');
  });
});

describe('createProof', () => {
  const testKey = '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;
  const testAccount = privateKeyToAccount(testKey);

  it('creates valid proof structure', async () => {
    const result = await createProof(testAccount, {
      domain: 'api.example.com',
      uri: 'https://api.example.com',
      network: 'eip155:8453',
    });

    expect(result.proof).toBeDefined();
    expect(result.expiresAt).toBeDefined();

    const parsed = JSON.parse(result.proof);
    expect(parsed.domain).toBe('api.example.com');
    expect(parsed.uri).toBe('https://api.example.com');
    expect(parsed.address).toBe(testAccount.address);
    expect(parsed.version).toBe('1');
    expect(parsed.chainId).toBe('eip155:8453');
    expect(parsed.signature).toBeDefined();
    expect(parsed.nonce).toBeDefined();
    expect(parsed.issuedAt).toBeDefined();
    expect(parsed.expirationTime).toBeDefined();
    expect(parsed.resources).toEqual(['https://api.example.com']);
  });

  it('uses custom statement', async () => {
    const result = await createProof(testAccount, {
      domain: 'test.com',
      uri: 'https://test.com',
      network: 'eip155:1',
      statement: 'Custom auth message',
    });

    const parsed = JSON.parse(result.proof);
    expect(parsed.statement).toBe('Custom auth message');
  });

  it('uses default statement', async () => {
    const result = await createProof(testAccount, {
      domain: 'test.com',
      uri: 'https://test.com',
      network: 'eip155:1',
    });

    const parsed = JSON.parse(result.proof);
    expect(parsed.statement).toBe('Authenticate to API');
  });

  it('respects expiration time', async () => {
    const result = await createProof(testAccount, {
      domain: 'test.com',
      uri: 'https://test.com',
      network: 'eip155:1',
      expirationMinutes: 10,
    });

    const now = Date.now();
    const expiresAt = new Date(result.expiresAt).getTime();
    const diff = expiresAt - now;

    // Should be ~10 minutes (600000ms), allow some tolerance
    expect(diff).toBeGreaterThan(9 * 60 * 1000);
    expect(diff).toBeLessThan(11 * 60 * 1000);
  });

  it('throws for unknown network', async () => {
    await expect(
      createProof(testAccount, {
        domain: 'test.com',
        uri: 'https://test.com',
        network: 'unknown',
      })
    ).rejects.toThrow('Unknown network');
  });
});
