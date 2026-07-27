import crypto from 'node:crypto';

export function hasValidTruleafMaintenanceSecret(request: Request) {
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
