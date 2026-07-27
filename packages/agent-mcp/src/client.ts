import type { McpConfig } from './config';

export type Period =
  | { preset: 'day' | 'week' | 'month'; timezone: string }
  | { startAt: string; endAt: string; timezone: string };

export type Query =
  | { kind: 'snapshot'; period: Period }
  | { kind: 'timeseries'; period: Period; unit?: 'hour' | 'day' | 'month' }
  | {
      kind: 'breakdown';
      period: Period;
      dimension:
        | 'path'
        | 'referrer'
        | 'title'
        | 'hostname'
        | 'utmSource'
        | 'utmMedium'
        | 'utmCampaign'
        | 'country'
        | 'region'
        | 'city'
        | 'browser'
        | 'os'
        | 'device'
        | 'language';
      limit?: number;
    }
  | { kind: 'product'; period: Period }
  | { kind: 'content'; period: Period }
  | { kind: 'quality'; period: Period }
  | { kind: 'moderation'; limit?: number };

export class UmamiApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'UmamiApiError';
  }
}

export class UmamiAgentClient {
  constructor(
    private readonly config: McpConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  get catalogUrl() {
    return `/api/agent/v1/websites/${this.config.websiteId}/catalog`;
  }

  get queryUrl() {
    return `/api/agent/v1/websites/${this.config.websiteId}/query`;
  }

  async catalog() {
    return this.request(this.catalogUrl);
  }

  async query(query: Query) {
    return this.request(this.queryUrl, query);
  }

  private async request(path: string, body?: Query): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await this.fetcher(`${this.config.baseUrl}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: unknown;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        throw new UmamiApiError('Umami returned a non-JSON response', response.status);
      }

      if (!response.ok) {
        const error =
          typeof payload === 'object' && payload
            ? (payload as { error?: { message?: string; code?: string } }).error
            : undefined;
        throw new UmamiApiError(
          error?.message || `Umami request failed with HTTP ${response.status}`,
          response.status,
          error?.code,
        );
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new UmamiApiError('Umami returned an unexpected response shape', response.status);
      }

      return payload as Record<string, unknown>;
    } catch (error) {
      if (error instanceof UmamiApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new UmamiApiError(`Umami request timed out after ${this.config.timeoutMs}ms`);
      }
      throw new UmamiApiError(
        `Unable to reach Umami: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
