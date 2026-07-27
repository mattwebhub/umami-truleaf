import { z } from 'zod';
import { agentPeriodSchema } from '@/lib/agent-api/period';
import type { ServiceApiKeyScope } from '@/lib/service-api-key';

export const AGENT_BREAKDOWN_DIMENSIONS = [
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
] as const;

const withPeriod = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...shape, period: agentPeriodSchema }).strict();

export const agentQuerySchema = z.discriminatedUnion('kind', [
  withPeriod({ kind: z.literal('snapshot') }),
  withPeriod({
    kind: z.literal('timeseries'),
    unit: z.enum(['hour', 'day', 'month']).optional(),
  }),
  withPeriod({
    kind: z.literal('breakdown'),
    dimension: z.enum(AGENT_BREAKDOWN_DIMENSIONS),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  withPeriod({ kind: z.literal('product') }),
  withPeriod({ kind: z.literal('content') }),
  withPeriod({ kind: z.literal('quality') }),
  z
    .object({
      kind: z.literal('moderation'),
      limit: z.number().int().min(1).max(50).default(20),
    })
    .strict(),
]);

export type AgentQuery = z.infer<typeof agentQuerySchema>;

export const AGENT_QUERY_SCOPES: Record<AgentQuery['kind'], ServiceApiKeyScope> = {
  snapshot: 'analytics:summary:read',
  timeseries: 'analytics:summary:read',
  breakdown: 'analytics:summary:read',
  product: 'analytics:product:read',
  content: 'analytics:content:read',
  quality: 'analytics:quality:read',
  moderation: 'moderation:read',
};

export const AGENT_QUERY_COSTS: Record<AgentQuery['kind'], number> = {
  snapshot: 2,
  timeseries: 2,
  breakdown: 2,
  product: 10,
  content: 3,
  quality: 2,
  moderation: 1,
};
