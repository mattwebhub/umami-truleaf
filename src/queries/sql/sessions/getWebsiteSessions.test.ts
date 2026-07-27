import { beforeEach, expect, test, vi } from 'vitest';
import { getVerifiedIdentityDistinctIdsBySearch } from '@/queries/prisma';
import { getWebsiteSessions } from './getWebsiteSessions';

const mocks = vi.hoisted(() => ({
  engine: 'prisma',
  prismaPagedRawQuery: vi.fn(),
  clickhousePagedRawQuery: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  PRISMA: 'prisma',
  CLICKHOUSE: 'clickhouse',
  runQuery: (queries: Record<string, () => Promise<unknown>>) => queries[mocks.engine](),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    parseFilters: vi.fn(filters => ({
      filterQuery: '',
      dateQuery: '',
      cohortQuery: '',
      queryParams: {
        websiteId: filters.websiteId,
        search: `%${filters.search}%`,
      },
    })),
    pagedRawQuery: mocks.prismaPagedRawQuery,
  },
}));
vi.mock('@/lib/clickhouse', () => ({
  default: {
    parseFilters: vi.fn(filters => ({
      filterQuery: '',
      dateQuery: '',
      cohortQuery: '',
      queryParams: {
        websiteId: filters.websiteId,
        search: filters.search,
      },
    })),
    getDateStringSQL: vi.fn(value => value),
    pagedRawQuery: mocks.clickhousePagedRawQuery,
  },
}));
vi.mock('@/lib/truleaf/config', () => ({
  isTruleafIdentityProfileEnabled: () => true,
  isTruleafWebsite: () => true,
}));
vi.mock('@/queries/prisma', () => ({
  getVerifiedIdentityDistinctIdsBySearch: vi.fn(async () => ['account-1']),
}));

const websiteId = 'e79ef216-70ab-48df-addc-596b6e9e65a8';
const filters = {
  search: 'matheus',
  startDate: new Date('2026-07-01T00:00:00.000Z'),
  endDate: new Date('2026-07-31T23:59:59.999Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.engine = 'prisma';
  mocks.prismaPagedRawQuery.mockResolvedValue({ data: [], count: 0 });
  mocks.clickhousePagedRawQuery.mockResolvedValue({ data: [], count: 0 });
});

test('includes verified account search matches in PostgreSQL session search', async () => {
  await getWebsiteSessions(websiteId, filters);

  expect(getVerifiedIdentityDistinctIdsBySearch).toHaveBeenCalledWith(websiteId, 'matheus');
  const [sql, params] = mocks.prismaPagedRawQuery.mock.calls[0];
  expect(sql).toContain('session.distinct_id = ANY({{identityDistinctIds}})');
  expect(params.identityDistinctIds).toEqual(['account-1']);
});

test('includes verified account search matches in ClickHouse session search', async () => {
  mocks.engine = 'clickhouse';

  await getWebsiteSessions(websiteId, filters);

  const [sql, params] = mocks.clickhousePagedRawQuery.mock.calls[0];
  expect(sql).toContain('website_event.distinct_id IN {identityDistinctIds:Array(String)}');
  expect(params.identityDistinctIds).toEqual(['account-1']);
});
