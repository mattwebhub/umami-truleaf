import crypto from 'node:crypto';
import { DEFAULT_ROLLOUT, rolloutInputSchema } from '@/lib/experiments/rollouts';
import prisma from '@/lib/prisma';
import { parseRequest } from '@/lib/request';
import { forbidden, json } from '@/lib/response';
import { canUpdateWebsite } from '@/permissions';

const selectFields = {
  key: true,
  name: true,
  treatmentPercent: true,
  revision: true,
  updatedAt: true,
} as const;

function conflict() {
  return Response.json(
    {
      error: {
        code: 'rollout-conflict',
        message: 'This rollout changed. Refresh and try again.',
        status: 409,
      },
    },
    { status: 409 },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, error } = await parseRequest(request);
  if (error) return error();
  const { websiteId } = await params;
  if (!(await canUpdateWebsite(auth, websiteId))) return forbidden();

  const rollouts = await prisma.client.experimentRollout.findMany({
    where: { websiteId },
    select: selectFields,
    orderBy: { key: 'asc' },
  });
  const needsBootstrap =
    websiteId === process.env.EXPERIMENT_ROLLOUT_WEBSITE_ID &&
    !rollouts.some(rollout => rollout.key === DEFAULT_ROLLOUT.key);
  return json({
    rollouts: needsBootstrap
      ? [{ ...DEFAULT_ROLLOUT, revision: null, updatedAt: null }, ...rollouts]
      : rollouts,
    needsBootstrap,
  });
}

/** First board visit writes the 50% starter row without changing existing edits. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, error } = await parseRequest(request);
  if (error) return error();
  const { websiteId } = await params;
  if (!(await canUpdateWebsite(auth, websiteId))) return forbidden();
  if (websiteId !== process.env.EXPERIMENT_ROLLOUT_WEBSITE_ID) return forbidden();

  await prisma.client.experimentRollout.createMany({
    data: [
      {
        id: crypto.randomUUID(),
        websiteId,
        key: DEFAULT_ROLLOUT.key,
        name: DEFAULT_ROLLOUT.name,
        treatmentPercent: DEFAULT_ROLLOUT.treatmentPercent,
        revision: crypto.randomUUID(),
        updatedByUserId: auth.user.id,
      },
    ],
    skipDuplicates: true,
  });
  return json({ ok: true });
}

/** Idempotent create/edit with optimistic concurrency to prevent silent overrides. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, body, error } = await parseRequest(request, rolloutInputSchema);
  if (error) return error();
  const { websiteId } = await params;
  if (!(await canUpdateWebsite(auth, websiteId))) return forbidden();

  const { key, name, treatmentPercent, expectedRevision } = body;
  const existing = await prisma.client.experimentRollout.findUnique({
    where: { websiteId_key: { websiteId, key } },
    select: { revision: true },
  });
  if ((existing?.revision ?? null) !== expectedRevision) return conflict();

  const revision = crypto.randomUUID();
  try {
    if (existing) {
      const updated = await prisma.client.experimentRollout.updateMany({
        where: { websiteId, key, revision: expectedRevision },
        data: { name, treatmentPercent, revision, updatedByUserId: auth.user.id },
      });
      if (updated.count !== 1) return conflict();
    } else {
      // Keep the board bounded per website; creation races are protected by the unique key.
      const count = await prisma.client.experimentRollout.count({ where: { websiteId } });
      if (count >= 100) {
        return Response.json(
          {
            error: {
              code: 'rollout-limit',
              message: 'Maximum 100 rollouts per website',
              status: 400,
            },
          },
          { status: 400 },
        );
      }
      await prisma.client.experimentRollout.create({
        data: {
          id: crypto.randomUUID(),
          websiteId,
          key,
          name,
          treatmentPercent,
          revision,
          updatedByUserId: auth.user.id,
        },
      });
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return conflict();
    }
    throw error;
  }

  const rollout = await prisma.client.experimentRollout.findUnique({
    where: { websiteId_key: { websiteId, key } },
    select: selectFields,
  });
  return json({ rollout });
}
