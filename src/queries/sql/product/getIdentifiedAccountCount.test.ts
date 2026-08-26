import { beforeEach, expect, test, vi } from 'vitest';
import clickhouse from '@/lib/clickhouse';
import prisma from '@/lib/prisma';
import { getIdentifiedAccountCount } from './getIdentifiedAccountCount';

const queryBackend = vi.hoisted(() => ({ current: 'prisma' }));

vi.mock('@/lib/db', () => ({
  PRISMA: 'prisma',
  CLICKHOUSE: 'clickhouse',
  runQuery: (queries: Record<string, () => Promise<unknown>>) => queries[queryBackend.current](),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    parseFilters: vi.fn(filters => ({
      filterQuery: '',
      cohortQuery: '',
      joinSessionQuery: 'left join session on session.session_id = website_event.session_id',
      queryParams: {
        websiteId: filters.websiteId,
        startDate: filters.startDate,
        endDate: filters.endDate,
      },
    })),
    rawQuery: vi.fn(),
    client: {
      verifiedSessionIdentity: {
        findMany: vi.fn(),
      },
    },
  },
}));

vi.mock('@/lib/clickhouse', () => ({
  default: {
    parseFilters: vi.fn(filters => ({
      filterQuery: '',
      cohortQuery: '',
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
const filters = {
  startDate: new Date('2026-08-01T00:00:00.000Z'),
  endDate: new Date('2026-08-31T23:59:59.999Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  queryBackend.current = 'prisma';
});

test('counts only proof-backed account identities in Postgres', async () => {
  vi.mocked(prisma.rawQuery).mockResolvedValue([{ accounts: 3 }]);

  await expect(getIdentifiedAccountCount(websiteId, filters)).resolves.toBe(3);

  const [sql] = vi.mocked(prisma.rawQuery).mock.calls[0];
  expect(sql).toContain('count(distinct verified_identity.distinct_id)');
  expect(sql).toContain('inner join verified_session_identity verified_identity');
  expect(sql).toContain('verified_identity.session_id = website_event.session_id');
  expect(sql).not.toContain("count(distinct nullif(session.distinct_id, ''))");
});

test('restricts ClickHouse activity to sessions with a proof-backed identity', async () => {
  queryBackend.current = 'clickhouse';
  vi.mocked(prisma.client.verifiedSessionIdentity.findMany).mockResolvedValue([
    { sessionId: '11111111-1111-4111-8111-111111111111' },
    { sessionId: '22222222-2222-4222-8222-222222222222' },
  ] as never);
  vi.mocked(clickhouse.rawQuery).mockResolvedValue([{ accounts: 2 }]);

  await expect(getIdentifiedAccountCount(websiteId, filters)).resolves.toBe(2);

  const [sql, params] = vi.mocked(clickhouse.rawQuery).mock.calls[0];
  expect(sql).toContain('session_id in {verifiedSessionIds:Array(UUID)}');
  expect(params.verifiedSessionIds).toEqual([
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ]);
});

test('returns zero without querying ClickHouse when there are no verified sessions', async () => {
  queryBackend.current = 'clickhouse';
  vi.mocked(prisma.client.verifiedSessionIdentity.findMany).mockResolvedValue([]);

  await expect(getIdentifiedAccountCount(websiteId, filters)).resolves.toBe(0);
  expect(clickhouse.rawQuery).not.toHaveBeenCalled();
});
