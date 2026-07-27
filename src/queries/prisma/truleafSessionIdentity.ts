import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';
import { decryptIdentityProof, encryptIdentityProof } from '@/lib/truleaf/identity-proof';

export interface PendingTruleafSessionIdentity {
  id: string;
  websiteId: string;
  sessionId: string;
  proofCiphertext: Uint8Array;
  nonce: Uint8Array;
  encryptionKeyVersion: string;
  expiresAt: Date;
  updatedAt: Date;
  profileRetryAt: Date | null;
  profileAttemptCount: number;
  profileLastAttemptAt: Date | null;
}

export async function recordTruleafSessionIdentityProof(
  websiteId: string,
  sessionId: string,
  distinctId: string,
  proof: string,
  observedAt = new Date(),
) {
  const encrypted = encryptIdentityProof(proof, websiteId, sessionId, distinctId, observedAt);

  if (!encrypted) {
    return null;
  }

  return prisma.client.truleafSessionIdentity.upsert({
    where: {
      websiteId_sessionId: {
        websiteId,
        sessionId,
      },
    },
    create: {
      id: uuid(),
      websiteId,
      sessionId,
      proofCiphertext: Uint8Array.from(encrypted.ciphertext),
      nonce: Uint8Array.from(encrypted.nonce),
      encryptionKeyVersion: encrypted.keyVersion,
      expiresAt: encrypted.expiresAt,
      updatedAt: observedAt,
      profileRetryAt: observedAt,
      profileAttemptCount: 0,
    },
    update: {
      proofCiphertext: Uint8Array.from(encrypted.ciphertext),
      nonce: Uint8Array.from(encrypted.nonce),
      encryptionKeyVersion: encrypted.keyVersion,
      expiresAt: encrypted.expiresAt,
      updatedAt: observedAt,
      profileRetryAt: observedAt,
      profileAttemptCount: 0,
      profileLastAttemptAt: null,
    },
  });
}

export async function getTruleafSessionIdentityProof(
  websiteId: string,
  sessionId: string,
  now = new Date(),
) {
  const record = await prisma.client.truleafSessionIdentity.findUnique({
    where: {
      websiteId_sessionId: {
        websiteId,
        sessionId,
      },
      expiresAt: { gt: now },
    },
  });

  if (!record) {
    return undefined;
  }

  try {
    return decryptIdentityProof(
      record.proofCiphertext,
      record.nonce,
      record.encryptionKeyVersion,
      websiteId,
      sessionId,
    );
  } catch {
    // Corrupt or undecryptable proof data must not block anonymous IP moderation.
    return undefined;
  }
}

export function deleteExpiredTruleafSessionIdentities(now = new Date()) {
  return prisma.client.truleafSessionIdentity.deleteMany({
    where: { expiresAt: { lte: now } },
  });
}

export async function getPendingTruleafSessionIdentities(now = new Date(), limit = 100) {
  return prisma.client.$queryRawUnsafe<PendingTruleafSessionIdentity[]>(
    `
      select
        identity.identity_id as "id",
        identity.website_id as "websiteId",
        identity.session_id as "sessionId",
        identity.proof_ciphertext as "proofCiphertext",
        identity.nonce,
        identity.encryption_key_version as "encryptionKeyVersion",
        identity.expires_at as "expiresAt",
        identity.updated_at as "updatedAt",
        identity.profile_retry_at as "profileRetryAt",
        identity.profile_attempt_count as "profileAttemptCount",
        identity.profile_last_attempt_at as "profileLastAttemptAt"
      from truleaf_session_identity identity
      left join verified_session_identity link
        on link.website_id = identity.website_id
        and link.session_id = identity.session_id
      left join verified_identity_profile profile
        on profile.website_id = link.website_id
        and profile.distinct_id = link.distinct_id
        and profile.verified_until > $1
      where identity.expires_at > $1
        and (identity.profile_retry_at is null or identity.profile_retry_at <= $1)
        and profile.identity_profile_id is null
      order by identity.updated_at asc
      limit $2
    `,
    now,
    Math.min(Math.max(limit, 1), 100),
  );
}

export function deferTruleafIdentityProfileRetry(
  identity: {
    websiteId: string;
    sessionId: string;
    expiresAt: Date;
    profileAttemptCount: number;
  },
  now = new Date(),
) {
  const attempt = identity.profileAttemptCount + 1;
  const retryAt =
    attempt >= 8
      ? identity.expiresAt
      : new Date(now.getTime() + Math.min(5 * 60_000 * 2 ** (attempt - 1), 24 * 60 * 60_000));

  return prisma.client.truleafSessionIdentity.updateMany({
    where: {
      websiteId: identity.websiteId,
      sessionId: identity.sessionId,
      expiresAt: { gt: now },
      profileAttemptCount: identity.profileAttemptCount,
    },
    data: {
      profileAttemptCount: { increment: 1 },
      profileLastAttemptAt: now,
      profileRetryAt: retryAt,
    },
  });
}
