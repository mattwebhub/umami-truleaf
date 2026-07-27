import { beforeEach, expect, test, vi } from 'vitest';
import { getProductCockpitData } from '@/lib/product-cockpit/service';
import { authenticateServiceApiKey, recordServiceApiKeyAuditSafely } from '@/lib/service-api-key';
import { getWebsiteStats } from '@/queries/sql';
import { POST } from './route';

vi.mock('@/lib/service-api-key', () => ({
  authenticateServiceApiKey: vi.fn(),
  enforceAgentApiIngressLimit: vi.fn(async () => false),
  recordServiceApiKeyAuditSafely: vi.fn(),
}));
vi.mock('@/lib/product-cockpit/service', () => ({
  getProductCockpitData: vi.fn(async () => ({ enabled: false })),
  getProductCockpitGroupCount: vi.fn(() => 0),
  getProductContentData: vi.fn(async () => ({ enabled: false })),
}));
vi.mock('@/lib/prisma', () => ({
  default: { client: { sessionReview: { count: vi.fn() } } },
}));
vi.mock('@/queries/sql', () => ({
  getWebsiteStats: vi.fn(),
  getPageviewStats: vi.fn(),
  getSessionStats: vi.fn(),
  getPageviewMetrics: vi.fn(),
  getSessionMetrics: vi.fn(),
  getPerformanceStats: vi.fn(),
}));

const websiteId = 'e79ef216-70ab-48df-addc-596b6e9e65a8';
const context = { params: Promise.resolve({ websiteId }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticateServiceApiKey).mockResolvedValue({
    ok: true,
    key: {
      id: 'key-id',
      websiteId,
      name: 'agent',
      scopes: ['analytics:summary:read'],
    },
  });
  vi.mocked(getWebsiteStats)
    .mockResolvedValueOnce({
      pageviews: 100,
      visitors: 40,
      visits: 50,
      bounces: 10,
      totaltime: 1000,
    } as never)
    .mockResolvedValueOnce({
      pageviews: 80,
      visitors: 32,
      visits: 40,
      bounces: 8,
      totaltime: 800,
    } as never);
});

test('returns a stable snapshot envelope and preserves metric denominators', async () => {
  const response = await POST(
    new Request(`http://localhost/api/agent/v1/websites/${websiteId}/query`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer umami_sk_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'snapshot',
        period: { preset: 'day', timezone: 'Europe/Lisbon' },
      }),
    }),
    context,
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body).toMatchObject({
    schemaVersion: '1.0',
    websiteId,
    query: { kind: 'snapshot' },
    period: { preset: 'day', timezone: 'Europe/Lisbon', complete: true },
    data: {
      metrics: expect.arrayContaining([
        expect.objectContaining({
          id: 'bounceRate',
          unit: 'percent',
          value: 20,
          numerator: 10,
          denominator: 50,
        }),
      ]),
    },
  });
  expect(authenticateServiceApiKey).toHaveBeenCalledWith(
    expect.any(Request),
    websiteId,
    'analytics:summary:read',
    2,
  );
  expect(recordServiceApiKeyAuditSafely).toHaveBeenCalledWith(
    expect.objectContaining({ queryType: 'snapshot', status: 'success' }),
  );
});

test('rejects unbounded or unknown breakdown dimensions before authentication', async () => {
  const response = await POST(
    new Request(`http://localhost/api/agent/v1/websites/${websiteId}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'breakdown',
        dimension: 'raw_sql',
        limit: 1000,
        period: { preset: 'week', timezone: 'UTC' },
      }),
    }),
    context,
  );

  expect(response.status).toBe(400);
  expect(authenticateServiceApiKey).not.toHaveBeenCalled();
});

test('rejects oversized bodies before authentication', async () => {
  const response = await POST(
    new Request(`http://localhost/api/agent/v1/websites/${websiteId}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(17 * 1024) }),
    }),
    context,
  );

  expect(response.status).toBe(413);
  expect(authenticateServiceApiKey).not.toHaveBeenCalled();
});

test('passes the exact advertised comparison range into product aggregation', async () => {
  const response = await POST(
    new Request(`http://localhost/api/agent/v1/websites/${websiteId}/query`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer umami_sk_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'product',
        period: {
          timezone: 'UTC',
          startAt: '2026-07-01T00:00:00.000Z',
          endAt: '2026-07-07T23:59:59.999Z',
        },
      }),
    }),
    context,
  );
  const body = await response.json();
  const call = vi.mocked(getProductCockpitData).mock.calls[0][0];

  expect(response.status).toBe(200);
  expect(call.previous.startDate.toISOString()).toBe(body.comparison.startAt);
  expect(call.previous.endDate.toISOString()).toBe(body.comparison.endAt);
});

test('treats moderation as an as-of-now queue and rejects misleading periods', async () => {
  const response = await POST(
    new Request(`http://localhost/api/agent/v1/websites/${websiteId}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'moderation',
        period: { preset: 'day', timezone: 'UTC' },
      }),
    }),
    context,
  );

  expect(response.status).toBe(400);
  expect(authenticateServiceApiKey).not.toHaveBeenCalled();
});

test('rejects hourly timeseries that would exceed the response bucket bound', async () => {
  const response = await POST(
    new Request(`http://localhost/api/agent/v1/websites/${websiteId}/query`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer umami_sk_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'timeseries',
        unit: 'hour',
        period: {
          timezone: 'UTC',
          startAt: '2026-01-01T00:00:00.000Z',
          endAt: '2026-04-30T23:59:59.999Z',
        },
      }),
    }),
    context,
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    error: { message: expect.stringContaining('500 buckets') },
  });
});
