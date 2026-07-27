import { beforeEach, expect, test, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { POST } from './route';

vi.mock('@/lib/prisma', () => ({
  default: {
    transaction: vi.fn(),
    client: {
      serviceApiKeyAudit: { deleteMany: vi.fn() },
      agentApiIngressWindow: { deleteMany: vi.fn() },
    },
  },
}));

const secret = 'agent-api-retention-secret-32-characters';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGENT_API_RETENTION_SECRET = secret;
  delete process.env.AGENT_API_AUDIT_RETENTION_DAYS;
  vi.mocked(prisma.client.serviceApiKeyAudit.deleteMany).mockReturnValue('audits' as never);
  vi.mocked(prisma.client.agentApiIngressWindow.deleteMany).mockReturnValue('ingress' as never);
  vi.mocked(prisma.transaction).mockResolvedValue([{ count: 3 }, { count: 2 }]);
});

test('requires a dedicated strong retention credential', async () => {
  const response = await POST(new Request('http://localhost/api/cron/agent-api-retention'));

  expect(response.status).toBe(401);
  expect(prisma.transaction).not.toHaveBeenCalled();
});

test('deletes old audits and stale ingress windows with bounded retention', async () => {
  process.env.AGENT_API_AUDIT_RETENTION_DAYS = '999';
  const response = await POST(
    new Request('http://localhost/api/cron/agent-api-retention', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    deleted: 5,
    deletedQueryAudits: 3,
    deletedIngressWindows: 2,
    auditRetentionDays: 90,
  });
  expect(prisma.client.serviceApiKeyAudit.deleteMany).toHaveBeenCalledWith({
    where: { action: 'query', createdAt: { lt: expect.any(Date) } },
  });
  expect(prisma.client.agentApiIngressWindow.deleteMany).toHaveBeenCalledWith({
    where: { updatedAt: { lt: expect.any(Date) } },
  });
});
