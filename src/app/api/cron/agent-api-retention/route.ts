import crypto from 'node:crypto';
import prisma from '@/lib/prisma';
import { json, unauthorized } from '@/lib/response';

const DEFAULT_AUDIT_RETENTION_DAYS = 7;
const MAX_AUDIT_RETENTION_DAYS = 90;

function hasValidSecret(request: Request) {
  const expected = process.env.AGENT_API_RETENTION_SECRET;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || expected.length < 32 || !supplied) return false;

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

function getAuditRetentionDays() {
  const configured = Number(process.env.AGENT_API_AUDIT_RETENTION_DAYS);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, MAX_AUDIT_RETENTION_DAYS)
    : DEFAULT_AUDIT_RETENTION_DAYS;
}

export async function POST(request: Request) {
  if (!hasValidSecret(request)) return unauthorized();

  const now = Date.now();
  const auditCutoff = new Date(now - getAuditRetentionDays() * 24 * 60 * 60 * 1000);
  const ingressCutoff = new Date(now - 24 * 60 * 60 * 1000);
  const [audits, ingressWindows] = await prisma.transaction([
    prisma.client.serviceApiKeyAudit.deleteMany({
      where: { action: 'query', createdAt: { lt: auditCutoff } },
    }),
    prisma.client.agentApiIngressWindow.deleteMany({
      where: { updatedAt: { lt: ingressCutoff } },
    }),
  ]);

  return json({
    deleted: audits.count + ingressWindows.count,
    deletedQueryAudits: audits.count,
    deletedIngressWindows: ingressWindows.count,
    auditRetentionDays: getAuditRetentionDays(),
  });
}
