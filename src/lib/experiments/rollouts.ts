import { z } from 'zod';

export const rolloutInputSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
    name: z.string().trim().min(1).max(120),
    treatmentPercent: z.number().int().min(0).max(100),
    expectedRevision: z.uuid().nullable(),
  })
  .strict();

export type RolloutPublicRow = {
  key: string;
  treatmentPercent: number;
  revision: string;
};

export const DEFAULT_ROLLOUT = {
  key: 'insight-signup-v1',
  name: 'Insights one-click signup',
  treatmentPercent: 50,
  revision: 'initial-50',
} as const;

export function withDefaultRollout(rows: RolloutPublicRow[]): RolloutPublicRow[] {
  return rows.some(row => row.key === DEFAULT_ROLLOUT.key) ? rows : [...rows, DEFAULT_ROLLOUT];
}

/** The public feed intentionally excludes website IDs, names and operator data. */
export function toPublicRollouts(rows: RolloutPublicRow[]) {
  return {
    experiments: Object.fromEntries(
      rows.map(({ key, treatmentPercent, revision }) => [key, { treatmentPercent, revision }]),
    ),
  };
}
