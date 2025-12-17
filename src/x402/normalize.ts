/**
 * x402 v1/v2 normalization layer
 *
 * Converts v1 and v2 payment requirements to a single internal format.
 * All downstream code should use the normalized types.
 */

import type { PaymentRequired, PaymentRequirements } from '@x402/core/types';

// Normalized internal types (always use these downstream)
export interface NormalizedRequirement {
  scheme: string;
  network: string;
  amount: string; // Always 'amount' internally (mapped from maxAmountRequired in v1)
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
  // v1-only fields preserved for display
  resource?: string;
  description?: string;
  mimeType?: string;
}

export interface NormalizedPaymentRequired {
  x402Version: number;
  error?: string;
  accepts: NormalizedRequirement[];
  // v2 resource info (separate object in v2, embedded in accepts in v1)
  resource?: { url: string; description: string; mimeType: string };
  extensions?: Record<string, unknown>;
}

// v1 raw requirement type (from server response)
interface RawV1Requirement {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  outputSchema?: Record<string, unknown>;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: Record<string, unknown>;
}

/**
 * Type guard to detect v1 response format
 * v1 uses maxAmountRequired, v2 uses amount
 */
export function isV1Response(pr: unknown): boolean {
  if (!pr || typeof pr !== 'object') return false;
  const obj = pr as Record<string, unknown>;

  // Check x402Version first
  if (obj.x402Version === 1) return true;

  // Check if accepts array has v1 field
  const accepts = obj.accepts;
  if (Array.isArray(accepts) && accepts.length > 0) {
    return 'maxAmountRequired' in accepts[0];
  }

  return false;
}

/**
 * Normalize a v1 payment requirement
 * Maps maxAmountRequired -> amount and preserves v1-specific fields
 */
function normalizeV1Requirement(req: RawV1Requirement): NormalizedRequirement {
  if (!req.maxAmountRequired) {
    throw new Error('v1 requirement missing maxAmountRequired field');
  }
  return {
    scheme: req.scheme,
    network: req.network,
    amount: req.maxAmountRequired, // Map to unified 'amount' field
    asset: req.asset,
    payTo: req.payTo,
    maxTimeoutSeconds: req.maxTimeoutSeconds,
    extra: req.extra,
    // Preserve v1-specific embedded resource fields
    resource: req.resource,
    description: req.description,
    mimeType: req.mimeType,
  };
}

/**
 * Normalize a v2 payment requirement
 * Validates amount exists and passes through fields
 */
function normalizeV2Requirement(req: PaymentRequirements): NormalizedRequirement {
  if (!req.amount) {
    throw new Error('v2 requirement missing amount field');
  }
  return {
    scheme: req.scheme,
    network: req.network,
    amount: req.amount,
    asset: req.asset,
    payTo: req.payTo,
    maxTimeoutSeconds: req.maxTimeoutSeconds,
    extra: req.extra,
  };
}

/**
 * Main normalization entry point
 * Detects version and normalizes to consistent internal format
 */
export function normalizePaymentRequired(
  pr: PaymentRequired | Record<string, unknown>
): NormalizedPaymentRequired {
  const version = (pr as { x402Version?: number }).x402Version ?? 1;

  if (isV1Response(pr)) {
    const v1Pr = pr as { error?: string; accepts: RawV1Requirement[] };
    return {
      x402Version: 1,
      error: v1Pr.error,
      accepts: v1Pr.accepts.map(normalizeV1Requirement),
    };
  } else {
    const v2Pr = pr as PaymentRequired;
    return {
      x402Version: version,
      error: v2Pr.error,
      accepts: v2Pr.accepts.map(normalizeV2Requirement),
      resource: v2Pr.resource,
      extensions: v2Pr.extensions,
    };
  }
}
