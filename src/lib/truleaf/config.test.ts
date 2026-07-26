import { afterEach, describe, expect, test } from 'vitest';
import { isTruleafModerationOperator } from './config';

const originalOperators = process.env.TRULEAF_MODERATION_OPERATOR_IDS;

afterEach(() => {
  if (originalOperators === undefined) {
    delete process.env.TRULEAF_MODERATION_OPERATOR_IDS;
  } else {
    process.env.TRULEAF_MODERATION_OPERATOR_IDS = originalOperators;
  }
});

describe('Truleaf moderation operator allowlist', () => {
  test('fails closed when the allowlist is absent or empty', () => {
    delete process.env.TRULEAF_MODERATION_OPERATOR_IDS;
    expect(isTruleafModerationOperator('operator-1')).toBe(false);

    process.env.TRULEAF_MODERATION_OPERATOR_IDS = '  ';
    expect(isTruleafModerationOperator('operator-1')).toBe(false);
  });

  test('matches only an exact configured Umami user ID', () => {
    process.env.TRULEAF_MODERATION_OPERATOR_IDS = 'operator-1, operator-2';

    expect(isTruleafModerationOperator('operator-1')).toBe(true);
    expect(isTruleafModerationOperator('operator-2')).toBe(true);
    expect(isTruleafModerationOperator('operator')).toBe(false);
    expect(isTruleafModerationOperator('OPERATOR-1')).toBe(false);
  });
});
