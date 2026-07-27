import { json, unauthorized } from '@/lib/response';
import { reconcileVerifiedIdentityProfiles } from '@/lib/truleaf/identity-profile-reconciler';
import { hasValidTruleafMaintenanceSecret } from '@/lib/truleaf/maintenance-auth';
import {
  deleteExpiredTruleafSessionAccountBanReferences,
  deleteExpiredTruleafSessionIdentities,
  deleteExpiredTruleafSessionNetworks,
  deleteExpiredVerifiedIdentityProfiles,
} from '@/queries/prisma';

export async function POST(request: Request) {
  if (!hasValidTruleafMaintenanceSecret(request)) {
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
