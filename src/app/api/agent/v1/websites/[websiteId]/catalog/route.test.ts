import { beforeEach, expect, test, vi } from 'vitest';
import { authenticateServiceApiKey, recordServiceApiKeyAuditSafely } from '@/lib/service-api-key';
import { GET } from './route';

vi.mock('@/lib/service-api-key', () => ({
  authenticateServiceApiKey: vi.fn(),
  enforceAgentApiIngressLimit: vi.fn(async () => false),
  recordServiceApiKeyAuditSafely: vi.fn(),
  SERVICE_API_KEY_SCOPES: [
    'analytics:summary:read',
    'analytics:product:read',
    'analytics:content:read',
    'analytics:quality:read',
    'moderation:read',
  ],
}));

const websiteId = 'e79ef216-70ab-48df-addc-596b6e9e65a8';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticateServiceApiKey).mockResolvedValue({
    ok: true,
    key: {
      id: 'key-id',
      websiteId,
      name: 'summary-only',
      scopes: ['analytics:summary:read'],
    },
  });
});

test('advertises only capabilities granted to the service key', async () => {
  const response = await GET(
    new Request(`http://localhost/api/agent/v1/websites/${websiteId}/catalog`),
    { params: Promise.resolve({ websiteId }) },
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.queries).toEqual([
    { kind: 'snapshot', requiredScope: 'analytics:summary:read' },
    { kind: 'timeseries', requiredScope: 'analytics:summary:read' },
    { kind: 'breakdown', requiredScope: 'analytics:summary:read' },
  ]);
  expect(body.safety).toMatchObject({ readOnly: true, rawSql: false, rawIpAddresses: false });
  expect(recordServiceApiKeyAuditSafely).toHaveBeenCalledWith(
    expect.objectContaining({ queryType: 'catalog', status: 'success' }),
  );
  expect(authenticateServiceApiKey).toHaveBeenCalledWith(expect.any(Request), websiteId);
});

test('supports discovery for a key that does not have summary scope', async () => {
  vi.mocked(authenticateServiceApiKey).mockResolvedValueOnce({
    ok: true,
    key: {
      id: 'key-id',
      websiteId,
      name: 'product-only',
      scopes: ['analytics:product:read'],
    },
  });

  const response = await GET(
    new Request(`http://localhost/api/agent/v1/websites/${websiteId}/catalog`),
    { params: Promise.resolve({ websiteId }) },
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.queries).toEqual([{ kind: 'product', requiredScope: 'analytics:product:read' }]);
});
