import crypto from 'node:crypto';
import { json, unauthorized } from '@/lib/response';
import { deleteExpiredTruleafSessionNetworks } from '@/queries/prisma';

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

  const result = await deleteExpiredTruleafSessionNetworks();

  return json({ deleted: result.count });
}
