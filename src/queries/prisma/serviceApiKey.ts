import crypto from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { uuid } from '@/lib/crypto';

export type ServiceApiKeyRevocationReason = 'website-deleted' | 'team-deleted' | 'member-removed';

export async function revokeServiceApiKeysForLifecycle(
  tx: Prisma.TransactionClient,
  where: Prisma.ServiceApiKeyWhereInput,
  reason: ServiceApiKeyRevocationReason,
) {
  const activeKeys = await tx.serviceApiKey.findMany({
    where: { ...where, revokedAt: null },
    select: { id: true, websiteId: true },
  });

  if (!activeKeys.length) return 0;

  const keyIds = activeKeys.map(key => key.id);
  await tx.serviceApiKey.updateMany({
    where: { id: { in: keyIds }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await tx.serviceApiKeyAudit.createMany({
    data: activeKeys.map(key => ({
      id: uuid(),
      keyId: key.id,
      websiteId: key.websiteId,
      action: 'revoked',
      reason,
      status: 'success',
      requestId: crypto.randomUUID(),
    })),
  });

  return activeKeys.length;
}
