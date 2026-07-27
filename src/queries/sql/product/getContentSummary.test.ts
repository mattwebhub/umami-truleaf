import { beforeEach, expect, test, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { getContentSummary } from './getContentSummary';

vi.mock('@/lib/db', () => ({
  PRISMA: 'prisma',
  CLICKHOUSE: 'clickhouse',
  runQuery: (queries: Record<string, () => Promise<unknown>>) => queries.prisma(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    parseFilters: vi.fn(filters => ({
      filterQuery: '',
      cohortQuery: '',
      joinSessionQuery: '',
      queryParams: {
        websiteId: filters.websiteId,
        startDate: filters.startDate,
        endDate: filters.endDate,
      },
    })),
    rawQuery: vi.fn(),
  },
}));

const websiteId = 'e79ef216-70ab-48df-addc-596b6e9e65a8';
const current = {
  startDate: new Date('2026-07-01T00:00:00.000Z'),
  endDate: new Date('2026-07-31T23:59:59.999Z'),
};
const previous = {
  startDate: new Date('2026-06-01T00:00:00.000Z'),
  endDate: new Date('2026-06-30T23:59:59.999Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

test('limits high-cardinality content in SQL and scopes prior work to the bounded IDs', async () => {
  const selected = Array.from({ length: 5 }, (_, index) => ({
    contentId: `insight:selected-${index}`,
    views: 100 - index,
    engaged: 50 - index,
  }));
  vi.mocked(prisma.rawQuery)
    .mockResolvedValueOnce(selected)
    .mockResolvedValueOnce(
      selected.map(item => ({ ...item, views: item.views - 10, engaged: item.engaged - 5 })),
    );

  const result = await getContentSummary({
    websiteId,
    viewEvent: 'content-view',
    engagedEvent: 'content-engaged',
    propertyName: 'contentId',
    current,
    previous,
    limit: 5,
  });

  expect(prisma.rawQuery).toHaveBeenCalledTimes(2);
  const [currentSql] = vi.mocked(prisma.rawQuery).mock.calls[0];
  const [previousSql, previousParams] = vi.mocked(prisma.rawQuery).mock.calls[1];
  expect(currentSql).toMatch(/order by engaged desc, views desc, 1\s+limit 5/);
  expect(previousSql).toContain('event_data.string_value = ANY({{contentIds}})');
  expect(previousParams.contentIds).toEqual(selected.map(item => item.contentId));
  expect(result.current).toHaveLength(5);
  expect(result.previous).toHaveLength(5);
});

test('skips the prior-period query when no current content qualifies', async () => {
  vi.mocked(prisma.rawQuery).mockResolvedValueOnce([]);

  const result = await getContentSummary({
    websiteId,
    viewEvent: 'content-view',
    engagedEvent: 'content-engaged',
    propertyName: 'contentId',
    current,
    previous,
    limit: 5,
  });

  expect(prisma.rawQuery).toHaveBeenCalledOnce();
  expect(result).toEqual({ current: [], previous: [] });
});
