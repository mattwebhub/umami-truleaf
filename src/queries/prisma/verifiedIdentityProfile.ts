import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';
import type { VerifiedIdentityProfileResponse } from '@/lib/truleaf/service';

export interface SessionIdentityProfile {
  displayName: string;
  username: string;
  role: string;
  plan: string;
  hasAvatar: boolean;
}

export async function getVerifiedIdentityDistinctIdsBySearch(
  websiteId: string,
  search: string,
  limit = 500,
) {
  const profiles = await prisma.client.verifiedIdentityProfile.findMany({
    where: {
      websiteId,
      verifiedUntil: { gt: new Date() },
      OR: [
        { displayName: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
      ],
    },
    select: { distinctId: true },
    take: limit,
  });

  return profiles.map(({ distinctId }) => distinctId);
}

export async function recordVerifiedSessionIdentity(
  profile: VerifiedIdentityProfileResponse,
  verifiedAt = new Date(),
) {
  const verifiedUntil = new Date(profile.verifiedUntil);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.transaction(
        async client => {
          const current = await client.verifiedIdentityProfile.findUnique({
            where: {
              websiteId_distinctId: {
                websiteId: profile.websiteId,
                distinctId: profile.distinctId,
              },
            },
            select: { profileVersion: true, verifiedUntil: true },
          });

          if (!current || profile.profileVersion >= current.profileVersion) {
            const effectiveVerifiedUntil =
              current?.profileVersion === profile.profileVersion &&
              current.verifiedUntil > verifiedUntil
                ? current.verifiedUntil
                : verifiedUntil;

            await client.verifiedIdentityProfile.upsert({
              where: {
                websiteId_distinctId: {
                  websiteId: profile.websiteId,
                  distinctId: profile.distinctId,
                },
              },
              create: {
                id: uuid(),
                websiteId: profile.websiteId,
                distinctId: profile.distinctId,
                displayName: profile.displayName,
                username: profile.username,
                avatarUrl: profile.avatarUrl,
                role: profile.role,
                plan: profile.plan,
                profileVersion: profile.profileVersion,
                verifiedUntil: effectiveVerifiedUntil,
                createdAt: verifiedAt,
                updatedAt: verifiedAt,
              },
              update: {
                displayName: profile.displayName,
                username: profile.username,
                avatarUrl: profile.avatarUrl,
                role: profile.role,
                plan: profile.plan,
                profileVersion: profile.profileVersion,
                verifiedUntil: effectiveVerifiedUntil,
                updatedAt: verifiedAt,
              },
            });
          }

          return client.verifiedSessionIdentity.upsert({
            where: {
              websiteId_sessionId: {
                websiteId: profile.websiteId,
                sessionId: profile.sessionId,
              },
            },
            create: {
              id: uuid(),
              websiteId: profile.websiteId,
              sessionId: profile.sessionId,
              distinctId: profile.distinctId,
              verifiedAt,
            },
            update: {
              distinctId: profile.distinctId,
              verifiedAt,
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (attempt === 2 || (code !== 'P2034' && code !== '40001')) {
        throw error;
      }
    }
  }

  throw new Error('Unable to store verified identity profile');
}

export async function getVerifiedSessionIdentityProfiles(websiteId: string, sessionIds: string[]) {
  if (!sessionIds.length) {
    return new Map<string, SessionIdentityProfile>();
  }

  const links = await prisma.client.verifiedSessionIdentity.findMany({
    where: {
      websiteId,
      sessionId: { in: [...new Set(sessionIds)].slice(0, 500) },
    },
    select: { sessionId: true, distinctId: true },
  });

  if (!links.length) {
    return new Map<string, SessionIdentityProfile>();
  }

  const profiles = await prisma.client.verifiedIdentityProfile.findMany({
    where: {
      websiteId,
      distinctId: { in: [...new Set(links.map(({ distinctId }) => distinctId))] },
      verifiedUntil: { gt: new Date() },
    },
  });
  const profilesByDistinctId = new Map(profiles.map(profile => [profile.distinctId, profile]));

  return new Map(
    links.flatMap(({ sessionId, distinctId }) => {
      const profile = profilesByDistinctId.get(distinctId);

      return profile
        ? [
            [
              sessionId,
              {
                displayName: profile.displayName,
                username: profile.username,
                role: profile.role,
                plan: profile.plan,
                hasAvatar: Boolean(profile.avatarUrl),
              },
            ] as const,
          ]
        : [];
    }),
  );
}

export async function getVerifiedSessionIdentityAvatar(websiteId: string, sessionId: string) {
  const link = await prisma.client.verifiedSessionIdentity.findFirst({
    where: {
      websiteId,
      sessionId,
      profile: { verifiedUntil: { gt: new Date() } },
    },
    select: { profile: { select: { avatarUrl: true } } },
  });

  return link?.profile;
}

export function deleteExpiredVerifiedIdentityProfiles(now = new Date()) {
  return prisma.client.verifiedIdentityProfile.deleteMany({
    where: { verifiedUntil: { lte: now } },
  });
}
