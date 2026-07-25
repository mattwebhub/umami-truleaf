import { beforeEach, expect, test, vi } from 'vitest';
import { deleteExpiredTruleafSessionNetworks } from '@/queries/prisma';
import { POST } from './route';

vi.mock('@/queries/prisma', () => ({
  deleteExpiredTruleafSessionNetworks: vi.fn(),
}));

const deleteExpiredMock = vi.mocked(deleteExpiredTruleafSessionNetworks);
const secret = 'retention-secret-at-least-32-characters';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TRULEAF_RETENTION_SECRET = secret;
});

test('rejects missing and invalid retention credentials', async () => {
  const missing = await POST(new Request('http://localhost/api/cron/retention'));
  const invalid = await POST(
    new Request('http://localhost/api/cron/retention', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
    }),
  );

  expect(missing.status).toBe(401);
  expect(invalid.status).toBe(401);
  expect(deleteExpiredMock).not.toHaveBeenCalled();
});

test('deletes expired mappings with the dedicated credential', async () => {
  deleteExpiredMock.mockResolvedValue({ count: 3 });

  const response = await POST(
    new Request('http://localhost/api/cron/retention', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    }),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ deleted: 3 });
  expect(deleteExpiredMock).toHaveBeenCalledOnce();
});
