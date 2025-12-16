/**
 * File logger for MCP server debugging
 * Logs to ~/.x402-mcp/mcp.log and stderr
 */

import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LOG_DIR = join(homedir(), '.x402scan-mcp');
const LOG_FILE = join(LOG_DIR, 'mcp.log');

// Ensure log directory exists
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch {
  // Directory may already exist
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(' ');
}

function writeLog(level: string, message: string, ...args: unknown[]): void {
  const formatted = args.length > 0 ? `${message} ${formatArgs(args)}` : message;
  const line = `[${formatTimestamp()}] [${level}] ${formatted}\n`;

  // Write to log file
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // Silently fail if we can't write
  }

  // Also write to stderr for MCP protocol / Cursor debugging
  console.error(`[x402scan] ${formatted}`);
}

export const log = {
  info: (message: string, ...args: unknown[]) => writeLog('INFO', message, ...args),
  error: (message: string, ...args: unknown[]) => writeLog('ERROR', message, ...args),
  debug: (message: string, ...args: unknown[]) => writeLog('DEBUG', message, ...args),

  /** Clear the log file (adds separator) */
  clear: () => {
    try {
      appendFileSync(LOG_FILE, `\n--- Log cleared at ${formatTimestamp()} ---\n`);
    } catch {
      // Silently fail
    }
  },

  /** Get log file path */
  path: LOG_FILE,
};

// Legacy exports for compatibility
const DEBUG = process.env.X402_DEBUG === 'true';

export function logInfo(message: string): void {
  log.info(message);
}

export function logError(message: string, error?: unknown): void {
  if (error) {
    log.error(message, error);
  } else {
    log.error(message);
  }
}

export function logPaymentRequired(pr: unknown): void {
  if (DEBUG) {
    log.debug('Payment required:', pr);
  }
}

export function logSignature(headers: Record<string, string>): void {
  if (DEBUG) {
    log.debug('Payment headers:', Object.keys(headers).join(', '));
  }
}

export function logSettlement(response: unknown): void {
  if (DEBUG) {
    log.debug('Settlement response:', response);
  }
}

// Debug-only log (only logs if X402_DEBUG=true)
export function logDebug(...args: unknown[]): void {
  if (DEBUG) {
    log.debug(formatArgs(args));
  }
}
