import { addDays } from 'date-fns';
import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';
import { getTruleafNetworkRetentionDays } from '@/lib/truleaf/config';
import { TRULEAF_SESSION_NETWORK_DISPLAY_LIMIT } from '@/lib/truleaf/constants';
import {
  decryptNetworkAddress,
  encryptNetworkAddress,
  maskNetworkAddress,
} from '@/lib/truleaf/network-crypto';

export async function recordTruleafSessionNetwork(
  websiteId: string,
  sessionId: string,
  address: string,
  observedAt = new Date(),
) {
  const encrypted = encryptNetworkAddress(address, websiteId, sessionId);
  const expiresAt = addDays(observedAt, getTruleafNetworkRetentionDays());

  return prisma.client.truleafSessionNetwork.upsert({
    where: {
      websiteId_sessionId_ipHmac: {
        websiteId,
        sessionId,
        ipHmac: encrypted.hmac,
      },
    },
    create: {
      id: uuid(),
      websiteId,
      sessionId,
      ipHmac: encrypted.hmac,
      ipCiphertext: Uint8Array.from(encrypted.ciphertext),
      nonce: Uint8Array.from(encrypted.nonce),
      encryptionKeyVersion: encrypted.keyVersion,
      addressFamily: encrypted.family,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      expiresAt,
    },
    update: {
      lastSeenAt: observedAt,
      expiresAt,
    },
  });
}

export async function getTruleafSessionNetworks(websiteId: string, sessionId: string) {
  const records = await prisma.client.truleafSessionNetwork.findMany({
    where: {
      websiteId,
      sessionId,
      expiresAt: { gt: new Date() },
    },
    orderBy: { lastSeenAt: 'desc' },
    take: TRULEAF_SESSION_NETWORK_DISPLAY_LIMIT,
  });

  return records.map(record => {
    const address = decryptNetworkAddress(
      record.ipCiphertext,
      record.nonce,
      record.encryptionKeyVersion,
      websiteId,
      sessionId,
    );

    return {
      id: record.id,
      address,
      maskedAddress: maskNetworkAddress(address),
      addressFamily: record.addressFamily,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      expiresAt: record.expiresAt,
    };
  });
}

export function deleteExpiredTruleafSessionNetworks(now = new Date()) {
  return prisma.client.truleafSessionNetwork.deleteMany({
    where: { expiresAt: { lte: now } },
  });
}
