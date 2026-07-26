import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';
import {
  decryptAccountBanReference,
  encryptAccountBanReference,
} from '@/lib/truleaf/account-ban-reference';

export async function recordTruleafSessionAccountBanReference(
  websiteId: string,
  sessionId: string,
  distinctId: string,
  banId: string,
  expiresAt?: Date | null,
  observedAt = new Date(),
) {
  const encrypted = encryptAccountBanReference(banId, websiteId, sessionId, distinctId);

  return prisma.client.truleafSessionAccountBanReference.upsert({
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
      referenceCiphertext: Uint8Array.from(encrypted.ciphertext),
      nonce: Uint8Array.from(encrypted.nonce),
      encryptionKeyVersion: encrypted.keyVersion,
      expiresAt,
      updatedAt: observedAt,
    },
    update: {
      referenceCiphertext: Uint8Array.from(encrypted.ciphertext),
      nonce: Uint8Array.from(encrypted.nonce),
      encryptionKeyVersion: encrypted.keyVersion,
      expiresAt,
      updatedAt: observedAt,
    },
  });
}

export async function getTruleafSessionAccountBanReference(
  websiteId: string,
  sessionId: string,
  distinctId: string,
  now = new Date(),
) {
  const record = await prisma.client.truleafSessionAccountBanReference.findFirst({
    where: {
      websiteId,
      sessionId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });

  if (!record) {
    return undefined;
  }

  try {
    return decryptAccountBanReference(
      record.referenceCiphertext,
      record.nonce,
      record.encryptionKeyVersion,
      websiteId,
      sessionId,
      distinctId,
    );
  } catch {
    return undefined;
  }
}

export function deleteTruleafSessionAccountBanReference(websiteId: string, sessionId: string) {
  return prisma.client.truleafSessionAccountBanReference.deleteMany({
    where: { websiteId, sessionId },
  });
}

export function deleteExpiredTruleafSessionAccountBanReferences(now = new Date()) {
  return prisma.client.truleafSessionAccountBanReference.deleteMany({
    where: { expiresAt: { lte: now } },
  });
}
