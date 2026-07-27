import { beforeEach, expect, test, vi } from 'vitest';
import { uuid } from '@/lib/crypto';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { canViewAuthenticatedWebsite, canViewWebsiteSection } from '@/permissions';
import { getVerifiedSessionIdentityProfiles } from '@/queries/prisma';
import { getWebsiteSessions } from '@/queries/sql';
import { GET } from './route';

vi.mock('@/lib/request', () => ({ getQueryFilters: vi.fn(), parseRequest: vi.fn() }));
vi.mock('@/lib/truleaf/config', () => ({
  isTruleafIdentityProfileEnabled: () => true,
  isTruleafWebsite: () => true,
}));
vi.mock('@/permissions', () => ({
  canViewAuthenticatedWebsite: vi.fn(),
  canViewWebsiteSection: vi.fn(),
}));
vi.mock('@/queries/prisma', () => ({ getVerifiedSessionIdentityProfiles: vi.fn() }));
vi.mock('@/queries/sql', () => ({ getWebsiteSessions: vi.fn() }));

const websiteId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const context = { params: Promise.resolve({ websiteId }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getQueryFilters).mockResolvedValue({} as never);
  vi.mocked(canViewWebsiteSection).mockResolvedValue(true);
  vi.mocked(canViewAuthenticatedWebsite).mockResolvedValue(false);
  vi.mocked(getWebsiteSessions).mockResolvedValue({
    data: [{ id: sessionId, distinctId: 'private-account-id' }],
    count: 1,
    page: 1,
    pageSize: 20,
  } as never);
});

test('does not enrich a shared sessions response with verified account data', async () => {
  vi.mocked(parseRequest).mockResolvedValue({
    auth: { shareToken: { websiteId, parameters: { sessions: true } } },
    query: { startAt: 0, endAt: Date.now() },
  } as never);

  const response = await GET(new Request('http://localhost/api/sessions'), context);
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.data[0]).toEqual({ id: sessionId });
  expect(body.data[0]).not.toHaveProperty('distinctId');
  expect(getVerifiedSessionIdentityProfiles).not.toHaveBeenCalled();
});

test('enriches the current page for an authenticated website viewer', async () => {
  vi.mocked(parseRequest).mockResolvedValue({
    auth: { user: { id: 'operator' } },
    query: { startAt: 0, endAt: Date.now() },
  } as never);
  vi.mocked(canViewAuthenticatedWebsite).mockResolvedValue(true);
  vi.mocked(getVerifiedSessionIdentityProfiles).mockResolvedValue(
    new Map([
      [
        sessionId,
        {
          displayName: 'Matheus Paranhos',
          username: 'matheus',
          role: 'user',
          plan: 'premium',
          hasAvatar: true,
        },
      ],
    ]),
  );

  const response = await GET(new Request('http://localhost/api/sessions'), context);

  await expect(response.json()).resolves.toMatchObject({
    data: [{ id: sessionId, identityProfile: { username: 'matheus' } }],
  });
});

test('marks only the trusted server namespace, not spoofed server dimensions', async () => {
  const distinctId = '507f1f77bcf86cd799439011';
  const trustedId = uuid(websiteId, 'server', distinctId);
  const spoofedId = uuid(websiteId, distinctId);
  vi.mocked(parseRequest).mockResolvedValue({
    auth: { user: { id: 'operator' } },
    query: { startAt: 0, endAt: Date.now() },
  } as never);
  vi.mocked(getWebsiteSessions).mockResolvedValue({
    data: [
      { id: trustedId, distinctId, browser: 'server', os: 'server', device: 'server' },
      { id: spoofedId, distinctId, browser: 'server', os: 'server', device: 'server' },
    ],
    count: 2,
    page: 1,
    pageSize: 20,
  } as never);

  const response = await GET(new Request('http://localhost/api/sessions'), context);
  const body = await response.json();

  expect(body.data[0]).toMatchObject({ id: trustedId, serverSession: true });
  expect(body.data[1]).not.toHaveProperty('serverSession');
});
