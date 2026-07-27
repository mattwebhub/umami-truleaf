import { beforeEach, expect, test, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { parseRequest } from '@/lib/request';
import { canUpdateWebsite } from '@/permissions';
import { POST } from './route';

vi.mock('@/lib/crypto', () => ({
  uuid: (...parts: string[]) => `uuid:${parts.join(':')}`,
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    client: {
      segment: {
        upsert: vi.fn(item => Promise.resolve(item)),
      },
      report: {
        upsert: vi.fn(item => Promise.resolve(item)),
      },
      $transaction: vi.fn(items => Promise.all(items)),
    },
  },
}));
vi.mock('@/lib/request', () => ({
  parseRequest: vi.fn(),
}));
vi.mock('@/permissions', () => ({
  canUpdateWebsite: vi.fn(),
}));

const websiteId = 'e79ef216-70ab-48df-addc-596b6e9e65a8';
const context = { params: Promise.resolve({ websiteId }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseRequest).mockResolvedValue({
    auth: { user: { id: 'operator' } },
  } as never);
  vi.mocked(canUpdateWebsite).mockResolvedValue(true);
  process.env.PRODUCT_COCKPIT_CONFIG = JSON.stringify({
    websites: [
      {
        websiteId,
        metrics: [],
        funnels: [],
        features: [],
        bootstrap: {
          segments: [
            {
              managedKey: 'authenticated',
              name: 'Authenticated',
              filters: [{ name: 'distinctId', operator: 's', value: '' }],
            },
          ],
          cohorts: [
            {
              managedKey: 'activated',
              name: 'Activated',
              dateRange: '90day',
              action: { type: 'event', value: 'project-created' },
              filters: [],
            },
          ],
          reports: [
            {
              managedKey: 'activation-funnel',
              type: 'funnel',
              name: 'Activation',
              description: 'Managed',
              parameters: {
                window: 30,
                steps: [
                  { type: 'event', value: 'signup' },
                  { type: 'event', value: 'project-created' },
                ],
              },
            },
          ],
        },
      },
    ],
  });
});

test('upserts only deterministic, configuration-managed workspace objects', async () => {
  const response = await POST(
    new Request('http://localhost/bootstrap', { method: 'POST' }),
    context,
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    segments: 1,
    cohorts: 1,
    reports: 1,
  });
  expect(prisma.client.segment.upsert).toHaveBeenCalledTimes(2);
  expect(prisma.client.segment.upsert).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      where: {
        id: `uuid:product-cockpit:${websiteId}:segment:authenticated`,
      },
      create: expect.objectContaining({
        websiteId,
        type: 'segment',
        name: 'Authenticated',
      }),
    }),
  );
  expect(prisma.client.report.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        id: `uuid:product-cockpit:${websiteId}:report:activation-funnel`,
      },
      create: expect.objectContaining({
        userId: 'operator',
        websiteId,
        type: 'funnel',
      }),
    }),
  );
  expect(prisma.client.segment.upsert).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      where: {
        id: `uuid:product-cockpit:${websiteId}:cohort:activated`,
      },
      create: expect.objectContaining({
        type: 'cohort',
        parameters: expect.objectContaining({
          dateRange: '90day',
          action: { type: 'event', value: 'project-created' },
        }),
      }),
    }),
  );
});

test('requires website update permission', async () => {
  vi.mocked(canUpdateWebsite).mockResolvedValueOnce(false);

  const response = await POST(
    new Request('http://localhost/bootstrap', { method: 'POST' }),
    context,
  );

  expect(response.status).toBe(401);
  expect(prisma.client.segment.upsert).not.toHaveBeenCalled();
  expect(prisma.client.report.upsert).not.toHaveBeenCalled();
});
