/**
 * Keystore - private key management
 *
 * Stores wallet at ~/.x402scan-mcp/wallet.json
 * Can be overridden via X402_PRIVATE_KEY env var
 */

import { randomBytes } from 'crypto';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import * as fs from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { log } from './log';

const KEYSTORE_DIR = join(homedir(), '.x402scan-mcp');
const KEYSTORE_FILE = join(KEYSTORE_DIR, 'wallet.json');

interface StoredWallet {
  privateKey: `0x${string}`;
  address: `0x${string}`;
  createdAt: string;
}

export interface Wallet {
  account: PrivateKeyAccount;
  address: `0x${string}`;
  isNew: boolean;
}

export async function getWallet(): Promise<Wallet> {
  // Environment override
  if (process.env.X402_PRIVATE_KEY) {
    const account = privateKeyToAccount(process.env.X402_PRIVATE_KEY as `0x${string}`);
    log.info(`Using wallet from env: ${account.address}`);
    return { account, address: account.address, isNew: false };
  }

  // Try loading existing
  try {
    const data = await fs.readFile(KEYSTORE_FILE, 'utf-8');
    const stored: StoredWallet = JSON.parse(data);
    const account = privateKeyToAccount(stored.privateKey);
    log.info(`Loaded wallet: ${account.address}`);
    return { account, address: account.address, isNew: false };
  } catch {
    // File doesn't exist or is invalid, generate new wallet
  }

  // Generate new
  const privateKey = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  const stored: StoredWallet = {
    privateKey,
    address: account.address,
    createdAt: new Date().toISOString(),
  };

  await fs.mkdir(KEYSTORE_DIR, { recursive: true });
  await fs.writeFile(KEYSTORE_FILE, JSON.stringify(stored, null, 2));
  try {
    await fs.chmod(KEYSTORE_FILE, 0o600);
  } catch {}

  log.info(`Created wallet: ${account.address}`);
  log.info(`Saved to: ${KEYSTORE_FILE}`);
  return { account, address: account.address, isNew: true };
}

/** Check if wallet exists without creating one */
export async function walletExists(): Promise<boolean> {
  if (process.env.X402_PRIVATE_KEY) return true;
  try {
    await fs.access(KEYSTORE_FILE);
    return true;
  } catch {
    return false;
  }
}

export const keystorePath = KEYSTORE_FILE;
export const keystoreDir = KEYSTORE_DIR;

// Cached wallet address for tracking headers (loaded lazily)
let cachedWalletAddress: `0x${string}` | null = null;

/**
 * Get tracking headers for x402 requests
 * Includes Referer and wallet address for provider support
 */
export async function getClientIdentifierHeaders(): Promise<Record<string, string>> {
  // Lazily load wallet address if not cached
  if (!cachedWalletAddress) {
    const { address } = await getWallet();
    cachedWalletAddress = address;
  }

  return {
    Referer: 'x402scan-mcp',
    'X-Wallet-Address': cachedWalletAddress,
  };
}
