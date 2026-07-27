import { describe, expect, test } from 'vitest';
import { agentPeriodSchema, resolveAgentPeriod } from './period';

describe('resolveAgentPeriod', () => {
  test('resolves the previous complete Lisbon day across the DST boundary', () => {
    const input = agentPeriodSchema.parse({
      preset: 'day',
      timezone: 'Europe/Lisbon',
    });
    const period = resolveAgentPeriod(input, new Date('2026-03-30T12:00:00.000Z'));

    expect(period.startDate.toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(period.endDate.toISOString()).toBe('2026-03-29T22:59:59.999Z');
    expect(period.complete).toBe(true);
  });

  test('uses Monday through Sunday for complete weekly periods', () => {
    const input = agentPeriodSchema.parse({
      preset: 'week',
      timezone: 'Europe/Lisbon',
    });
    const period = resolveAgentPeriod(input, new Date('2026-07-27T12:00:00.000Z'));

    expect(period.startDate.toISOString()).toBe('2026-07-19T23:00:00.000Z');
    expect(period.endDate.toISOString()).toBe('2026-07-26T22:59:59.999Z');
  });

  test('resolves the previous complete calendar month', () => {
    const input = agentPeriodSchema.parse({
      preset: 'month',
      timezone: 'UTC',
    });
    const period = resolveAgentPeriod(input, new Date('2024-03-10T12:00:00.000Z'));

    expect(period.startDate.toISOString()).toBe('2024-02-01T00:00:00.000Z');
    expect(period.endDate.toISOString()).toBe('2024-02-29T23:59:59.999Z');
  });

  test('rejects ambiguous, inverted, and oversized custom ranges', () => {
    expect(
      agentPeriodSchema.safeParse({
        preset: 'day',
        timezone: 'UTC',
        startAt: '2026-01-01T00:00:00.000Z',
        endAt: '2026-01-02T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      agentPeriodSchema.safeParse({
        timezone: 'UTC',
        startAt: '2026-01-02T00:00:00.000Z',
        endAt: '2026-01-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      agentPeriodSchema.safeParse({
        timezone: 'UTC',
        startAt: '2024-01-01T00:00:00.000Z',
        endAt: '2026-01-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
