import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { type Period, type Query, UmamiAgentClient, UmamiApiError } from './client';
import type { McpConfig } from './config';

const presetSchema = z.enum(['day', 'week', 'month']).optional();
const periodShape = {
  preset: presetSchema.describe('Previous complete day, week, or month. Defaults to week.'),
  timezone: z.string().optional().describe('IANA timezone. Defaults to server configuration.'),
  startAt: z.iso
    .datetime()
    .optional()
    .describe('Custom range start, inclusive ISO-8601 timestamp.'),
  endAt: z.iso.datetime().optional().describe('Custom range end, inclusive ISO-8601 timestamp.'),
};
function createPeriodInput<T extends z.ZodRawShape>(extra?: T) {
  return z
    .object({ ...periodShape, ...extra })
    .strict()
    .refine(
      value => {
        const period = value as { startAt?: string; endAt?: string };
        return Boolean(period.startAt) === Boolean(period.endAt);
      },
      {
        message: 'startAt and endAt must be provided together',
      },
    )
    .refine(
      value => {
        const period = value as { preset?: string; startAt?: string };
        return !(period.preset && period.startAt);
      },
      {
        message: 'Use either preset or startAt/endAt',
      },
    );
}

type PeriodInput = {
  preset?: 'day' | 'week' | 'month';
  timezone?: string;
  startAt?: string;
  endAt?: string;
};

function resolvePeriod(input: PeriodInput, timezone: string): Period {
  if (input.startAt && input.endAt) {
    return { startAt: input.startAt, endAt: input.endAt, timezone: input.timezone || timezone };
  }
  return { preset: input.preset || 'week', timezone: input.timezone || timezone };
}

function toolResult(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: { result: data },
  };
}

function toolError(error: unknown): CallToolResult {
  const apiError = error instanceof UmamiApiError ? error : null;
  const message = error instanceof Error ? error.message : 'Unknown Umami MCP error';
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
    structuredContent: {
      error: {
        message,
        ...(apiError?.status ? { status: apiError.status } : {}),
        ...(apiError?.code ? { code: apiError.code } : {}),
      },
    },
  };
}

function registerQueryTool(
  server: McpServer,
  client: UmamiAgentClient,
  name: string,
  title: string,
  description: string,
  schema: z.ZodType<Record<string, unknown>>,
  makeQuery: (input: Record<string, any>) => Query,
) {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: schema,
    },
    async input => {
      try {
        return toolResult(await client.query(makeQuery(input)));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

export function createServer(config: McpConfig, client = new UmamiAgentClient(config)) {
  const server = new McpServer({
    name: `umami-${config.project}`,
    version: '0.1.0',
  });
  const prefix = `umami_${config.project}`;

  server.registerTool(
    `${prefix}_catalog`,
    {
      title: 'Umami analytics catalog',
      description:
        'Discover the scopes, query kinds, dimensions, periods, and product metrics available to this project key.',
      inputSchema: {},
    },
    async () => {
      try {
        return toolResult(await client.catalog());
      } catch (error) {
        return toolError(error);
      }
    },
  );

  registerQueryTool(
    server,
    client,
    `${prefix}_snapshot`,
    'Analytics snapshot',
    'Executive traffic summary with current values, previous-period values, and deltas.',
    createPeriodInput(),
    input => ({ kind: 'snapshot', period: resolvePeriod(input, config.timezone) }),
  );
  registerQueryTool(
    server,
    client,
    `${prefix}_timeseries`,
    'Analytics timeseries',
    'Bounded pageview and visitor trend for diagnosis, reporting, and anomaly analysis.',
    createPeriodInput({
      unit: z.enum(['hour', 'day', 'month']).optional(),
    }),
    input => ({
      kind: 'timeseries',
      period: resolvePeriod(input, config.timezone),
      ...(input.unit ? { unit: input.unit } : {}),
    }),
  );
  registerQueryTool(
    server,
    client,
    `${prefix}_breakdown`,
    'Analytics breakdown',
    'Top values for a bounded acquisition, content, geography, or technology dimension.',
    createPeriodInput({
      dimension: z.enum([
        'path',
        'referrer',
        'title',
        'hostname',
        'utmSource',
        'utmMedium',
        'utmCampaign',
        'country',
        'region',
        'city',
        'browser',
        'os',
        'device',
        'language',
      ]),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    input => ({
      kind: 'breakdown',
      period: resolvePeriod(input, config.timezone),
      dimension: input.dimension,
      ...(input.limit ? { limit: input.limit } : {}),
    }),
  );
  registerQueryTool(
    server,
    client,
    `${prefix}_product_health`,
    'Product health',
    'Configured funnels, goals, retention, activation, engagement, and product-health comparisons.',
    createPeriodInput(),
    input => ({ kind: 'product', period: resolvePeriod(input, config.timezone) }),
  );
  registerQueryTool(
    server,
    client,
    `${prefix}_content_performance`,
    'Content performance',
    'Content acquisition and engagement performance without loading unrelated product analytics.',
    createPeriodInput(),
    input => ({ kind: 'content', period: resolvePeriod(input, config.timezone) }),
  );
  registerQueryTool(
    server,
    client,
    `${prefix}_quality`,
    'Experience quality',
    'Core Web Vitals and performance sample coverage for engineering and quality agents.',
    createPeriodInput(),
    input => ({ kind: 'quality', period: resolvePeriod(input, config.timezone) }),
  );
  registerQueryTool(
    server,
    client,
    `${prefix}_moderation_queue`,
    'Moderation review queue',
    'Current open session-review queue. This is an as-of-now read and never mutates moderation state.',
    z
      .object({
        limit: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
    input => ({ kind: 'moderation', ...(input.limit ? { limit: input.limit } : {}) }),
  );

  server.registerResource(
    `${prefix}_catalog`,
    `umami://${config.project}/catalog`,
    {
      title: 'Umami analytics catalog',
      description: 'Live machine-readable capabilities for the configured project and service key.',
      mimeType: 'application/json',
    },
    async uri => {
      const catalog = await client.catalog();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(catalog, null, 2),
          },
        ],
      };
    },
  );

  return server;
}
