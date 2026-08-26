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
        select count(distinct verified_identity.distinct_id) as accounts
        from website_event
        ${cohortQuery}
        ${joinSessionQuery}
        inner join verified_session_identity verified_identity
          on verified_identity.website_id = website_event.website_id
          and verified_identity.session_id = website_event.session_id
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
      const verifiedSessions = await prisma.client.verifiedSessionIdentity.findMany({
        where: { websiteId },
        select: { sessionId: true },
      });
      const verifiedSessionIds = verifiedSessions.map(({ sessionId }) => sessionId);

      if (!verifiedSessionIds.length) {
        return 0;
      }

      const { filterQuery, cohortQuery, queryParams } = clickhouse.parseFilters({
        ...filters,
        websiteId,
      });
      const result = await clickhouse.rawQuery<{ accounts: number }>(
        `
        select uniqIf(distinct_id, session_id in {verifiedSessionIds:Array(UUID)}) as accounts
        from website_event
        ${cohortQuery}
        where website_id = {websiteId:UUID}
          and created_at between {startDate:DateTime64} and {endDate:DateTime64}
          ${filterQuery}
        `,
        { ...queryParams, verifiedSessionIds },
        'getIdentifiedAccountCount',
      );
      return Number(result?.[0]?.accounts ?? 0);
    },
  });
}
