import prisma from '@/lib/prisma';
import { backfillLegacyServerSessions } from '@/lib/server-events-backfill';

const args = process.argv.slice(2);
const unknownArgs = args.filter(arg => arg !== '--apply');

async function main() {
  if (unknownArgs.length) {
    throw new Error(`Unknown argument(s): ${unknownArgs.join(', ')}`);
  }

  const apply = args.includes('--apply');
  const result = await backfillLegacyServerSessions({ apply });

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        ...result,
      },
      null,
      2,
    ),
  );

  if (!apply && result.eventsFound) {
    console.log('Dry run only. Re-run with --apply after reviewing these counts.');
  }
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.client.$disconnect());
