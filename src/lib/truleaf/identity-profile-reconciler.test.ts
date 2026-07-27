import { beforeEach, expect, test, vi } from 'vitest';
import { requestTruleafIdentityProfiles } from '@/lib/truleaf/service';
import {
  deferTruleafIdentityProfileRetry,
  getPendingTruleafSessionIdentities,
  recordVerifiedSessionIdentity,
} from '@/queries/prisma';
import { reconcileVerifiedIdentityProfiles } from './identity-profile-reconciler';

vi.mock('@/lib/truleaf/config', () => ({
  isTruleafIdentityProfileEnabled: () => true,
  isTruleafWebsite: () => true,
}));
vi.mock('@/lib/truleaf/identity-proof', () => ({
  decryptIdentityProof: () => 'header.payload.signature',
  getIdentityProofSubject: () => '507f1f77bcf86cd799439011',
}));
vi.mock('@/lib/truleaf/service', () => ({ requestTruleafIdentityProfiles: vi.fn() }));
vi.mock('@/queries/prisma', () => ({
  deferTruleafIdentityProfileRetry: vi.fn(),
  getPendingTruleafSessionIdentities: vi.fn(),
  recordVerifiedSessionIdentity: vi.fn(),
}));

const stored = {
  websiteId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  proofCiphertext: Uint8Array.from([1]),
  nonce: Uint8Array.from([2]),
  encryptionKeyVersion: 'v1',
  expiresAt: new Date('2026-08-27T12:00:00.000Z'),
  profileAttemptCount: 0,
};
const profile = {
  websiteId: stored.websiteId,
  sessionId: stored.sessionId,
  distinctId: '507f1f77bcf86cd799439011',
  displayName: 'Matheus Paranhos',
  username: 'matheus',
  role: 'user' as const,
  plan: 'premium' as const,
  profileVersion: '2026-07-27T12:00:00.000Z',
  verifiedUntil: '2026-08-27T12:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPendingTruleafSessionIdentities).mockResolvedValue([stored] as never);
  vi.mocked(recordVerifiedSessionIdentity).mockResolvedValue({} as never);
  vi.mocked(deferTruleafIdentityProfileRetry).mockResolvedValue({ count: 1 } as never);
});

test('backfills a stored valid proof through the authoritative resolver', async () => {
  vi.mocked(requestTruleafIdentityProfiles).mockResolvedValue({ profiles: [profile] });

  await expect(reconcileVerifiedIdentityProfiles()).resolves.toEqual({
    attempted: 1,
    resolved: 1,
  });
  expect(requestTruleafIdentityProfiles).toHaveBeenCalledWith([
    expect.objectContaining({
      websiteId: stored.websiteId,
      sessionId: stored.sessionId,
      distinctId: profile.distinctId,
    }),
  ]);
  expect(recordVerifiedSessionIdentity).toHaveBeenCalledWith(profile);
});

test('keeps a transient resolver failure retryable', async () => {
  vi.mocked(requestTruleafIdentityProfiles).mockRejectedValue(new Error('temporarily unavailable'));

  await expect(reconcileVerifiedIdentityProfiles()).resolves.toEqual({
    attempted: 1,
    resolved: 0,
  });
  expect(recordVerifiedSessionIdentity).not.toHaveBeenCalled();
  expect(deferTruleafIdentityProfileRetry).toHaveBeenCalledWith(stored);
});

test('rejects and defers an unrequested resolver tuple', async () => {
  vi.mocked(requestTruleafIdentityProfiles).mockResolvedValue({
    profiles: [{ ...profile, sessionId: '33333333-3333-4333-8333-333333333333' }],
  });

  await expect(reconcileVerifiedIdentityProfiles()).resolves.toEqual({
    attempted: 1,
    resolved: 0,
  });
  expect(recordVerifiedSessionIdentity).not.toHaveBeenCalled();
  expect(deferTruleafIdentityProfileRetry).toHaveBeenCalledWith(stored);
});
