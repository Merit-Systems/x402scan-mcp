/**
 * MCP response helpers
 *
 * Standard response formatting for MCP tool results.
 */

/**
 * Create a successful MCP tool response
 */
export function mcpSuccess<T>(data: T): {
  content: { type: 'text'; text: string }[];
} {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Create an error MCP tool response
 */
export function mcpError(
  error: unknown,
  context?: Record<string, unknown>
): {
  content: { type: 'text'; text: string }[];
  isError: true;
} {
  let message: string;
  let details: Record<string, unknown> | undefined;

  if (error instanceof Error) {
    message = error.message;
    if ('cause' in error && error.cause) {
      details = { cause: String(error.cause) };
    }
  } else if (typeof error === 'string') {
    message = error;
  } else {
    message = String(error);
  }

  const errorResponse: Record<string, unknown> = {
    error: message,
  };

  if (details) {
    errorResponse.details = details;
  }

  if (context) {
    errorResponse.context = context;
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(errorResponse, null, 2),
      },
    ],
    isError: true,
  };
}

/**
 * Format USDC amount from raw units (6 decimals) to USD string
 */
export function formatUSDC(amount: bigint): string {
  const usd = Number(amount) / 1_000_000;
  return `$${usd.toFixed(2)}`;
}

/**
 * Format USDC amount from raw units (6 decimals) to number
 */
export function usdcToNumber(amount: bigint): number {
  return Number(amount) / 1_000_000;
}

/**
 * Parse USDC amount string to raw units
 */
export function parseUSDC(amount: string): bigint {
  // Remove $ prefix if present
  const cleaned = amount.replace(/^\$/, '').trim();
  const num = parseFloat(cleaned);
  return BigInt(Math.round(num * 1_000_000));
}
