import { beforeEach, expect, test, vi } from 'vitest';
import { parseRequest } from '@/lib/request';
import { canViewAuthenticatedWebsite, canViewWebsiteSection } from '@/permissions';
import { getVerifiedSessionIdentityProfiles } from '@/queries/prisma';
import { getWebsiteSession } from '@/queries/sql';
import { GET } from './route';

vi.mock('@/lib/request', () => ({ parseRequest: vi.fn() }));
vi.mock('@/lib/truleaf/config', () => ({
  isTruleafIdentityProfileEnabled: () => true,
  isTruleafWebsite: () => true,
}));
vi.mock('@/permissions', () => ({
  canViewAuthenticatedWebsite: vi.fn(),
  canViewWebsiteSection: vi.fn(),
}));
vi.mock('@/queries/prisma', () => ({ getVerifiedSessionIdentityProfiles: vi.fn() }));
vi.mock('@/queries/sql', () => ({ getWebsiteSession: vi.fn() }));

const websiteId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const context = { params: Promise.resolve({ websiteId, sessionId }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(canViewWebsiteSection).mockResolvedValue(true);
  vi.mocked(canViewAuthenticatedWebsite).mockResolvedValue(false);
  vi.mocked(getWebsiteSession).mockResolvedValue({ id: sessionId } as never);
});

test('does not expose a verified identity in shared session detail', async () => {
  vi.mocked(parseRequest).mockResolvedValue({
    auth: { shareToken: { websiteId, parameters: { sessions: true } } },
  } as never);

  const response = await GET(new Request('http://localhost/api/session'), context);

  await expect(response.json()).resolves.toEqual({ id: sessionId });
  expect(getVerifiedSessionIdentityProfiles).not.toHaveBeenCalled();
});
