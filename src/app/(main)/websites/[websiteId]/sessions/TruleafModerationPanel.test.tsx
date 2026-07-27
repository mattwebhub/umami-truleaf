import { describe, expect, test } from 'vitest';
import {
  canModerateAccount,
  canModerateNetwork,
  getModerationResultMessage,
  getNetworkModerationStateMessage,
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

  test('allows an unbanned network only for ban', () => {
    const network = {
      banned: false,
      canBan: true,
      canUnban: false,
      sourceMatches: false,
    };

    expect(canModerateNetwork(network, 'ban')).toBe(true);
    expect(canModerateNetwork(network, 'unban')).toBe(false);
    expect(getNetworkModerationStateMessage(network)).toBe('not banned');
  });

  test('allows unban only when the active network ban belongs to this session', () => {
    const network = {
      banned: true,
      canBan: false,
      canUnban: true,
      sourceMatches: true,
    };

    expect(canModerateNetwork(network, 'ban')).toBe(false);
    expect(canModerateNetwork(network, 'unban')).toBe(true);
    expect(getNetworkModerationStateMessage(network)).toContain('banned by this session');
  });

  test('disables both re-ban and cross-session unban for a shared IP', () => {
    const network = {
      banned: true,
      canBan: false,
      canUnban: false,
      sourceMatches: false,
    };

    expect(canModerateNetwork(network, 'ban')).toBe(false);
    expect(canModerateNetwork(network, 'unban')).toBe(false);
    expect(getNetworkModerationStateMessage(network)).toBe(
      'already banned from another session; cannot unban here',
    );
  });
});
