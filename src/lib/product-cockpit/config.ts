import { z } from 'zod';
import { isServerEventName } from '@/lib/server-events';

const aliasesSchema = z.array(z.string().min(1).max(80)).min(1).max(20);

const countMetricSchema = z.object({
  id: z.string().min(1).max(50),
  label: z.string().min(1).max(80),
  description: z.string().max(180).optional(),
  type: z.literal('count'),
  events: aliasesSchema,
  provenance: z.enum(['browser', 'server']).default('browser'),
  measure: z.enum(['events', 'sessions', 'accounts']).default('sessions'),
});

const rateMetricSchema = z.object({
  id: z.string().min(1).max(50),
  label: z.string().min(1).max(80),
  description: z.string().max(180).optional(),
  type: z.literal('rate'),
  numerator: aliasesSchema,
  denominator: aliasesSchema,
  provenance: z.enum(['browser', 'server']).default('browser'),
  measure: z.enum(['events', 'sessions', 'accounts']).default('sessions'),
});

const funnelSchema = z.object({
  id: z.string().min(1).max(50),
  label: z.string().min(1).max(80),
  reportId: z.uuid().optional(),
  steps: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        events: aliasesSchema,
      }),
    )
    .min(2)
    .max(8),
});

const featureSchema = z.object({
  id: z.string().min(1).max(50),
  label: z.string().min(1).max(80),
  events: aliasesSchema,
});

const filterSchema = z.object({
  name: z.string().min(1).max(50),
  operator: z.enum([
    'eq',
    'neq',
    's',
    'ns',
    'c',
    'dnc',
    're',
    'nre',
    't',
    'f',
    'gt',
    'lt',
    'gte',
    'lte',
    'bf',
    'af',
  ]),
  value: z.string().max(200),
});

const managedSegmentSchema = z.object({
  managedKey: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  match: z.enum(['all', 'any']).optional(),
  filters: z.array(filterSchema).max(20).default([]),
});

const managedCohortSchema = managedSegmentSchema.extend({
  dateRange: z.string().regex(/^(?:\d+(?:hour|day|week|month|year)|all)$/),
  action: z.object({
    type: z.enum(['path', 'event']),
    value: z.string().min(1).max(200),
  }),
});

const managedReportSchema = z.object({
  managedKey: z.string().min(1).max(50),
  type: z.enum(['funnel', 'goal', 'retention', 'performance']),
  name: z.string().min(1).max(200),
  description: z.string().max(500).default(''),
  parameters: z.record(z.string(), z.unknown()),
});

const websiteCockpitSchema = z.object({
  websiteId: z.uuid(),
  title: z.string().min(1).max(80).default('Product cockpit'),
  authoritativeEvents: z
    .array(
      z.string().min(1).max(80).refine(isServerEventName, 'Must use the reserved server namespace'),
    )
    .max(50)
    .default([]),
  metrics: z
    .array(z.discriminatedUnion('type', [countMetricSchema, rateMetricSchema]))
    .max(8)
    .default([]),
  funnels: z.array(funnelSchema).max(6).default([]),
  features: z.array(featureSchema).max(12).default([]),
  content: z
    .object({
      idProperty: z.string().min(1).max(50),
      viewEvent: z.string().min(1).max(80),
      engagedEvent: z.string().min(1).max(80),
      limit: z.number().int().positive().max(20).default(10),
    })
    .optional(),
  bootstrap: z
    .object({
      segments: z.array(managedSegmentSchema).max(30).default([]),
      cohorts: z.array(managedCohortSchema).max(30).default([]),
      reports: z.array(managedReportSchema).max(30).default([]),
    })
    .optional(),
});

const productCockpitSchema = z.object({
  websites: z.array(websiteCockpitSchema).max(100),
});

export type ProductCockpitConfig = z.infer<typeof websiteCockpitSchema>;

let cachedSource: string | undefined;
let cachedConfig: z.infer<typeof productCockpitSchema> | null = null;

/**
 * Reads optional product analytics presentation configuration.
 *
 * The contract is deliberately product-neutral so a deployment can describe
 * its own events without adding customer names or event aliases to the fork.
 * Invalid configuration fails closed and leaves the standard Umami overview
 * untouched.
 */
export function getProductCockpitConfig(
  websiteId: string,
  source = process.env.PRODUCT_COCKPIT_CONFIG,
): ProductCockpitConfig | null {
  if (!source) return null;

  if (source !== cachedSource) {
    cachedSource = source;
    try {
      cachedConfig = productCockpitSchema.parse(JSON.parse(source));
    } catch {
      cachedConfig = null;
      console.error('Invalid PRODUCT_COCKPIT_CONFIG; product cockpit disabled');
    }
  }

  return cachedConfig?.websites.find(config => config.websiteId === websiteId) ?? null;
}
