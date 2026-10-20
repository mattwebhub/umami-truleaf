import { expect, test } from 'vitest';
import { rolloutInputSchema } from './rollouts';

const valid = {
  key: 'insight-signup-v1',
  name: 'Insights one-click signup',
  expectedRevision: null,
};

test('accepts both rollout endpoints and rejects invalid allocations', () => {
  expect(rolloutInputSchema.safeParse({ ...valid, treatmentPercent: 0 }).success).toBe(true);
  expect(rolloutInputSchema.safeParse({ ...valid, treatmentPercent: 100 }).success).toBe(true);
  for (const treatmentPercent of [-1, 101, 50.5, '50']) {
    expect(rolloutInputSchema.safeParse({ ...valid, treatmentPercent }).success).toBe(false);
  }
  expect(
    rolloutInputSchema.safeParse({ ...valid, key: '__proto__', treatmentPercent: 50 }).success,
  ).toBe(false);
});
