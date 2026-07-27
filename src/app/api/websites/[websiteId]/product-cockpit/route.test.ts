import { beforeEach, expect, test, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { canViewWebsiteSection } from '@/permissions';
import { getWebsiteEventStats } from '@/queries/sql/events/getWebsiteEventStats';
import { GET } from './route';

vi.mock('@/lib/prisma', () => ({
  default: {
    rawQuery: vi.fn(),
    client: { sessionReview: { count: vi.fn() } },
  },
}));
vi.mock('@/lib/request', () => ({
  parseRequest: vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    return {
      auth: { user: { id: 'operator' } },
      query: {
        startAt: Number(url.searchParams.get('startAt')),
        endAt: Number(url.searchParams.get('endAt')),
      },
    };
  }),
  getQueryFilters: vi.fn(async query => ({
    startDate: new Date(query.startAt),
    endDate: new Date(query.endAt),
    timezone: 'UTC',
    unit: 'day',
  })),
}));
vi.mock('@/permissions', () => ({
  canViewWebsiteSection: vi.fn(),
}));
vi.mock('@/queries/sql/events/getWebsiteEventStats', () => ({
  getWebsiteEventStats: vi.fn(),
}));
vi.mock('@/queries/sql/product/getContentSummary', () => ({
  getContentSummary: vi.fn(async () => ({ current: [], previous: [] })),
}));
vi.mock('@/queries/sql/getWebsiteStats', () => ({
  getWebsiteStats: vi.fn(async () => ({ visitors: 100 })),
}));
vi.mock('@/queries/sql/performance/getPerformanceStats', () => ({
  getPerformanceStats: vi.fn(async () => ({
    lcp: 1000,
    inp: 100,
    cls: 0.05,
    count: 10,
  })),
}));
vi.mock('@/queries/sql/product/getIdentifiedAccountCount', () => ({
  getIdentifiedAccountCount: vi.fn(async () => 40),
}));
vi.mock('@/queries/sql/reports/getRetention', () => ({
  getRetention: vi.fn(async () => [
    { day: 1, visitors: 20, returnVisitors: 5 },
    { day: 7, visitors: 20, returnVisitors: 2 },
  ]),
}));

const websiteId = 'e79ef216-70ab-48df-addc-596b6e9e65a8';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(canViewWebsiteSection).mockResolvedValue(true);
  vi.mocked(prisma.client.sessionReview.count).mockResolvedValue(3);
  vi.mocked(prisma.rawQuery).mockResolvedValue([{ events: 2, accounts: 2 }]);
  vi.mocked(getWebsiteEventStats).mockImplementation(async (_websiteId, filters) => {
    const event = String(filters.event);
    if (event.includes('signup')) return { events: 12, visitors: 10 } as never;
    if (event.includes('project-create')) return { events: 8, visitors: 5 } as never;
    return { events: 0, visitors: 0 } as never;
  });
  process.env.PRODUCT_COCKPIT_CONFIG = JSON.stringify({
    websites: [
      {
        websiteId,
        authoritativeEvents: ['server.subscription-verified'],
        metrics: [
          {
            id: 'activation',
            label: 'Activation',
            type: 'rate',
            numerator: ['project-create'],
            denominator: ['signup'],
            measure: 'sessions',
          },
          {
            id: 'subscriptions',
            label: 'Subscriptions',
            type: 'count',
            events: ['server.subscription-verified'],
            provenance: 'server',
            measure: 'accounts',
          },
        ],
        funnels: [],
        features: [],
      },
    ],
  });
});

test('returns bounded, permissioned product math with explicit provenance and denominators', async () => {
  const response = await GET(
    new Request(
      `http://localhost/api/websites/${websiteId}/product-cockpit?startAt=1785024000000&endAt=1785110400000`,
      { headers: { authorization: 'Bearer test' } },
    ),
    { params: Promise.resolve({ websiteId }) },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.metrics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'activation',
        value: 50,
        numerator: 5,
        denominator: 10,
        provenance: 'browser',
        filterScope: 'all',
      }),
      expect.objectContaining({
        id: 'subscriptions',
        value: 2,
        provenance: 'server',
        filterScope: 'date',
      }),
    ]),
  );
  expect(body.retention).toEqual(
    expect.arrayContaining([
      { day: 1, cohort: 20, returned: 5, rate: 25 },
      { day: 7, cohort: 20, returned: 2, rate: 10 },
    ]),
  );
  expect(body.moderation.openReviews).toBe(3);
  expect(prisma.rawQuery).toHaveBeenCalled();
});

test('requires overview permission before running aggregate queries', async () => {
  vi.mocked(canViewWebsiteSection).mockResolvedValueOnce(false);

  const response = await GET(
    new Request(
      `http://localhost/api/websites/${websiteId}/product-cockpit?startAt=1785024000000&endAt=1785110400000`,
    ),
    { params: Promise.resolve({ websiteId }) },
  );

  expect(response.status).toBe(401);
  expect(getWebsiteEventStats).not.toHaveBeenCalled();
});
