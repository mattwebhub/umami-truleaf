import prisma from '@/lib/prisma';
import { deleteExpiredTruleafSessionNetworks } from '@/queries/prisma';

async function main() {
  const result = await deleteExpiredTruleafSessionNetworks();
  console.log(`Deleted ${result.count} expired Truleaf network mapping(s).`);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.client.$disconnect());
