import { expect, test, vi } from 'vitest';
import { parseRequest } from '@/lib/request';
import { canViewAuthenticatedWebsite } from '@/permissions';
import { getVerifiedSessionIdentityAvatar } from '@/queries/prisma';
import { GET } from './route';

vi.mock('@/lib/request', () => ({ parseRequest: vi.fn() }));
vi.mock('@/lib/truleaf/config', () => ({
  isTruleafIdentityProfileEnabled: () => true,
  isTruleafWebsite: () => true,
}));
vi.mock('@/permissions', () => ({ canViewAuthenticatedWebsite: vi.fn() }));
vi.mock('@/queries/prisma', () => ({ getVerifiedSessionIdentityAvatar: vi.fn() }));

test('denies avatar access to a sessions share token', async () => {
  const websiteId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '22222222-2222-4222-8222-222222222222';
  vi.mocked(parseRequest).mockResolvedValue({
    auth: { shareToken: { websiteId, parameters: { sessions: true } } },
  } as never);
  vi.mocked(canViewAuthenticatedWebsite).mockResolvedValue(false);

  const response = await GET(new Request('http://localhost/api/avatar'), {
    params: Promise.resolve({ websiteId, sessionId }),
  });

  expect(response.status).toBe(401);
  expect(getVerifiedSessionIdentityAvatar).not.toHaveBeenCalled();
});
