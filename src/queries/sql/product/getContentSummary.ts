import clickhouse from '@/lib/clickhouse';
import { DATA_TYPE } from '@/lib/constants';
import { CLICKHOUSE, PRISMA, runQuery } from '@/lib/db';
import prisma from '@/lib/prisma';
import type { QueryFilters } from '@/lib/types';

export type ContentSummaryPoint = {
  contentId: string;
  views: number;
  engaged: number;
};

type ContentSummary = {
  current: ContentSummaryPoint[];
  previous: ContentSummaryPoint[];
};

type Args = {
  websiteId: string;
  viewEvent: string;
  engagedEvent: string;
  propertyName: string;
  current: QueryFilters;
  previous: QueryFilters;
  limit: number;
};

function normalize(rows: Array<Record<string, unknown>>): ContentSummaryPoint[] {
  return rows.map(row => ({
    contentId: String(row.contentId ?? ''),
    views: Number(row.views ?? 0),
    engaged: Number(row.engaged ?? 0),
  }));
}

export async function getContentSummary(args: Args): Promise<ContentSummary> {
  return runQuery({
    [PRISMA]: () => relationalQuery(args),
    [CLICKHOUSE]: () => clickhouseQuery(args),
  });
}

async function relationalQuery({
  websiteId,
  viewEvent,
  engagedEvent,
  propertyName,
  current,
  previous,
  limit,
}: Args): Promise<ContentSummary> {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  const getRows = async (
    filters: QueryFilters,
    contentIds?: string[],
  ): Promise<ContentSummaryPoint[]> => {
    const { filterQuery, cohortQuery, joinSessionQuery, queryParams } = prisma.parseFilters({
      ...filters,
      websiteId,
    });
    const rows = await prisma.rawQuery(
      `
      select
        event_data.string_value as "contentId",
        count(*) filter (where website_event.event_name = {{viewEvent}}) as views,
        count(*) filter (where website_event.event_name = {{engagedEvent}}) as engaged
      from event_data
      join website_event on website_event.event_id = event_data.website_event_id
        and website_event.website_id = {{websiteId::uuid}}
        and website_event.created_at between {{startDate}} and {{endDate}}
        and website_event.event_type = 2
        and website_event.event_name = ANY({{eventNames}})
      ${cohortQuery}
      ${joinSessionQuery}
      where event_data.website_id = {{websiteId::uuid}}
        and event_data.created_at between {{startDate}} and {{endDate}}
        and event_data.data_key = {{propertyName}}
        and event_data.data_type in (${DATA_TYPE.string}, ${DATA_TYPE.boolean})
        ${contentIds ? 'and event_data.string_value = ANY({{contentIds}})' : ''}
        ${filterQuery}
      group by 1
      order by engaged desc, views desc, 1
      ${contentIds ? '' : `limit ${boundedLimit}`}
      `,
      {
        ...queryParams,
        viewEvent,
        engagedEvent,
        eventNames: [viewEvent, engagedEvent],
        propertyName,
        ...(contentIds ? { contentIds } : {}),
      },
      'getContentSummary',
    );
    return normalize(rows);
  };

  const currentRows = await getRows(current);
  const contentIds = currentRows.map(row => row.contentId);
  const previousRows = contentIds.length > 0 ? await getRows(previous, contentIds) : [];
  return { current: currentRows, previous: previousRows };
}

async function clickhouseQuery({
  websiteId,
  viewEvent,
  engagedEvent,
  propertyName,
  current,
  previous,
  limit,
}: Args): Promise<ContentSummary> {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  const getRows = async (
    filters: QueryFilters,
    contentIds?: string[],
  ): Promise<ContentSummaryPoint[]> => {
    const { filterQuery, cohortQuery, queryParams } = clickhouse.parseFilters({
      ...filters,
      websiteId,
    });
    const rows = await clickhouse.rawQuery<Record<string, unknown>[]>(
      `
      select
        event_data.string_value as contentId,
        countIf(event_data.event_name = {viewEvent:String}) as views,
        countIf(event_data.event_name = {engagedEvent:String}) as engaged
      from event_data
      any left join website_event
        on website_event.event_id = event_data.event_id
        and website_event.session_id = event_data.session_id
        and website_event.website_id = event_data.website_id
      ${cohortQuery}
      where event_data.website_id = {websiteId:UUID}
        and event_data.created_at between {startDate:DateTime64} and {endDate:DateTime64}
        and event_data.event_name in {eventNames:Array(String)}
        and event_data.data_key = {propertyName:String}
        and event_data.data_type in (${DATA_TYPE.string}, ${DATA_TYPE.boolean})
        ${contentIds ? 'and event_data.string_value in {contentIds:Array(String)}' : ''}
        ${filterQuery}
      group by contentId
      order by engaged desc, views desc, contentId
      ${contentIds ? '' : `limit ${boundedLimit}`}
      `,
      {
        ...queryParams,
        viewEvent,
        engagedEvent,
        eventNames: [viewEvent, engagedEvent],
        propertyName,
        ...(contentIds ? { contentIds } : {}),
      },
      'getContentSummary',
    );
    return normalize(rows);
  };

  const currentRows = await getRows(current);
  const contentIds = currentRows.map(row => row.contentId);
  const previousRows = contentIds.length > 0 ? await getRows(previous, contentIds) : [];
  return { current: currentRows, previous: previousRows };
}
