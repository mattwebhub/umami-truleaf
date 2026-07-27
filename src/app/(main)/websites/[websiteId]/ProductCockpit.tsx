'use client';

import { Button, Column, Grid, Heading, Row, Text, useToast } from '@umami/react-zen';
import Link from '@/components/common/Link';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import { Panel } from '@/components/common/Panel';
import { useApi, useDateParameters, useFilterParameters, useWebsite } from '@/components/hooks';
import type { ProductCockpitConfig } from '@/lib/product-cockpit/config';

type Metric = {
  id: string;
  label: string;
  description?: string;
  type: 'count' | 'rate';
  provenance: 'browser' | 'server';
  filterScope: 'all' | 'date';
  measure: 'events' | 'sessions' | 'accounts';
  value: number;
  previous: number;
  numerator?: number;
  denominator?: number;
};

type CockpitData = {
  range: {
    startAt: number;
    endAt: number;
    comparisonStartAt: number;
    comparisonEndAt: number;
  };
  overview: {
    visitors: number;
    previousVisitors: number;
    activeAccounts: number;
    previousActiveAccounts: number;
  };
  metrics: Metric[];
  funnels: Array<{
    id: string;
    label: string;
    reportId?: string;
    steps: Array<{ label: string; events: number; sessions: number; accounts: number }>;
  }>;
  features: Array<{
    id: string;
    label: string;
    events: number;
    sessions: number;
    accounts: number;
  }>;
  retention: Array<{ day: number; cohort: number; returned: number; rate: number }>;
  performance: {
    current: { lcp: number; inp: number; cls: number; count: number };
    previous: { lcp: number; inp: number; cls: number; count: number };
  };
  moderation: { openReviews: number };
  content: {
    current: Array<{ contentId: string; views: number; engaged: number }>;
  } | null;
};

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function change(current: number, previous: number) {
  if (!previous) return current ? 'new in this period' : 'no prior-period activity';
  const percent = ((current - previous) / previous) * 100;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}% vs prior period`;
}

function MetricValue({
  label,
  value,
  detail,
  provenance,
}: {
  label: string;
  value: string;
  detail: string;
  provenance?: 'browser' | 'server';
}) {
  return (
    <Panel>
      <Column gap="2">
        <Row justifyContent="space-between" alignItems="center">
          <Text color="muted">{label}</Text>
          {provenance && (
            <Text color="muted" size="sm">
              {provenance === 'server' ? 'Verified fact' : 'Browser observed'}
            </Text>
          )}
        </Row>
        <Heading size="3xl">{value}</Heading>
        <Text color="muted" size="sm">
          {detail}
        </Text>
      </Column>
    </Panel>
  );
}

export function ProductCockpit({
  websiteId,
  config,
}: {
  websiteId: string;
  config: ProductCockpitConfig;
}) {
  const { get, post, useMutation, useQuery } = useApi();
  const { startAt, endAt, timezone, unit } = useDateParameters();
  const filters = useFilterParameters();
  const { toast } = useToast();
  const website = useWebsite();
  const query = useQuery<CockpitData>({
    queryKey: ['product-cockpit', { websiteId, startAt, endAt, timezone, unit, ...filters }],
    queryFn: () =>
      get(`/websites/${websiteId}/product-cockpit`, {
        startAt,
        endAt,
        timezone,
        unit,
        ...filters,
      }),
  });
  const bootstrap = useMutation({
    mutationFn: () => post(`/websites/${websiteId}/product-cockpit/bootstrap`),
    onSuccess: result => {
      toast(
        `Workspace ready: ${result.segments} segments, ${result.cohorts} cohorts, and ${result.reports} reports`,
      );
    },
  });

  return (
    <Column gap>
      <Row justifyContent="space-between" alignItems="center">
        <Column gap="1">
          <Heading size="2xl">{config.title}</Heading>
          <Text color="muted">
            Browser metrics use the selected filters. Verified facts use the selected date range and
            prior equal-length period.
          </Text>
        </Column>
        {config.bootstrap && website.canUpdate && (
          <Button isDisabled={bootstrap.isPending} onPress={() => bootstrap.mutate()}>
            {bootstrap.isPending ? 'Preparing workspace…' : 'Prepare analytics workspace'}
          </Button>
        )}
      </Row>

      <LoadingPanel
        data={query.data}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        error={query.error}
        minHeight="180px"
      >
        {query.data && (
          <Column gap>
            <Grid columns="repeat(auto-fit, minmax(210px, 1fr))" gap>
              <MetricValue
                label="Visitors"
                value={formatCount(query.data.overview.visitors)}
                detail={change(query.data.overview.visitors, query.data.overview.previousVisitors)}
              />
              <MetricValue
                label="Active identified accounts"
                value={formatCount(query.data.overview.activeAccounts)}
                detail={change(
                  query.data.overview.activeAccounts,
                  query.data.overview.previousActiveAccounts,
                )}
              />
              {query.data.metrics.map(metric => (
                <MetricValue
                  key={metric.id}
                  label={metric.label}
                  provenance={metric.provenance}
                  value={
                    metric.type === 'rate'
                      ? `${metric.value.toFixed(1)}%`
                      : formatCount(metric.value)
                  }
                  detail={
                    metric.type === 'rate'
                      ? `${formatCount(metric.numerator ?? 0)} of ${formatCount(
                          metric.denominator ?? 0,
                        )} unique ${metric.measure} · ${
                          metric.filterScope === 'date' ? 'date range only · ' : ''
                        }${change(metric.value, metric.previous)}`
                      : `${metric.measure} · ${
                          metric.filterScope === 'date' ? 'date range only · ' : ''
                        }${change(metric.value, metric.previous)}`
                  }
                />
              ))}
            </Grid>

            <Grid columns="repeat(auto-fit, minmax(300px, 1fr))" gap>
              {query.data.funnels.map(funnel => (
                <Panel key={funnel.id}>
                  <Column gap>
                    <Row justifyContent="space-between">
                      <Heading size="lg">{funnel.label}</Heading>
                      {funnel.reportId && (
                        <Link href={`/websites/${websiteId}/funnels?report=${funnel.reportId}`}>
                          Open funnel
                        </Link>
                      )}
                    </Row>
                    <Text color="muted" size="sm">
                      Unique-session reach; use the native funnel for ordered conversion.
                    </Text>
                    {funnel.steps.map((step, index) => {
                      const previous = funnel.steps[index - 1]?.sessions;
                      const rate = previous ? (step.sessions / previous) * 100 : null;
                      return (
                        <Row key={`${funnel.id}:${step.label}`} justifyContent="space-between">
                          <Text color="muted">
                            {index + 1}. {step.label}
                          </Text>
                          <Text>
                            {formatCount(step.sessions)}
                            {rate !== null ? ` · ${rate.toFixed(1)}%` : ''}
                          </Text>
                        </Row>
                      );
                    })}
                  </Column>
                </Panel>
              ))}

              <Panel>
                <Column gap>
                  <Heading size="lg">Retention</Heading>
                  <Text color="muted" size="sm">
                    Return sessions by first-seen cohort in this range.
                  </Text>
                  {query.data.retention.map(item => (
                    <Row key={item.day} justifyContent="space-between">
                      <Text color="muted">Day {item.day}</Text>
                      <Text>
                        {item.rate.toFixed(1)}% · {formatCount(item.returned)} of{' '}
                        {formatCount(item.cohort)}
                      </Text>
                    </Row>
                  ))}
                </Column>
              </Panel>

              <Panel>
                <Column gap>
                  <Heading size="lg">Core Web Vitals · p75</Heading>
                  <Text color="muted" size="sm">
                    {formatCount(query.data.performance.current.count)} performance samples
                  </Text>
                  {(['lcp', 'inp', 'cls'] as const).map(vital => (
                    <Row key={vital} justifyContent="space-between">
                      <Text color="muted">{vital.toUpperCase()}</Text>
                      <Text>
                        {Number(query.data.performance.current[vital] ?? 0).toFixed(
                          vital === 'cls' ? 3 : 0,
                        )}
                        {' · '}
                        {change(
                          Number(query.data.performance.current[vital] ?? 0),
                          Number(query.data.performance.previous[vital] ?? 0),
                        )}
                      </Text>
                    </Row>
                  ))}
                  <Link href={`/websites/${websiteId}/performance`}>
                    Inspect by route and device
                  </Link>
                </Column>
              </Panel>
            </Grid>

            <Grid columns="repeat(auto-fit, minmax(300px, 1fr))" gap>
              <Panel>
                <Column gap>
                  <Heading size="lg">Feature adoption</Heading>
                  {query.data.features.map(feature => (
                    <Row key={feature.id} justifyContent="space-between">
                      <Text color="muted">{feature.label}</Text>
                      <Text>{formatCount(feature.sessions)} unique sessions</Text>
                    </Row>
                  ))}
                </Column>
              </Panel>

              <Panel>
                <Column gap>
                  <Heading size="lg">Moderation review queue</Heading>
                  <Heading size="3xl">{formatCount(query.data.moderation.openReviews)}</Heading>
                  <Text color="muted">
                    Operator-authored reviews; no ban is inferred from analytics.
                  </Text>
                  <Link href={`/websites/${websiteId}/sessions`}>Open review queue</Link>
                </Column>
              </Panel>
            </Grid>

            {query.data.content && (
              <Panel>
                <Column gap>
                  <Heading size="lg">Content performance</Heading>
                  <Text color="muted" size="sm">
                    Browser-observed content events. Open native reports for unique-reader journeys
                    and assisted conversion.
                  </Text>
                  {query.data.content.current.map(item => (
                    <Row key={item.contentId} justifyContent="space-between">
                      <Text color="muted">{item.contentId}</Text>
                      <Text>
                        {formatCount(item.views)} views · {formatCount(item.engaged)} engagement
                        milestones
                      </Text>
                    </Row>
                  ))}
                </Column>
              </Panel>
            )}
          </Column>
        )}
      </LoadingPanel>
    </Column>
  );
}
