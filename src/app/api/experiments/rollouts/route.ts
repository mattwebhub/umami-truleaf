import { z } from 'zod';
import { toPublicRollouts, withDefaultRollout } from '@/lib/experiments/rollouts';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** Public allocation feed. One deployment exports one explicitly configured website. */
export async function GET() {
  const configuredId = z.uuid().safeParse(process.env.EXPERIMENT_ROLLOUT_WEBSITE_ID);
  if (!configuredId.success) {
    return Response.json(
      { error: 'Rollout feed is not configured' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }

  const rows = await prisma.client.experimentRollout.findMany({
    where: { websiteId: configuredId.data },
    select: { key: true, treatmentPercent: true, revision: true },
    orderBy: { key: 'asc' },
  });

  return Response.json(toPublicRollouts(withDefaultRollout(rows)), {
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60' },
  });
}
