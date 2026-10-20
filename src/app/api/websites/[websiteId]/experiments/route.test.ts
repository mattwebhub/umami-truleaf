import { beforeEach, expect, test, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { parseRequest } from '@/lib/request';
import { canUpdateWebsite } from '@/permissions';
import { GET, POST, PUT } from './route';

vi.mock('@/lib/prisma', () => ({
  default: {
    client: {
      experimentRollout: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn(),
        createMany: vi.fn(),
        count: vi.fn(),
      },
    },
  },
}));
vi.mock('@/lib/request', () => ({ parseRequest: vi.fn() }));
vi.mock('@/permissions', () => ({ canUpdateWebsite: vi.fn() }));

const websiteId = '11111111-1111-4111-8111-111111111111';
const revision = '22222222-2222-4222-8222-222222222222';
const context = { params: Promise.resolve({ websiteId }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseRequest).mockResolvedValue({ auth: { user: { id: 'operator' } } } as never);
  vi.mocked(canUpdateWebsite).mockResolvedValue(true);
});

test('refuses the editor to a website viewer', async () => {
  vi.mocked(canUpdateWebsite).mockResolvedValue(false);
  const response = await GET(new Request('http://localhost/api'), context);
  expect(response.status).toBe(403);
  expect(prisma.client.experimentRollout.findMany).not.toHaveBeenCalled();
});

test('shows the 50% starter experiment before it is persisted', async () => {
  vi.stubEnv('EXPERIMENT_ROLLOUT_WEBSITE_ID', websiteId);
  (prisma.client.experimentRollout.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  const response = await GET(new Request('http://localhost/api'), context);
  await expect(response.json()).resolves.toMatchObject({
    needsBootstrap: true,
    rollouts: [{ key: 'insight-signup-v1', treatmentPercent: 50, revision: null }],
  });
});

test('refuses a stale edit instead of silently replacing a newer allocation', async () => {
  vi.mocked(parseRequest).mockResolvedValue({
    auth: { user: { id: 'operator' } },
    body: {
      key: 'insight-signup-v1',
      name: 'Insight signup',
      treatmentPercent: 70,
      expectedRevision: revision,
    },
  } as never);
  (prisma.client.experimentRollout.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    revision: '33333333-3333-4333-8333-333333333333',
  } as never);

  const response = await PUT(new Request('http://localhost/api', { method: 'PUT' }), context);
  expect(response.status).toBe(409);
  expect(prisma.client.experimentRollout.updateMany).not.toHaveBeenCalled();
});

test('updates an allocation only when the revision still matches', async () => {
  vi.mocked(parseRequest).mockResolvedValue({
    auth: { user: { id: 'operator' } },
    body: {
      key: 'insight-signup-v1',
      name: 'Insight signup',
      treatmentPercent: 0,
      expectedRevision: revision,
    },
  } as never);
  (prisma.client.experimentRollout.findUnique as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({ revision } as never)
    .mockResolvedValueOnce({ key: 'insight-signup-v1', treatmentPercent: 0 } as never);
  (prisma.client.experimentRollout.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
    count: 1,
  });

  const response = await PUT(new Request('http://localhost/api', { method: 'PUT' }), context);
  expect(response.status).toBe(200);
  expect(prisma.client.experimentRollout.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { websiteId, key: 'insight-signup-v1', revision },
      data: expect.objectContaining({ treatmentPercent: 0 }),
    }),
  );
});

test('bootstraps the default only for an updater of the configured website', async () => {
  vi.stubEnv('EXPERIMENT_ROLLOUT_WEBSITE_ID', websiteId);
  const response = await POST(new Request('http://localhost/api', { method: 'POST' }), context);
  expect(response.status).toBe(200);
  expect(prisma.client.experimentRollout.createMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: [
        expect.objectContaining({ key: 'insight-signup-v1', treatmentPercent: 50, websiteId }),
      ],
      skipDuplicates: true,
    }),
  );

  vi.mocked(canUpdateWebsite).mockResolvedValue(false);
  const denied = await POST(new Request('http://localhost/api', { method: 'POST' }), context);
  expect(denied.status).toBe(403);
});
