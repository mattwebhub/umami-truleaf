import { describe, expect, test, vi } from 'vitest';
import { UmamiAgentClient, type UmamiApiError } from './client';
import type { McpConfig } from './config';

const config: McpConfig = {
  baseUrl: 'https://analytics.example.com',
  websiteId: 'e79ef216-70ab-48df-addc-596b6e9e65a8',
  apiKey: `umami_sk_${'a'.repeat(43)}`,
  project: 'example',
  timezone: 'UTC',
  timeoutMs: 30_000,
};

describe('UmamiAgentClient', () => {
  test('binds the website and bearer key without returning credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ schemaVersion: '1.0', data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new UmamiAgentClient(config, fetcher);
    const result = await client.query({
      kind: 'snapshot',
      period: { preset: 'week', timezone: 'UTC' },
    });

    expect(result).toMatchObject({ schemaVersion: '1.0' });
    expect(fetcher).toHaveBeenCalledWith(
      `https://analytics.example.com/api/agent/v1/websites/${config.websiteId}/query`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: `Bearer ${config.apiKey}` }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
  });

  test('returns bounded API errors without leaking response bodies', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: 'Service key does not include the required scope', code: 'scope' },
        }),
        { status: 403 },
      ),
    );
    const client = new UmamiAgentClient(config, fetcher);

    await expect(client.catalog()).rejects.toEqual(
      expect.objectContaining<Partial<UmamiApiError>>({
        name: 'UmamiApiError',
        status: 403,
        code: 'scope',
      }),
    );
  });
});
