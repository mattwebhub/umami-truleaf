import { z } from 'zod';
import { getCompareDate } from '@/lib/date';
import prisma from '@/lib/prisma';
import { getProductCockpitConfig } from '@/lib/product-cockpit/config';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { filterParams, withDateRange } from '@/lib/schema';
import type { QueryFilters } from '@/lib/types';
import { canViewWebsiteSection } from '@/permissions';
import { getWebsiteEventStats } from '@/queries/sql/events/getWebsiteEventStats';
import { getWebsiteStats } from '@/queries/sql/getWebsiteStats';
import { getPerformanceStats } from '@/queries/sql/performance/getPerformanceStats';
import { getContentSummary } from '@/queries/sql/product/getContentSummary';
import { getIdentifiedAccountCount } from '@/queries/sql/product/getIdentifiedAccountCount';
import { getRetention } from '@/queries/sql/reports/getRetention';

type Totals = { events: number; sessions: number; accounts: number };
type Provenance = 'browser' | 'server';

const emptyTotals = (): Totals => ({ events: 0, sessions: 0, accounts: 0 });
const QUERY_CONCURRENCY = 6;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function getServerTotals(
  websiteId: string,
  eventNames: readonly string[],
  filters: QueryFilters,
): Promise<Totals> {
  const result = await prisma.rawQuery(
    `
    select
      count(*) as events,
      count(distinct distinct_id) as accounts
    from server_event_fact
    where website_id = {{websiteId::uuid}}
      and occurred_at between {{startDate}} and {{endDate}}
      and event_name = ANY({{eventNames}})
    `,
    {
      websiteId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      eventNames,
    },
    'getProductServerFactTotals',
  );
  const events = Number(result?.[0]?.events ?? 0);
  const accounts = Number(result?.[0]?.accounts ?? 0);
  return { events, sessions: accounts, accounts };
}

async function getBrowserTotals(
  websiteId: string,
  eventNames: readonly string[],
  filters: QueryFilters,
): Promise<Totals> {
  const stats = (await getWebsiteEventStats(websiteId, {
    ...filters,
    event: `eq.${eventNames.join(',')}`,
  })) as unknown as { events: number; visitors: number };
  return {
    events: Number(stats?.events ?? 0),
    sessions: Number(stats?.visitors ?? 0),
    // Browser analytics can prove unique sessions, not durable account identity.
    accounts: Number(stats?.visitors ?? 0),
  };
}

function getTotals(
  websiteId: string,
  provenance: Provenance,
  eventNames: readonly string[],
  filters: QueryFilters,
) {
  return provenance === 'server'
    ? getServerTotals(websiteId, eventNames, filters)
    : getBrowserTotals(websiteId, eventNames, filters);
}

function getValue(totals: Totals, measure: keyof Totals) {
  return Number(totals?.[measure] ?? 0);
}

function summarizeRetention(
  rows: Array<{ day: number; visitors: number; returnVisitors: number }>,
) {
  return [1, 7, 30].map(day => {
    const matching = rows.filter(row => Number(row.day) === day);
    const cohort = matching.reduce((sum, row) => sum + Number(row.visitors), 0);
    const returned = matching.reduce((sum, row) => sum + Number(row.returnVisitors), 0);
    return { day, cohort, returned, rate: cohort > 0 ? (returned / cohort) * 100 : 0 };
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const schema = withDateRange({
    ...filterParams,
    timezone: z.string().optional(),
    unit: z.string().optional(),
  });
  const { auth, query, error } = await parseRequest(request, schema);
  if (error) return error();

  const { websiteId } = await params;
  if (!(await canViewWebsiteSection(auth, websiteId, 'overview'))) return unauthorized();

  const config = getProductCockpitConfig(websiteId);
  if (!config) return json({ enabled: false });

  const current = await getQueryFilters(query, websiteId);
  const comparisonDates = getCompareDate('prev', current.startDate, current.endDate);
  const previous = { ...current, ...comparisonDates };

  const groups = new Map<string, { provenance: Provenance; events: readonly string[] }>();
  const addGroup = (provenance: Provenance, events: readonly string[]) => {
    const key = `${provenance}:${[...events].sort().join(',')}`;
    groups.set(key, { provenance, events });
    return key;
  };
  for (const metric of config.metrics) {
    if (metric.type === 'count') addGroup(metric.provenance, metric.events);
    else {
      addGroup(metric.provenance, metric.numerator);
      addGroup(metric.provenance, metric.denominator);
    }
  }
  for (const funnel of config.funnels) {
    for (const step of funnel.steps) addGroup('browser', step.events);
  }
  for (const feature of config.features) addGroup('browser', feature.events);

  const totals = new Map<string, { current: Totals; previous: Totals }>();
  await mapWithConcurrency([...groups.entries()], QUERY_CONCURRENCY, async ([key, group]) => {
    const currentTotals = await getTotals(websiteId, group.provenance, group.events, current);
    const previousTotals = await getTotals(websiteId, group.provenance, group.events, previous);
    totals.set(key, { current: currentTotals, previous: previousTotals });
  });
  const read = (provenance: Provenance, events: readonly string[]) =>
    totals.get(`${provenance}:${[...events].sort().join(',')}`) ?? {
      current: emptyTotals(),
      previous: emptyTotals(),
    };

  const content = config.content;
  const [
    stats,
    comparison,
    activeAccounts,
    previousActiveAccounts,
    performance,
    previousPerformance,
  ] = await Promise.all([
    getWebsiteStats(websiteId, current),
    getWebsiteStats(websiteId, previous),
    getIdentifiedAccountCount(websiteId, current),
    getIdentifiedAccountCount(websiteId, previous),
    getPerformanceStats(websiteId, current),
    getPerformanceStats(websiteId, previous),
  ]);
  const [retention, reviews, contentSummary] = await Promise.all([
    getRetention(
      websiteId,
      { startDate: current.startDate, endDate: current.endDate, timezone: current.timezone },
      current,
    ),
    prisma.client.sessionReview.count({ where: { websiteId, status: 'open' } }),
    content
      ? getContentSummary({
          websiteId,
          viewEvent: content.viewEvent,
          engagedEvent: content.engagedEvent,
          propertyName: content.idProperty,
          current,
          previous,
          limit: content.limit,
        })
      : Promise.resolve(null),
  ]);

  const metrics = config.metrics.map(metric => {
    if (metric.type === 'count') {
      const values = read(metric.provenance, metric.events);
      return {
        id: metric.id,
        label: metric.label,
        description: metric.description,
        type: metric.type,
        provenance: metric.provenance,
        filterScope: metric.provenance === 'server' ? 'date' : 'all',
        measure: metric.measure,
        value: getValue(values.current, metric.measure),
        previous: getValue(values.previous, metric.measure),
      };
    }
    const numerator = read(metric.provenance, metric.numerator);
    const denominator = read(metric.provenance, metric.denominator);
    const numeratorValue = getValue(numerator.current, metric.measure);
    const denominatorValue = getValue(denominator.current, metric.measure);
    const previousNumerator = getValue(numerator.previous, metric.measure);
    const previousDenominator = getValue(denominator.previous, metric.measure);
    return {
      id: metric.id,
      label: metric.label,
      description: metric.description,
      type: metric.type,
      provenance: metric.provenance,
      filterScope: metric.provenance === 'server' ? 'date' : 'all',
      measure: metric.measure,
      value: denominatorValue > 0 ? (numeratorValue / denominatorValue) * 100 : 0,
      numerator: numeratorValue,
      denominator: denominatorValue,
      previous: previousDenominator > 0 ? (previousNumerator / previousDenominator) * 100 : 0,
      previousNumerator,
      previousDenominator,
    };
  });

  return json({
    enabled: true,
    range: {
      startAt: current.startDate.getTime(),
      endAt: current.endDate.getTime(),
      comparisonStartAt: previous.startDate.getTime(),
      comparisonEndAt: previous.endDate.getTime(),
    },
    overview: {
      visitors: Number((stats as unknown as { visitors: number })?.visitors ?? 0),
      previousVisitors: Number((comparison as unknown as { visitors: number })?.visitors ?? 0),
      activeAccounts,
      previousActiveAccounts,
    },
    metrics,
    funnels: config.funnels.map(funnel => ({
      id: funnel.id,
      label: funnel.label,
      reportId: funnel.reportId,
      steps: funnel.steps.map(step => ({
        label: step.label,
        ...read('browser', step.events).current,
      })),
    })),
    features: config.features
      .map(feature => ({
        id: feature.id,
        label: feature.label,
        ...read('browser', feature.events).current,
      }))
      .sort((a, b) => b.sessions - a.sessions),
    retention: summarizeRetention(retention),
    performance: {
      current: performance,
      previous: previousPerformance,
    },
    moderation: { openReviews: reviews },
    content: content
      ? {
          current: contentSummary?.current ?? [],
          previous: contentSummary?.previous ?? [],
        }
      : null,
  });
}
