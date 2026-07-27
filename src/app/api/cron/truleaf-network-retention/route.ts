import crypto from 'node:crypto';
import { json, unauthorized } from '@/lib/response';
import { reconcileVerifiedIdentityProfiles } from '@/lib/truleaf/identity-profile-reconciler';
import {
  deleteExpiredTruleafSessionAccountBanReferences,
  deleteExpiredTruleafSessionIdentities,
  deleteExpiredTruleafSessionNetworks,
  deleteExpiredVerifiedIdentityProfiles,
} from '@/queries/prisma';

function hasValidSecret(request: Request) {
  const expected = process.env.TRULEAF_RETENTION_SECRET;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (!expected || expected.length < 32 || !supplied) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);

  return (
    expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

export async function POST(request: Request) {
  if (!hasValidSecret(request)) {
    return unauthorized();
  }

  const reconciliation = await reconcileVerifiedIdentityProfiles();
  const [networks, identities, accountBanReferences, identityProfiles] = await Promise.all([
    deleteExpiredTruleafSessionNetworks(),
    deleteExpiredTruleafSessionIdentities(),
    deleteExpiredTruleafSessionAccountBanReferences(),
    deleteExpiredVerifiedIdentityProfiles(),
  ]);

  return json({
    deleted:
      networks.count + identities.count + accountBanReferences.count + identityProfiles.count,
    deletedNetworks: networks.count,
    deletedIdentityProofs: identities.count,
    deletedAccountBanReferences: accountBanReferences.count,
    deletedIdentityProfiles: identityProfiles.count,
    reconciledIdentityProfiles: reconciliation.resolved,
    attemptedIdentityProfiles: reconciliation.attempted,
  });
}
