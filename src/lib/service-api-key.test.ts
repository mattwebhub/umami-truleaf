import crypto from 'node:crypto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import prisma from '@/lib/prisma';
import redis from '@/lib/redis';
import { canUpdateWebsite, canViewAuthenticatedWebsite } from '@/permissions';
import { getUser } from '@/queries/prisma';
import {
  authenticateServiceApiKey,
  createServiceApiKeySecret,
  enforceAgentApiIngressLimit,
  getAgentApiIngressFingerprint,
  recordServiceApiKeyAuditSafely,
} from './service-api-key';

vi.mock('@/lib/prisma', () => ({
  default: {
    rawQuery: vi.fn(),
    client: {
      serviceApiKey: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      serviceApiKeyAudit: { create: vi.fn() },
      website: { findFirst: vi.fn() },
    },
  },
}));
vi.mock('@/lib/redis', () => ({
  default: {
    enabled: false,
    client: { rateLimit: vi.fn() },
  },
}));
vi.mock('@/queries/prisma', () => ({ getUser: vi.fn() }));
vi.mock('@/permissions', () => ({
  canViewAuthenticatedWebsite: vi.fn(),
  canUpdateWebsite: vi.fn(),
}));

const websiteId = 'e79ef216-70ab-48df-addc-596b6e9e65a8';
const keyId = '83b32c88-64ad-4776-917f-89014c58c233';
const credential = createServiceApiKeySecret();
const request = new Request('http://localhost/api/agent/v1/query', {
  headers: { authorization: `Bearer ${credential.token}` },
});
const websiteFindFirstMock = prisma.client.website.findFirst as unknown as ReturnType<typeof vi.fn>;

function mockKey(overrides: Record<string, unknown> = {}) {
  vi.mocked(prisma.client.serviceApiKey.findUnique).mockResolvedValue({
    id: keyId,
    websiteId,
    name: 'Local agent',
    keyPrefix: credential.keyPrefix,
    keyHash: crypto.createHash('sha256').update(credential.token).digest('hex'),
    scopes: ['analytics:summary:read'],
    createdByUserId: 'user-id',
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: new Date(),
    ...overrides,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  (redis as unknown as { enabled: boolean }).enabled = false;
  delete process.env.AGENT_API_CLIENT_IP_HEADER;
  mockKey();
  vi.mocked(getUser).mockResolvedValue({
    id: 'user-id',
    username: 'matheus',
    role: 'admin',
  } as never);
  vi.mocked(canViewAuthenticatedWebsite).mockResolvedValue(true);
  vi.mocked(canUpdateWebsite).mockResolvedValue(true);
  websiteFindFirstMock.mockResolvedValue({ id: websiteId });
  vi.mocked(prisma.rawQuery).mockResolvedValue([{ rate_limit_count: 1 }]);
});

describe('authenticateServiceApiKey', () => {
  test('accepts a valid website-scoped key and uses the atomic database limiter', async () => {
    const result = await authenticateServiceApiKey(request, websiteId, 'analytics:summary:read');

    expect(result).toMatchObject({ ok: true, key: { id: keyId, websiteId } });
    expect(prisma.rawQuery).toHaveBeenCalledWith(
      expect.stringContaining('update service_api_key'),
      { keyId, cost: 1 },
      'enforceAgentApiRateLimit',
    );
  });

  test('rejects hash mismatch, revocation, expiry, website mismatch, and missing scope', async () => {
    mockKey({ keyHash: '0'.repeat(64) });
    await expect(
      authenticateServiceApiKey(request, websiteId, 'analytics:summary:read'),
    ).resolves.toMatchObject({ ok: false, reason: 'invalid' });

    mockKey({ revokedAt: new Date() });
    await expect(
      authenticateServiceApiKey(request, websiteId, 'analytics:summary:read'),
    ).resolves.toMatchObject({ ok: false, reason: 'revoked' });

    mockKey({ expiresAt: new Date('2020-01-01T00:00:00.000Z') });
    await expect(
      authenticateServiceApiKey(request, websiteId, 'analytics:summary:read'),
    ).resolves.toMatchObject({ ok: false, reason: 'expired' });

    mockKey({ websiteId: '11111111-1111-4111-8111-111111111111' });
    await expect(
      authenticateServiceApiKey(request, websiteId, 'analytics:summary:read'),
    ).resolves.toMatchObject({ ok: false, reason: 'website' });

    mockKey({ scopes: ['analytics:quality:read'] });
    await expect(
      authenticateServiceApiKey(request, websiteId, 'analytics:summary:read'),
    ).resolves.toMatchObject({ ok: false, reason: 'scope' });
  });

  test('revokes effective access when the owner disappears or loses website permission', async () => {
    websiteFindFirstMock.mockResolvedValueOnce(null);
    await expect(
      authenticateServiceApiKey(request, websiteId, 'analytics:summary:read'),
    ).resolves.toMatchObject({ ok: false, reason: 'inactive' });

    vi.mocked(getUser).mockResolvedValueOnce(null);
    await expect(
      authenticateServiceApiKey(request, websiteId, 'analytics:summary:read'),
    ).resolves.toMatchObject({ ok: false, reason: 'owner' });

    vi.mocked(canViewAuthenticatedWebsite).mockResolvedValueOnce(false);
    await expect(
      authenticateServiceApiKey(request, websiteId, 'analytics:summary:read'),
    ).resolves.toMatchObject({ ok: false, reason: 'permission' });
  });

  test('requires update permission for moderation and allows exactly 120 requests per minute', async () => {
    mockKey({ scopes: ['moderation:read'] });
    vi.mocked(canUpdateWebsite).mockResolvedValueOnce(false);
    await expect(
      authenticateServiceApiKey(request, websiteId, 'moderation:read'),
    ).resolves.toMatchObject({ ok: false, reason: 'permission' });

    mockKey();
    vi.mocked(prisma.rawQuery).mockResolvedValueOnce([{ rate_limit_count: 120 }]);
    await expect(
      authenticateServiceApiKey(request, websiteId, 'analytics:summary:read'),
    ).resolves.toMatchObject({ ok: true });

    mockKey();
    vi.mocked(prisma.rawQuery).mockResolvedValueOnce([{ rate_limit_count: 121 }]);
    await expect(
      authenticateServiceApiKey(request, websiteId, 'analytics:summary:read'),
    ).resolves.toMatchObject({ ok: false, reason: 'rate-limit' });
  });

  test('filters catalog scopes against the owner current permissions', async () => {
    mockKey({
      scopes: ['analytics:summary:read', 'moderation:read'],
    });
    vi.mocked(canUpdateWebsite).mockResolvedValueOnce(false);

    await expect(authenticateServiceApiKey(request, websiteId)).resolves.toMatchObject({
      ok: true,
      key: { scopes: ['analytics:summary:read'] },
    });
  });
});

describe('enforceAgentApiIngressLimit', () => {
  test('uses only a trusted configured address header and blocks after the 300th request', async () => {
    process.env.AGENT_API_CLIENT_IP_HEADER = 'x-real-ip';
    const ingressRequest = new Request('http://localhost/api/agent/v1/catalog', {
      headers: {
        'x-real-ip': '203.0.113.25',
        'x-forwarded-for': '198.51.100.17, 10.0.0.2',
      },
    });
    vi.mocked(prisma.rawQuery).mockResolvedValueOnce([{ count: 300 }]);

    await expect(enforceAgentApiIngressLimit(ingressRequest)).resolves.toBe(false);
    const parameters = vi.mocked(prisma.rawQuery).mock.calls[0][1] as {
      fingerprint: string;
    };
    expect(parameters.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(parameters.fingerprint).not.toContain('203.0.113.25');

    vi.mocked(prisma.rawQuery).mockResolvedValueOnce([{ count: 301 }]);
    await expect(enforceAgentApiIngressLimit(ingressRequest)).resolves.toBe(true);
  });

  test('uses one safe shared bucket for absent, invalid, or unconfigured attribution', () => {
    const spoofed = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.25' },
    });
    const unconfigured = getAgentApiIngressFingerprint(spoofed);

    process.env.AGENT_API_CLIENT_IP_HEADER = 'x-real-ip';
    const invalid = getAgentApiIngressFingerprint(
      new Request('http://localhost', { headers: { 'x-real-ip': 'not-an-ip' } }),
    );
    const absent = getAgentApiIngressFingerprint(new Request('http://localhost'));

    expect(invalid).toBe(unconfigured);
    expect(absent).toBe(unconfigured);
  });
});

test('does not mask analytics reads when query audit persistence fails', async () => {
  vi.mocked(prisma.client.serviceApiKeyAudit.create).mockRejectedValueOnce(
    new Error('audit unavailable'),
  );
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  await expect(
    recordServiceApiKeyAuditSafely({
      keyId,
      websiteId,
      action: 'query',
      queryType: 'snapshot',
      status: 'success',
    }),
  ).resolves.toBeUndefined();
  expect(consoleError).toHaveBeenCalledWith('Failed to persist service API key query audit');
  consoleError.mockRestore();
});
