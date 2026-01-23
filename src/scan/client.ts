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
  statusCode: number;
  url: string;
  data?: ScanBalanceResponse;
  error?: string;
  rawText?: string;
}

export class ScanClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async getBalance(address: string): Promise<ScanBalanceResult> {
    const url = new URL(`/api/rpc/balance/${encodeURIComponent(address)}`, this.baseUrl).toString();

    if (!address || typeof address !== 'string') {
      return { success: false, statusCode: 0, url, error: 'Invalid address: expected non-empty string' };
    }

    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    } catch (err) {
      return {
        success: false,
        statusCode: 0,
        url,
        error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!res.ok) {
      const rawText = await res.text().catch(() => '');
      return {
        success: false,
        statusCode: res.status,
        url,
        error: `HTTP ${res.status}`,
        rawText,
      };
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      const rawText = await res.text().catch(() => '');
      return { success: false, statusCode: res.status, url, error: 'Invalid JSON response', rawText };
    }

    const parsed = ScanBalanceResponseSchema.safeParse(json);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: res.status,
        url,
        error: 'Unexpected response shape from balance endpoint',
        rawText: JSON.stringify({ issues: parsed.error.issues }),
      };
    }

    return { success: true, statusCode: res.status, url, data: parsed.data };
  }
}
