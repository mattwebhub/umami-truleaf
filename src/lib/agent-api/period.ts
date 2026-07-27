import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMilliseconds,
  subMonths,
  subWeeks,
} from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { z } from 'zod';
import { isValidTimezone, normalizeTimezone } from '@/lib/date';

const MAX_EXPLICIT_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

export const agentPeriodSchema = z
  .object({
    preset: z.enum(['day', 'week', 'month']).optional(),
    timezone: z
      .string()
      .default('UTC')
      .refine(isValidTimezone, 'Invalid timezone')
      .transform(normalizeTimezone),
    startAt: z.iso.datetime().optional(),
    endAt: z.iso.datetime().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasExplicitRange = Boolean(value.startAt && value.endAt);
    if (Boolean(value.preset) === hasExplicitRange) {
      context.addIssue({
        code: 'custom',
        message: 'Provide either preset or startAt+endAt',
      });
      return;
    }

    if (hasExplicitRange) {
      const startAt = new Date(value.startAt).getTime();
      const endAt = new Date(value.endAt).getTime();
      if (startAt >= endAt) {
        context.addIssue({ code: 'custom', message: 'startAt must be before endAt' });
      } else if (endAt - startAt > MAX_EXPLICIT_RANGE_MS) {
        context.addIssue({ code: 'custom', message: 'Date range cannot exceed 366 days' });
      }
    }
  });

export type AgentPeriodInput = z.infer<typeof agentPeriodSchema>;

export function resolveAgentPeriod(input: AgentPeriodInput, now = new Date()) {
  const timezone = input.timezone;
  let startDate: Date;
  let endDate: Date;
  let complete: boolean;

  if (input.preset) {
    const zonedNow = toZonedTime(now, timezone);
    if (input.preset === 'day') {
      const previousDay = subDays(zonedNow, 1);
      startDate = fromZonedTime(startOfDay(previousDay), timezone);
      endDate = fromZonedTime(endOfDay(previousDay), timezone);
    } else if (input.preset === 'week') {
      const previousWeek = subWeeks(zonedNow, 1);
      startDate = fromZonedTime(startOfWeek(previousWeek, { weekStartsOn: 1 }), timezone);
      endDate = fromZonedTime(endOfWeek(previousWeek, { weekStartsOn: 1 }), timezone);
    } else {
      const previousMonth = subMonths(zonedNow, 1);
      startDate = fromZonedTime(startOfMonth(previousMonth), timezone);
      endDate = fromZonedTime(endOfMonth(previousMonth), timezone);
    }
    complete = true;
  } else {
    startDate = new Date(input.startAt);
    endDate = new Date(input.endAt);
    complete = endDate <= now;
  }

  const duration = endDate.getTime() - startDate.getTime() + 1;
  const comparisonEndDate = subMilliseconds(startDate, 1);
  const comparisonStartDate = new Date(comparisonEndDate.getTime() - duration + 1);

  return {
    preset: input.preset ?? 'custom',
    timezone,
    complete,
    startDate,
    endDate,
    comparisonStartDate,
    comparisonEndDate,
  };
}
