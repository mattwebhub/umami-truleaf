import { describe, expect, test } from 'vitest';
import {
  canModerateAccount,
  getModerationResultMessage,
  isAdditionalTargetDisabled,
} from './TruleafModerationPanel';

describe('Truleaf moderation action UX', () => {
  test.each([
    ['applied', 'Moderation applied'],
    ['partial', 'Moderation partially applied; review target status'],
    ['pending', 'Moderation queued; enforcement is pending'],
    ['failed', 'Moderation failed; no successful enforcement was confirmed'],
  ] as const)('reports %s operations without claiming unconditional success', (status, message) => {
    expect(getModerationResultMessage(status)).toBe(message);
  });

  test('uses separate ban and unban capabilities for expired identity proofs', () => {
    const account = { canBan: false, canUnban: true };

    expect(canModerateAccount(account, 'ban')).toBe(false);
    expect(canModerateAccount(account, 'unban')).toBe(true);
  });

  test('allows account plus nine networks and disables an eleventh total target', () => {
    expect(isAdditionalTargetDisabled(9, false)).toBe(false);
    expect(isAdditionalTargetDisabled(10, false)).toBe(true);
    expect(isAdditionalTargetDisabled(10, true)).toBe(false);
  });
});
