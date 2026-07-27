import { beforeEach, expect, test, vi } from 'vitest';
import { TRULEAF_SESSION_NETWORK_DISPLAY_LIMIT } from '@/lib/truleaf/constants';
import { getTruleafSessionNetworks } from './truleafSessionNetwork';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    client: {
      truleafSessionNetwork: {
        findMany: mocks.findMany,
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
});

test('bounds session network hydration to the most recent retained records', async () => {
  await getTruleafSessionNetworks('website-1', 'session-1');

  expect(mocks.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      orderBy: { lastSeenAt: 'desc' },
      take: TRULEAF_SESSION_NETWORK_DISPLAY_LIMIT,
    }),
  );
});
