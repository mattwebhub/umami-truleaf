import { beforeEach, expect, test, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { parseRequest } from '@/lib/request';
import { createServiceApiKey, isActiveServiceApiKeyWebsite } from '@/lib/service-api-key';
import { canUpdateWebsite } from '@/permissions';
import { GET, POST } from './route';

vi.mock('@/lib/prisma', () => ({
  default: { client: { serviceApiKey: { findMany: vi.fn() } } },
}));
vi.mock('@/lib/request', () => ({ parseRequest: vi.fn() }));
vi.mock('@/permissions', () => ({ canUpdateWebsite: vi.fn() }));
vi.mock('@/lib/service-api-key', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/service-api-key')>();
  return {
    ...actual,
    createServiceApiKey: vi.fn(),
    isActiveServiceApiKeyWebsite: vi.fn(async () => true),
  };
});

const websiteId = 'e79ef216-70ab-48df-addc-596b6e9e65a8';
const context = { params: Promise.resolve({ websiteId }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(canUpdateWebsite).mockResolvedValue(true);
  vi.mocked(parseRequest).mockResolvedValue({
    auth: { user: { id: 'operator-id' } },
    body: {
      name: 'Local MCP',
      scopes: ['analytics:summary:read'],
      expiresAt: null,
    },
  } as never);
});

test('shows the plaintext token once while persisting and listing only redacted key data', async () => {
  vi.mocked(createServiceApiKey).mockResolvedValue({
    token: 'umami_sk_one-time-secret',
    key: {
      id: 'key-id',
      websiteId,
      name: 'Local MCP',
      keyPrefix: 'umami_sk_one-time',
      keyHash: 'not-returned',
      scopes: ['analytics:summary:read'],
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as never);

  const created = await POST(
    new Request('http://localhost/service-api-keys', { method: 'POST' }),
    context,
  );
  const createdBody = await created.json();

  expect(created.status).toBe(201);
  expect(createdBody.token).toBe('umami_sk_one-time-secret');
  expect(createdBody.key).not.toHaveProperty('keyHash');
  vi.mocked(prisma.client.serviceApiKey.findMany).mockResolvedValue([
    {
      id: 'key-id',
      websiteId,
      name: 'Local MCP',
      keyPrefix: 'umami_sk_one-time',
      scopes: ['analytics:summary:read'],
    },
  ] as never);
  const listed = await GET(new Request('http://localhost/service-api-keys'), context);
  const listedBody = await listed.json();

  expect(listedBody.keys[0]).not.toHaveProperty('keyHash');
  expect(listedBody.keys[0]).not.toHaveProperty('token');
});

test('requires website update permission for key lifecycle management', async () => {
  vi.mocked(canUpdateWebsite).mockResolvedValue(false);

  const response = await POST(
    new Request('http://localhost/service-api-keys', { method: 'POST' }),
    context,
  );

  expect(response.status).toBe(403);
  expect(createServiceApiKey).not.toHaveBeenCalled();
});

test('does not let an admin create a key for a nonexistent or deleted website', async () => {
  vi.mocked(isActiveServiceApiKeyWebsite).mockResolvedValueOnce(false);

  const response = await POST(
    new Request('http://localhost/service-api-keys', { method: 'POST' }),
    context,
  );

  expect(response.status).toBe(404);
  expect(canUpdateWebsite).not.toHaveBeenCalled();
  expect(createServiceApiKey).not.toHaveBeenCalled();
});
