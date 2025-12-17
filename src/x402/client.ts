/**
 * x402 client wrapper
 *
 * Thin wrapper around @x402/core that handles wallet setup and provides
 * convenience methods for MCP tool implementations.
 */

import type { PrivateKeyAccount } from 'viem/accounts';
import { x402Client } from '@x402/core/client';
import { x402HTTPClient } from '@x402/core/http';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import type {
  PaymentRequired,
  PaymentPayload,
  SettleResponse,
  PaymentRequirements,
} from '@x402/core/types';
import { log, logPaymentRequired, logSignature, logSettlement } from '../utils/logger.js';
import { toCaip2 } from '../utils/networks.js';
import {
  normalizePaymentRequired,
  type NormalizedPaymentRequired,
  type NormalizedRequirement,
} from './normalize.js';

// Re-export types from @x402/core for convenience
export type {
  PaymentRequired,
  PaymentPayload,
  SettleResponse,
  PaymentRequirements,
} from '@x402/core/types';

// Re-export normalized types for downstream use
export type { NormalizedPaymentRequired, NormalizedRequirement } from './normalize.js';

export interface X402ClientConfig {
  account: PrivateKeyAccount;
  preferredNetwork?: string;
}

export interface RequestResult<T = unknown> {
  success: boolean;
  statusCode: number;
  data?: T;
  settlement?: {
    transactionHash: string;
    network: string;
    payer: string;
  };
  paymentRequired?: NormalizedPaymentRequired;
  error?: {
    phase: 'initial_request' | 'parse_requirements' | 'create_signature' | 'paid_request' | 'settlement';
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Create and configure an x402 client
 */
export function createX402Client(config: X402ClientConfig): {
  coreClient: x402Client;
  httpClient: x402HTTPClient;
} {
  const { account, preferredNetwork } = config;

  // Create core client with optional network preference selector
  const coreClient = new x402Client(
    preferredNetwork
      ? (_version, accepts) => {
          const preferred = accepts.find((a) => toCaip2(a.network) === toCaip2(preferredNetwork));
          return preferred || accepts[0];
        }
      : undefined
  );

  // Register EVM scheme for signing
  registerExactEvmScheme(coreClient, { signer: account });

  // Create HTTP client wrapper
  const httpClient = new x402HTTPClient(coreClient);

  return { coreClient, httpClient };
}

/**
 * Make a request to an x402-protected endpoint
 *
 * Handles the full 402 payment flow:
 * 1. Initial request
 * 2. Parse payment requirements from 402 response
 * 3. Create signed payment payload
 * 4. Retry with payment header
 * 5. Parse settlement response
 */
export async function makeX402Request<T = unknown>(
  httpClient: x402HTTPClient,
  url: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<RequestResult<T>> {
  const { method = 'GET', body, headers = {} } = options;

  // Phase 1: Initial request without payment
  log.debug(`Making initial request: ${method} ${url}`);

  let firstResponse: Response;
  try {
    firstResponse = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return {
      success: false,
      statusCode: 0,
      error: {
        phase: 'initial_request',
        message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  // If not 402, return the response as-is
  if (firstResponse.status !== 402) {
    if (firstResponse.ok) {
      try {
        const data = (await firstResponse.json()) as T;
        return {
          success: true,
          statusCode: firstResponse.status,
          data,
        };
      } catch {
        return {
          success: true,
          statusCode: firstResponse.status,
          data: (await firstResponse.text()) as unknown as T,
        };
      }
    } else {
      const errorText = await firstResponse.text();
      return {
        success: false,
        statusCode: firstResponse.status,
        error: {
          phase: 'initial_request',
          message: `HTTP ${firstResponse.status}: ${errorText}`,
        },
      };
    }
  }

  // Phase 2: Parse payment requirements
  log.debug('Got 402 Payment Required, parsing requirements...');

  let rawPaymentRequired: PaymentRequired;
  let paymentRequired: NormalizedPaymentRequired;
  let responseBody: unknown;
  try {
    // Try to get body for v1 compatibility
    try {
      responseBody = await firstResponse.clone().json();
    } catch {
      responseBody = undefined;
    }

    rawPaymentRequired = httpClient.getPaymentRequiredResponse(
      (name) => firstResponse.headers.get(name),
      responseBody
    );
    // Normalize v1/v2 responses to consistent format
    paymentRequired = normalizePaymentRequired(rawPaymentRequired);
    logPaymentRequired(rawPaymentRequired);
  } catch (err) {
    return {
      success: false,
      statusCode: 402,
      error: {
        phase: 'parse_requirements',
        message: `Failed to parse payment requirements: ${err instanceof Error ? err.message : String(err)}`,
        details: {
          headers: Object.fromEntries(firstResponse.headers.entries()),
          body: responseBody,
        },
      },
    };
  }

  // Phase 3: Create signed payment payload
  log.debug('Creating payment payload...');

  let paymentPayload: PaymentPayload;
  try {
    // Use raw (non-normalized) payment requirements for @x402/core SDK
    paymentPayload = await httpClient.createPaymentPayload(rawPaymentRequired);
    log.debug(`Payment created for network: ${paymentPayload.accepted?.network}`);
  } catch (err) {
    return {
      success: false,
      statusCode: 402,
      paymentRequired,
      error: {
        phase: 'create_signature',
        message: `Failed to create payment signature: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  // Encode payment header
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
  logSignature(paymentHeaders);

  // Phase 4: Retry with payment header
  log.debug('Retrying request with payment...');

  let paidResponse: Response;
  try {
    paidResponse = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...paymentHeaders,
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return {
      success: false,
      statusCode: 0,
      paymentRequired,
      error: {
        phase: 'paid_request',
        message: `Network error on paid request: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  if (!paidResponse.ok) {
    const errorText = await paidResponse.text();
    return {
      success: false,
      statusCode: paidResponse.status,
      paymentRequired,
      error: {
        phase: 'paid_request',
        message: `HTTP ${paidResponse.status} after payment: ${errorText}`,
        details: {
          headers: Object.fromEntries(paidResponse.headers.entries()),
        },
      },
    };
  }

  // Phase 5: Parse settlement response
  let settlement: RequestResult<T>['settlement'];
  try {
    const settleResponse = httpClient.getPaymentSettleResponse(
      (name) => paidResponse.headers.get(name)
    );
    logSettlement(settleResponse);
    settlement = {
      transactionHash: settleResponse.transaction,
      network: settleResponse.network,
      payer: settleResponse.payer || paymentPayload.accepted?.payTo || '',
    };
  } catch (err) {
    // Settlement header may not be present in all cases
    log.debug(`Could not parse settlement response: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Parse response data
  let data: T;
  try {
    data = (await paidResponse.json()) as T;
  } catch {
    data = (await paidResponse.text()) as unknown as T;
  }

  return {
    success: true,
    statusCode: paidResponse.status,
    data,
    settlement,
    paymentRequired,
  };
}

/**
 * Query an endpoint for payment requirements without making a payment
 *
 * Makes a request without payment header to get 402 response with requirements.
 */
export async function queryEndpoint(
  url: string,
  httpClient: x402HTTPClient,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<{
  success: boolean;
  statusCode: number;
  x402Version?: number;
  paymentRequired?: NormalizedPaymentRequired;
  error?: string;
  parseErrors?: string[];
  rawHeaders?: Record<string, string>;
  rawBody?: unknown;
}> {
  const { method = 'GET', body, headers = {} } = options;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return {
      success: false,
      statusCode: 0,
      error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const rawHeaders = Object.fromEntries(response.headers.entries());

  // If not 402, the endpoint doesn't require payment
  if (response.status !== 402) {
    return {
      success: true,
      statusCode: response.status,
      rawHeaders,
    };
  }

  // Try to parse body for v1 compatibility
  let rawBody: unknown;
  try {
    rawBody = await response.json();
  } catch {
    rawBody = undefined;
  }

  // Parse payment requirements
  try {
    const rawPaymentRequired = httpClient.getPaymentRequiredResponse(
      (name) => response.headers.get(name),
      rawBody
    );
    // Normalize v1/v2 responses to consistent format
    const paymentRequired = normalizePaymentRequired(rawPaymentRequired);

    return {
      success: true,
      statusCode: 402,
      x402Version: paymentRequired.x402Version,
      paymentRequired,
      rawHeaders,
      rawBody,
    };
  } catch (err) {
    return {
      success: false,
      statusCode: 402,
      error: `Failed to parse payment requirements: ${err instanceof Error ? err.message : String(err)}`,
      parseErrors: [err instanceof Error ? err.message : String(err)],
      rawHeaders,
      rawBody,
    };
  }
}
