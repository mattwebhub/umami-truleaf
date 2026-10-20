import { beforeEach, expect, test, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { GET } from './route';

vi.mock('@/lib/prisma', () => ({
  default: { client: { experimentRollout: { findMany: vi.fn() } } },
}));

const websiteId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('EXPERIMENT_ROLLOUT_WEBSITE_ID', websiteId);
});

test('publishes only assignment inputs for the configured website', async () => {
  (prisma.client.experimentRollout.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      key: 'insight-signup-v1',
      treatmentPercent: 35,
      revision: '22222222-2222-4222-8222-222222222222',
    },
  ] as never);

  const response = await GET();

  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toContain('s-maxage=60');
  expect(prisma.client.experimentRollout.findMany).toHaveBeenCalledWith({
    where: { websiteId },
    select: { key: true, treatmentPercent: true, revision: true },
    orderBy: { key: 'asc' },
  });
  await expect(response.json()).resolves.toEqual({
    experiments: {
      'insight-signup-v1': {
        treatmentPercent: 35,
        revision: '22222222-2222-4222-8222-222222222222',
      },
    },
  });
});

test('does not expose data if the public website is not configured', async () => {
  vi.stubEnv('EXPERIMENT_ROLLOUT_WEBSITE_ID', '');
  const response = await GET();
  expect(response.status).toBe(503);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(prisma.client.experimentRollout.findMany).not.toHaveBeenCalled();
});

test('exposes the initial 50% allocation before the first board visit', async () => {
  (prisma.client.experimentRollout.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  const response = await GET();
  await expect(response.json()).resolves.toEqual({
    experiments: { 'insight-signup-v1': { treatmentPercent: 50, revision: 'initial-50' } },
  });
});
