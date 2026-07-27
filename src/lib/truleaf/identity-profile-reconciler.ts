import { isTruleafIdentityProfileEnabled, isTruleafWebsite } from '@/lib/truleaf/config';
import { decryptIdentityProof, getIdentityProofSubject } from '@/lib/truleaf/identity-proof';
import { requestTruleafIdentityProfiles } from '@/lib/truleaf/service';
import {
  deferTruleafIdentityProfileRetry,
  getPendingTruleafSessionIdentities,
  recordVerifiedSessionIdentity,
} from '@/queries/prisma';

function identityKey(websiteId: string, sessionId: string, distinctId: string) {
  return `${websiteId}:${sessionId}:${distinctId}`;
}

export async function reconcileVerifiedIdentityProfiles() {
  if (!isTruleafIdentityProfileEnabled()) {
    return { attempted: 0, resolved: 0 };
  }

  const stored = (await getPendingTruleafSessionIdentities()).filter(({ websiteId }) =>
    isTruleafWebsite(websiteId),
  );
  const requested = new Map<
    string,
    {
      record: (typeof stored)[number];
      identity: {
        websiteId: string;
        sessionId: string;
        distinctId: string;
        proof: string;
      };
    }
  >();

  for (const record of stored) {
    try {
      const proof = decryptIdentityProof(
        record.proofCiphertext,
        record.nonce,
        record.encryptionKeyVersion,
        record.websiteId,
        record.sessionId,
      );
      const distinctId = getIdentityProofSubject(proof);

      if (distinctId) {
        const identity = {
          websiteId: record.websiteId,
          sessionId: record.sessionId,
          distinctId,
          proof,
        };
        requested.set(identityKey(record.websiteId, record.sessionId, distinctId), {
          record,
          identity,
        });
      }
    } catch {
      // Undecryptable records are deferred below without logging proof material.
    }
  }
  const identities = [...requested.values()].map(({ identity }) => identity);

  if (!identities.length) {
    await Promise.all(stored.map(record => deferTruleafIdentityProfileRetry(record)));
    return { attempted: stored.length, resolved: 0 };
  }

  try {
    const { profiles } = await requestTruleafIdentityProfiles(identities);
    const seen = new Set<string>();
    const correlated = profiles.filter(profile => {
      const key = identityKey(profile.websiteId, profile.sessionId, profile.distinctId);
      if (!requested.has(key) || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    for (const profile of correlated) {
      await recordVerifiedSessionIdentity(profile);
    }

    const resolvedSessions = new Set(
      correlated.map(({ websiteId, sessionId }) => `${websiteId}:${sessionId}`),
    );
    await Promise.all(
      stored
        .filter(({ websiteId, sessionId }) => !resolvedSessions.has(`${websiteId}:${sessionId}`))
        .map(record => deferTruleafIdentityProfileRetry(record)),
    );

    return { attempted: stored.length, resolved: correlated.length };
  } catch {
    await Promise.all(stored.map(record => deferTruleafIdentityProfileRetry(record)));
    return { attempted: identities.length, resolved: 0 };
  }
}
