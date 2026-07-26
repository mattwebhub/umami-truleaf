import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';
import { decryptIdentityProof, encryptIdentityProof } from '@/lib/truleaf/identity-proof';

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
    },
    update: {
      proofCiphertext: Uint8Array.from(encrypted.ciphertext),
      nonce: Uint8Array.from(encrypted.nonce),
      encryptionKeyVersion: encrypted.keyVersion,
      expiresAt: encrypted.expiresAt,
      updatedAt: observedAt,
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
