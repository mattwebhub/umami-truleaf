import prisma from '@/lib/prisma';
import {
  deleteExpiredTruleafSessionAccountBanReferences,
  deleteExpiredTruleafSessionIdentities,
  deleteExpiredTruleafSessionNetworks,
  deleteExpiredVerifiedIdentityProfiles,
} from '@/queries/prisma';

async function main() {
  const [networks, identities, accountBanReferences, identityProfiles] = await Promise.all([
    deleteExpiredTruleafSessionNetworks(),
    deleteExpiredTruleafSessionIdentities(),
    deleteExpiredTruleafSessionAccountBanReferences(),
    deleteExpiredVerifiedIdentityProfiles(),
  ]);
  console.log(
    `Deleted ${networks.count} expired Truleaf network mapping(s), ${identities.count} identity proof(s), ${identityProfiles.count} verified identity profile(s), and ${accountBanReferences.count} expired account ban reference(s).`,
  );
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.client.$disconnect());
