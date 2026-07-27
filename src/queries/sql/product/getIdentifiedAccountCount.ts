import clickhouse from '@/lib/clickhouse';
import { CLICKHOUSE, PRISMA, runQuery } from '@/lib/db';
import prisma from '@/lib/prisma';
import type { QueryFilters } from '@/lib/types';

export async function getIdentifiedAccountCount(websiteId: string, filters: QueryFilters) {
  return runQuery({
    [PRISMA]: async () => {
      const { filterQuery, joinSessionQuery, cohortQuery, queryParams } = prisma.parseFilters(
        { ...filters, websiteId },
        { joinSession: true },
      );
      const result = await prisma.rawQuery(
        `
        select count(distinct nullif(session.distinct_id, '')) as accounts
        from website_event
        ${cohortQuery}
        ${joinSessionQuery}
        where website_event.website_id = {{websiteId::uuid}}
          and website_event.created_at between {{startDate}} and {{endDate}}
          ${filterQuery}
        `,
        queryParams,
        'getIdentifiedAccountCount',
      );
      return Number(result?.[0]?.accounts ?? 0);
    },
    [CLICKHOUSE]: async () => {
      const { filterQuery, cohortQuery, queryParams } = clickhouse.parseFilters({
        ...filters,
        websiteId,
      });
      const result = await clickhouse.rawQuery<{ accounts: number }>(
        `
        select uniqIf(distinct_id, distinct_id != '') as accounts
        from website_event
        ${cohortQuery}
        where website_id = {websiteId:UUID}
          and created_at between {startDate:DateTime64} and {endDate:DateTime64}
          ${filterQuery}
        `,
        queryParams,
        'getIdentifiedAccountCount',
      );
      return Number(result?.[0]?.accounts ?? 0);
    },
  });
}
