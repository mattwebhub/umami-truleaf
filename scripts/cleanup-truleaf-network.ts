import prisma from '@/lib/prisma';
import {
  deleteExpiredTruleafSessionIdentities,
  deleteExpiredTruleafSessionNetworks,
} from '@/queries/prisma';

async function main() {
  const [networks, identities] = await Promise.all([
    deleteExpiredTruleafSessionNetworks(),
    deleteExpiredTruleafSessionIdentities(),
  ]);
  console.log(
    `Deleted ${networks.count} expired Truleaf network mapping(s) and ${identities.count} identity proof(s).`,
  );
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.client.$disconnect());
