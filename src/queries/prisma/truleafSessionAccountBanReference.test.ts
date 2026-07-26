import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  deleteExpiredTruleafSessionAccountBanReferences,
  deleteTruleafSessionAccountBanReference,
  getTruleafSessionAccountBanReference,
  recordTruleafSessionAccountBanReference,
} from './truleafSessionAccountBanReference';

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  findFirst: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    client: {
      truleafSessionAccountBanReference: {
        deleteMany: mocks.deleteMany,
        findFirst: mocks.findFirst,
        upsert: mocks.upsert,
      },
    },
  },
}));

const websiteId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const distinctId = '507f1f77bcf86cd799439011';
const banId = 'opaque-operation-id';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TRULEAF_NETWORK_ENCRYPTION_KEYS = `v1:${Buffer.alloc(32, 8).toString('base64')}`;
  mocks.upsert.mockResolvedValue({ id: 'reference-1' });
  mocks.deleteMany.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  delete process.env.TRULEAF_NETWORK_ENCRYPTION_KEYS;
});

test('stores only encrypted source-bound reference material', async () => {
  await recordTruleafSessionAccountBanReference(websiteId, sessionId, distinctId, banId, null);

  const args = mocks.upsert.mock.calls[0][0];
  expect(args.where).toEqual({ websiteId_sessionId: { websiteId, sessionId } });
  expect(args.create.referenceCiphertext).toBeInstanceOf(Uint8Array);
  expect(args.create.expiresAt).toBeNull();
  expect(JSON.stringify(args)).not.toContain(banId);
  expect(JSON.stringify(args)).not.toContain(distinctId);
});

test('reads a non-expired reference and fails closed for another account', async () => {
  await recordTruleafSessionAccountBanReference(
    websiteId,
    sessionId,
    distinctId,
    banId,
    new Date('2027-01-01T00:00:00Z'),
  );
  const created = mocks.upsert.mock.calls[0][0].create;
  mocks.findFirst.mockResolvedValue(created);

  await expect(
    getTruleafSessionAccountBanReference(websiteId, sessionId, distinctId),
  ).resolves.toBe(banId);
  await expect(
    getTruleafSessionAccountBanReference(websiteId, sessionId, 'different-account'),
  ).resolves.toBeUndefined();
  expect(mocks.findFirst).toHaveBeenCalledWith({
    where: {
      websiteId,
      sessionId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
    },
  });
});

test('deletes a reference after unban and purges explicitly expired references', async () => {
  const now = new Date('2026-07-26T12:00:00Z');

  await deleteTruleafSessionAccountBanReference(websiteId, sessionId);
  await deleteExpiredTruleafSessionAccountBanReferences(now);

  expect(mocks.deleteMany).toHaveBeenNthCalledWith(1, {
    where: { websiteId, sessionId },
  });
  expect(mocks.deleteMany).toHaveBeenNthCalledWith(2, {
    where: { expiresAt: { lte: now } },
  });
});
