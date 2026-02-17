/**
 * MCP response helpers
 */

export function mcpSuccess<T>(data: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function mcpError(error: unknown, context?: Record<string, unknown>) {
  let message: string;
  let details: Record<string, unknown> | undefined;

  if (error instanceof Error) {
    message = error.message;
    if ('cause' in error && error.cause) {
      details = { cause: String(error.cause) };
    }
  } else if (typeof error === 'string') {
    message = error;
  } else if (typeof error === 'object' && error !== null) {
    try {
      message = JSON.stringify(error);
    } catch {
      message = Object.prototype.toString.call(error);
    }
  } else {
    message = String(error);
  }

  const payload: Record<string, unknown> = { error: message };
  if (details) payload.details = details;
  if (context) payload.context = context;

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    isError: true as const,
  };
}

/** Format USDC amount from raw units (6 decimals) to USD string */
export function formatUSDC(amount: bigint): string {
  return `$${(Number(amount) / 1_000_000).toFixed(2)}`;
}

/** Parse USDC amount string to raw units */
export function parseUSDC(amount: string): bigint {
  const cleaned = amount.trim().replace(/^\$/, '');
  return BigInt(Math.round(parseFloat(cleaned) * 1_000_000));
}
