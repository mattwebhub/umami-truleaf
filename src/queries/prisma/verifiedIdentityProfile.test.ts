import { beforeEach, expect, test, vi } from 'vitest';
import {
  getVerifiedIdentityDistinctIdsBySearch,
  getVerifiedSessionIdentityProfiles,
  recordVerifiedSessionIdentity,
} from './verifiedIdentityProfile';

const mocks = vi.hoisted(() => {
  const profileFindUnique = vi.fn();
  const profileFindMany = vi.fn();
  const profileUpsert = vi.fn();
  const linkFindMany = vi.fn();
  const linkUpsert = vi.fn();
  const client = {
    verifiedIdentityProfile: {
      findUnique: profileFindUnique,
      findMany: profileFindMany,
      upsert: profileUpsert,
    },
    verifiedSessionIdentity: {
      findMany: linkFindMany,
      upsert: linkUpsert,
    },
  };
  const transaction = vi.fn(callback => callback(client));

  return {
    profileFindUnique,
    profileFindMany,
    profileUpsert,
    linkFindMany,
    linkUpsert,
    client,
    transaction,
  };
});

vi.mock('@/lib/prisma', () => ({
  default: {
    client: mocks.client,
    transaction: mocks.transaction,
  },
}));

const profile = {
  websiteId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  distinctId: '507f1f77bcf86cd799439011',
  displayName: 'Matheus Paranhos',
  username: 'matheus',
  avatarUrl: 'https://images.example.test/avatar.png',
  role: 'user' as const,
  plan: 'premium' as const,
  profileVersion: '2026-07-27T12:00:00.000Z',
  verifiedUntil: '2026-08-27T12:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profileFindUnique.mockResolvedValue(null);
  mocks.profileUpsert.mockResolvedValue({});
  mocks.linkUpsert.mockResolvedValue({});
  mocks.transaction.mockImplementation(callback => callback(mocks.client));
});

test('upserts a current verified profile and its session binding atomically', async () => {
  await recordVerifiedSessionIdentity(profile);

  expect(mocks.profileUpsert).toHaveBeenCalledWith(
    expect.objectContaining({
      create: expect.objectContaining({
        displayName: 'Matheus Paranhos',
        avatarUrl: profile.avatarUrl,
        verifiedUntil: new Date(profile.verifiedUntil),
      }),
    }),
  );
  expect(mocks.linkUpsert).toHaveBeenCalledWith(
    expect.objectContaining({
      create: expect.objectContaining({
        sessionId: profile.sessionId,
        distinctId: profile.distinctId,
      }),
    }),
  );
  expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
    isolationLevel: 'Serializable',
  });
});

test('does not overwrite a newer account profile with a stale resolver response', async () => {
  mocks.profileFindUnique.mockResolvedValue({
    profileVersion: '2026-07-28T12:00:00.000Z',
    verifiedUntil: new Date('2026-08-28T12:00:00.000Z'),
  });

  await recordVerifiedSessionIdentity(profile);

  expect(mocks.profileUpsert).not.toHaveBeenCalled();
  expect(mocks.linkUpsert).toHaveBeenCalledOnce();
});

test('does not shorten verification freshness for a delayed proof of the same profile version', async () => {
  mocks.profileFindUnique.mockResolvedValue({
    profileVersion: profile.profileVersion,
    verifiedUntil: new Date('2026-09-27T12:00:00.000Z'),
  });

  await recordVerifiedSessionIdentity(profile);

  expect(mocks.profileUpsert).toHaveBeenCalledWith(
    expect.objectContaining({
      update: expect.objectContaining({
        verifiedUntil: new Date('2026-09-27T12:00:00.000Z'),
      }),
    }),
  );
});

test('retries a serializable write conflict before storing the profile', async () => {
  mocks.transaction
    .mockRejectedValueOnce(Object.assign(new Error('serialization conflict'), { code: 'P2034' }))
    .mockImplementationOnce(callback => callback(mocks.client));

  await recordVerifiedSessionIdentity(profile);

  expect(mocks.transaction).toHaveBeenCalledTimes(2);
  expect(mocks.profileUpsert).toHaveBeenCalledOnce();
});

test('enriches a bounded session page only through verified links', async () => {
  mocks.linkFindMany.mockResolvedValue([
    { sessionId: profile.sessionId, distinctId: profile.distinctId },
  ]);
  mocks.profileFindMany.mockResolvedValue([
    {
      distinctId: profile.distinctId,
      displayName: profile.displayName,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      role: profile.role,
      plan: profile.plan,
    },
  ]);

  const result = await getVerifiedSessionIdentityProfiles(profile.websiteId, [profile.sessionId]);

  expect(mocks.profileFindMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        verifiedUntil: { gt: expect.any(Date) },
      }),
    }),
  );
  expect(result.get(profile.sessionId)).toEqual({
    displayName: profile.displayName,
    username: profile.username,
    role: profile.role,
    plan: profile.plan,
    hasAvatar: true,
  });
});

test('finds only current verified identities by display name or username', async () => {
  mocks.profileFindMany.mockResolvedValue([
    { distinctId: profile.distinctId },
    { distinctId: 'another-account' },
  ]);

  const result = await getVerifiedIdentityDistinctIdsBySearch(profile.websiteId, 'matheus');

  expect(mocks.profileFindMany).toHaveBeenCalledWith({
    where: {
      websiteId: profile.websiteId,
      verifiedUntil: { gt: expect.any(Date) },
      OR: [
        { displayName: { contains: 'matheus', mode: 'insensitive' } },
        { username: { contains: 'matheus', mode: 'insensitive' } },
      ],
    },
    select: { distinctId: true },
    take: 500,
  });
  expect(result).toEqual([profile.distinctId, 'another-account']);
});
