import { z } from 'zod';

export interface ScanBalanceResponse {
  address: string;
  chain: number;
  balance: string;
  rawBalance: string;
}

const ScanBalanceResponseSchema = z.object({
  address: z.string(),
  chain: z.number(),
  balance: z.string(),
  rawBalance: z.string(),
});

export interface ScanBalanceResult {
  success: boolean;
  data?: ScanBalanceResponse;
  error?: string;
}

export class ScanClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async getBalance(address: string): Promise<ScanBalanceResult> {
    const url = new URL(`/api/rpc/balance/${encodeURIComponent(address)}`, this.baseUrl).toString();

    if (!address || typeof address !== 'string') {
      return { success: false, error: 'Invalid address: expected non-empty string' };
    }

    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    } catch (err) {
      return {
        success: false,
        error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!res.ok) {
      return {
        success: false,
        error: `HTTP ${res.status}`,
      };
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { success: false, error: 'Invalid JSON response' };
    }

    const parsed = ScanBalanceResponseSchema.safeParse(json);
    if (!parsed.success) {
      return {
        success: false,
        error: 'Unexpected response shape from balance endpoint',
      };
    }

    return { success: true, data: parsed.data };
  }
}
