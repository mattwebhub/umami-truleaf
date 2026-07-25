import { describe, expect, test } from 'vitest';
import { canModerateAccount, getModerationResultMessage } from './TruleafModerationPanel';

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
});
