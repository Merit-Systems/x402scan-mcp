/**
 * Wallet manager for x402scan-mcp
 *
 * Handles key generation, storage, and wallet client creation.
 * Cross-platform compatible (macOS, Windows, Linux).
 */

import { randomBytes } from 'crypto';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { logInfo, logError } from '../utils/logger.js';

export interface WalletConfig {
  privateKey: `0x${string}`;
  address: `0x${string}`;
  createdAt: string;
}

const WALLET_DIR = path.join(os.homedir(), '.x402scan-mcp');
const WALLET_FILE = path.join(WALLET_DIR, 'wallet.json');

/**
 * Generate a new random private key
 */
function generatePrivateKey(): `0x${string}` {
  return `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
}

/**
 * Load wallet config from disk
 */
async function loadWalletConfig(): Promise<WalletConfig | null> {
  try {
    const data = await fs.readFile(WALLET_FILE, 'utf-8');
    return JSON.parse(data) as WalletConfig;
  } catch {
    return null;
  }
}

/**
 * Save wallet config to disk with restrictive permissions
 */
async function saveWalletConfig(config: WalletConfig): Promise<void> {
  await fs.mkdir(WALLET_DIR, { recursive: true });
  await fs.writeFile(WALLET_FILE, JSON.stringify(config, null, 2));
  // Set restrictive permissions (owner read/write only)
  // This is a no-op on Windows but works on Unix systems
  try {
    await fs.chmod(WALLET_FILE, 0o600);
  } catch {
    // Ignore chmod errors on Windows
  }
}

/**
 * Get or create wallet
 * Returns the account and wallet config
 */
export async function getOrCreateWallet(): Promise<{
  account: PrivateKeyAccount;
  address: `0x${string}`;
  config: WalletConfig;
  isNew: boolean;
}> {
  // Check for environment variable override
  const envPrivateKey = process.env.X402_PRIVATE_KEY as `0x${string}` | undefined;

  let privateKey: `0x${string}`;
  let address: `0x${string}`;
  let config: WalletConfig;
  let isNew = false;

  if (envPrivateKey) {
    // Use environment variable
    privateKey = envPrivateKey;
    const account = privateKeyToAccount(privateKey);
    address = account.address;
    config = {
      privateKey,
      address,
      createdAt: new Date().toISOString(),
    };
    logInfo(`Using wallet from environment: ${address}`);
  } else {
    // Try to load from file
    const existingConfig = await loadWalletConfig();

    if (!existingConfig) {
      // Generate new wallet
      privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);
      address = account.address;

      config = {
        privateKey,
        address,
        createdAt: new Date().toISOString(),
      };

      await saveWalletConfig(config);
      isNew = true;
      logInfo(`Generated new wallet: ${address}`);
      logInfo(`Wallet saved to: ${WALLET_FILE}`);
    } else {
      config = existingConfig;
      privateKey = config.privateKey;
      address = config.address;
      logInfo(`Loaded wallet: ${address}`);
    }
  }

  const account = privateKeyToAccount(privateKey);
  return { account, address, config, isNew };
}

/**
 * Get wallet file path (for display purposes)
 */
export function getWalletFilePath(): string {
  return WALLET_FILE;
}

/**
 * Get wallet directory path
 */
export function getWalletDir(): string {
  return WALLET_DIR;
}

/**
 * Check if wallet exists
 */
export async function walletExists(): Promise<boolean> {
  if (process.env.X402_PRIVATE_KEY) {
    return true;
  }
  const config = await loadWalletConfig();
  return config !== null;
}
