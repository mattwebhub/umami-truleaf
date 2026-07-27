import { z } from 'zod';
import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';
import { parseRequest } from '@/lib/request';
import { badRequest, json, unauthorized } from '@/lib/response';
import { canUpdateWebsite } from '@/permissions';

const reviewSchema = z.object({
  sessionId: z.uuid(),
  reason: z.string().trim().min(3).max(500),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
});

const PAGE_SIZE = 50;
const severityRank = { high: 0, medium: 1, low: 2 } as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, error, url } = await parseRequest(request);
  if (error) return error();

  const { websiteId } = await params;
  if (!(await canUpdateWebsite(auth, websiteId))) return unauthorized();

  const status = url.searchParams.get('status') ?? 'open';
  if (!['open', 'resolved', 'dismissed'].includes(status)) return badRequest();
  const page = z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000)
    .safeParse(url.searchParams.get('page') ?? '0');
  if (!page.success) return badRequest();

  const rows = await prisma.client.sessionReview.findMany({
    where: { websiteId, status },
    orderBy: [{ severityRank: 'asc' }, { updatedAt: 'desc' }, { id: 'asc' }],
    skip: page.data * PAGE_SIZE,
    take: PAGE_SIZE + 1,
  });

  return json({
    data: rows.slice(0, PAGE_SIZE),
    page: page.data,
    hasMore: rows.length > PAGE_SIZE,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, body, error } = await parseRequest(request, reviewSchema);
  if (error) return error();

  const { websiteId } = await params;
  if (!(await canUpdateWebsite(auth, websiteId))) return unauthorized();

  const session = await prisma.client.session.findFirst({
    where: { id: body.sessionId, websiteId },
    select: { id: true },
  });
  if (!session) return badRequest({ message: 'Session does not belong to this website' });

  const data = await prisma.client.sessionReview.upsert({
    where: {
      websiteId_sessionId: {
        websiteId,
        sessionId: body.sessionId,
      },
    },
    create: {
      id: uuid(),
      websiteId,
      sessionId: body.sessionId,
      createdByUserId: auth.user.id,
      status: 'open',
      severity: body.severity,
      severityRank: severityRank[body.severity],
      reason: body.reason,
    },
    update: {
      status: 'open',
      severity: body.severity,
      severityRank: severityRank[body.severity],
      reason: body.reason,
      resolvedAt: null,
    },
  });

  return json(data);
}
