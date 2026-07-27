import { z } from 'zod';
import prisma from '@/lib/prisma';
import { parseRequest } from '@/lib/request';
import { json, notFound, unauthorized } from '@/lib/response';
import { canUpdateWebsite } from '@/permissions';

const updateSchema = z.object({
  status: z.enum(['open', 'resolved', 'dismissed']),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; reviewId: string }> },
) {
  const { auth, body, error } = await parseRequest(request, updateSchema);
  if (error) return error();

  const { websiteId, reviewId } = await params;
  if (!(await canUpdateWebsite(auth, websiteId))) return unauthorized();

  const existing = await prisma.client.sessionReview.findFirst({
    where: { id: reviewId, websiteId },
  });
  if (!existing) return notFound();

  const data = await prisma.client.sessionReview.update({
    where: { id: reviewId },
    data: {
      status: body.status,
      resolvedAt: body.status === 'open' ? null : new Date(),
    },
  });

  return json(data);
}
