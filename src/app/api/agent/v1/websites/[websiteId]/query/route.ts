import { readBoundedJson } from '@/lib/agent-api/body';
import { resolveAgentPeriod } from '@/lib/agent-api/period';
import { agentApiRateLimitError, serviceApiKeyError } from '@/lib/agent-api/response';
import {
  AGENT_QUERY_COSTS,
  AGENT_QUERY_SCOPES,
  type AgentQuery,
  agentQuerySchema,
} from '@/lib/agent-api/schema';
import prisma from '@/lib/prisma';
import {
  getProductCockpitData,
  getProductCockpitGroupCount,
  getProductContentData,
} from '@/lib/product-cockpit/service';
import { badRequest, payloadTooLarge } from '@/lib/response';
import {
  authenticateServiceApiKey,
  enforceAgentApiIngressLimit,
  recordServiceApiKeyAuditSafely,
} from '@/lib/service-api-key';
import type { QueryFilters } from '@/lib/types';
import {
  getPageviewMetrics,
  getPageviewStats,
  getPerformanceStats,
  getSessionMetrics,
  getSessionStats,
  getWebsiteStats,
} from '@/queries/sql';

const SESSION_DIMENSIONS = new Set([
  'country',
  'region',
  'city',
  'browser',
  'os',
  'device',
  'language',
]);
const MAX_TIMESERIES_BUCKETS = 500;
const MAX_AGENT_PRODUCT_GROUPS = 32;

function numeric(value: unknown) {
  return Number(value ?? 0);
}

function metric(
  id: string,
  unit: string,
  value: number,
  previous: number,
  numerator?: number,
  denominator?: number,
) {
  return {
    id,
    unit,
    value,
    previous,
    delta: value - previous,
    deltaPercent: previous === 0 ? null : ((value - previous) / previous) * 100,
    ...(numerator === undefined ? {} : { numerator }),
    ...(denominator === undefined ? {} : { denominator }),
  };
}

function chooseUnit(query: Extract<AgentQuery, { kind: 'timeseries' }>, durationMs: number) {
  if (query.unit) return query.unit;
  if (durationMs <= 2 * 24 * 60 * 60 * 1000) return 'hour';
  if (durationMs > 120 * 24 * 60 * 60 * 1000) return 'month';
  return 'day';
}

function estimateTimeseriesBuckets(unit: 'hour' | 'day' | 'month', durationMs: number) {
  const hour = 60 * 60 * 1000;
  if (unit === 'hour') return Math.ceil(durationMs / hour);
  if (unit === 'day') return Math.ceil(durationMs / (24 * hour));
  return Math.ceil(durationMs / (28 * 24 * hour));
}

async function runQuery(
  websiteId: string,
  query: AgentQuery,
  current: QueryFilters | null,
  previous: QueryFilters | null,
) {
  if (query.kind !== 'moderation' && (!current || !previous)) {
    throw new Error('Analytics query requires a resolved period');
  }
  const filters = current as QueryFilters;
  const previousFilters = previous as QueryFilters;

  switch (query.kind) {
    case 'snapshot': {
      const [stats, previousStats] = await Promise.all([
        getWebsiteStats(websiteId, filters),
        getWebsiteStats(websiteId, previousFilters),
      ]);
      const currentValues = stats as unknown as Record<string, number>;
      const previousValues = previousStats as unknown as Record<string, number>;
      const visits = numeric(currentValues.visits);
      const previousVisits = numeric(previousValues.visits);
      const bounces = numeric(currentValues.bounces);
      const previousBounces = numeric(previousValues.bounces);

      return {
        metrics: [
          metric(
            'pageviews',
            'count',
            numeric(currentValues.pageviews),
            numeric(previousValues.pageviews),
          ),
          metric(
            'visitors',
            'count',
            numeric(currentValues.visitors),
            numeric(previousValues.visitors),
          ),
          metric('visits', 'count', visits, previousVisits),
          metric(
            'bounceRate',
            'percent',
            visits > 0 ? (bounces / visits) * 100 : 0,
            previousVisits > 0 ? (previousBounces / previousVisits) * 100 : 0,
            bounces,
            visits,
          ),
          metric(
            'averageVisitDuration',
            'seconds',
            visits > 0 ? numeric(currentValues.totaltime) / visits : 0,
            previousVisits > 0 ? numeric(previousValues.totaltime) / previousVisits : 0,
          ),
        ],
      };
    }
    case 'timeseries': {
      const durationMs = filters.endDate.getTime() - filters.startDate.getTime();
      const unit = chooseUnit(query, durationMs);
      if (estimateTimeseriesBuckets(unit, durationMs) > MAX_TIMESERIES_BUCKETS) {
        throw new AgentQueryAdmissionError(
          `Timeseries cannot exceed ${MAX_TIMESERIES_BUCKETS} buckets`,
        );
      }
      const seriesFilters = { ...filters, unit };
      const [pageviews, visitors] = await Promise.all([
        getPageviewStats(websiteId, seriesFilters),
        getSessionStats(websiteId, seriesFilters),
      ]);
      return { unit, series: { pageviews, visitors } };
    }
    case 'breakdown': {
      const rows = SESSION_DIMENSIONS.has(query.dimension)
        ? await getSessionMetrics(websiteId, { type: query.dimension, limit: query.limit }, filters)
        : await getPageviewMetrics(
            websiteId,
            { type: query.dimension, limit: query.limit },
            filters,
          );
      return {
        dimension: query.dimension,
        measure: 'unique-sessions',
        rows: rows.map((row: { x: string; y: number; country?: string }) => ({
          value: row.x,
          sessions: numeric(row.y),
          ...(row.country ? { country: row.country } : {}),
        })),
      };
    }
    case 'product':
      if (getProductCockpitGroupCount(websiteId) > MAX_AGENT_PRODUCT_GROUPS) {
        throw new AgentQueryAdmissionError(
          `Product query cannot exceed ${MAX_AGENT_PRODUCT_GROUPS} metric groups`,
        );
      }
      return getProductCockpitData({
        websiteId,
        current: filters,
        previous: previousFilters,
      });
    case 'content':
      return getProductContentData({
        websiteId,
        current: filters,
        previous: previousFilters,
      });
    case 'quality': {
      const [quality, previousQuality] = await Promise.all([
        getPerformanceStats(websiteId, filters),
        getPerformanceStats(websiteId, previousFilters),
      ]);
      return {
        percentile: 75,
        metrics: ['lcp', 'inp', 'cls', 'fcp', 'ttfb'].map(id =>
          metric(
            id,
            id === 'cls' ? 'score' : 'milliseconds',
            numeric(quality[id]),
            numeric(previousQuality[id]),
          ),
        ),
        sampleCount: numeric(quality.count),
        previousSampleCount: numeric(previousQuality.count),
      };
    }
    case 'moderation': {
      const [openReviews, reviews] = await Promise.all([
        prisma.client.sessionReview.count({
          where: { websiteId, status: 'open' },
        }),
        prisma.client.sessionReview.findMany({
          where: { websiteId, status: 'open' },
          select: {
            id: true,
            sessionId: true,
            status: true,
            severity: true,
            reason: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ severityRank: 'asc' }, { updatedAt: 'desc' }],
          take: query.limit,
        }),
      ]);
      return { openReviews, reviews };
    }
  }
}

class AgentQueryAdmissionError extends Error {}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  if (await enforceAgentApiIngressLimit(request)) return agentApiRateLimitError();

  const rawBody = await readBoundedJson(request);
  if ('reason' in rawBody) {
    return rawBody.reason === 'too-large'
      ? payloadTooLarge({ message: 'Agent query body cannot exceed 16 KiB' })
      : badRequest({ message: 'Invalid JSON body' });
  }

  const parsed = agentQuerySchema.safeParse(rawBody.value);
  if (!parsed.success) {
    return badRequest({ issues: parsed.error.issues });
  }

  const { websiteId } = await params;
  const query = parsed.data;
  const auth = await authenticateServiceApiKey(
    request,
    websiteId,
    AGENT_QUERY_SCOPES[query.kind],
    AGENT_QUERY_COSTS[query.kind],
  );
  if (!auth.ok) return serviceApiKeyError(auth);

  const period = query.kind === 'moderation' ? null : resolveAgentPeriod(query.period);
  const current: QueryFilters | null = period
    ? {
        startDate: period.startDate,
        endDate: period.endDate,
        timezone: period.timezone,
      }
    : null;
  const previous: QueryFilters | null =
    period && current
      ? {
          ...current,
          startDate: period.comparisonStartDate,
          endDate: period.comparisonEndDate,
        }
      : null;
  const startedAt = performance.now();
  let data: Awaited<ReturnType<typeof runQuery>>;
  try {
    data = await runQuery(websiteId, query, current, previous);
    await recordServiceApiKeyAuditSafely({
      keyId: auth.key.id,
      websiteId,
      action: 'query',
      queryType: query.kind,
      status: 'success',
      durationMs: Math.round(performance.now() - startedAt),
      requestId: request.headers.get('x-request-id') ?? undefined,
    });
  } catch (error) {
    await recordServiceApiKeyAuditSafely({
      keyId: auth.key.id,
      websiteId,
      action: 'query',
      queryType: query.kind,
      status: 'error',
      durationMs: Math.round(performance.now() - startedAt),
      requestId: request.headers.get('x-request-id') ?? undefined,
    });
    if (error instanceof AgentQueryAdmissionError) {
      return badRequest({ message: error.message });
    }
    throw error;
  }
  const queryDescription = {
    kind: query.kind,
    ...('dimension' in query ? { dimension: query.dimension, limit: query.limit } : {}),
    ...(query.kind === 'timeseries' && query.unit ? { unit: query.unit } : {}),
    ...(query.kind === 'moderation' ? { limit: query.limit } : {}),
  };
  const warnings = [
    ...(period && !period.complete ? ['The requested period is not complete.'] : []),
    ...(query.kind === 'product' && 'enabled' in data && !data.enabled
      ? ['Product analytics are not configured for this website.']
      : []),
    ...(query.kind === 'product'
      ? ['Retention is based on Umami sessions, not durable authenticated accounts.']
      : []),
  ];

  return Response.json({
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    websiteId,
    query: queryDescription,
    period: period
      ? {
          preset: period.preset,
          timezone: period.timezone,
          complete: period.complete,
          startAt: period.startDate.toISOString(),
          endAt: period.endDate.toISOString(),
        }
      : null,
    comparison: period
      ? {
          startAt: period.comparisonStartDate.toISOString(),
          endAt: period.comparisonEndDate.toISOString(),
        }
      : null,
    provenance: {
      source: 'umami',
      browserFactsFilterScope: 'date-and-dimensions',
      serverFactsFilterScope: 'date-only',
    },
    coverage: {
      periodComplete: period?.complete ?? null,
      identityBasis:
        query.kind === 'product'
          ? 'Mixed: explicit distinct IDs where reported; otherwise Umami sessions'
          : 'Umami sessions',
      dataFreshAt: new Date().toISOString(),
    },
    data,
    warnings,
  });
}
