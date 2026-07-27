import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  deferTruleafIdentityProfileRetry,
  deleteExpiredTruleafSessionIdentities,
  getPendingTruleafSessionIdentities,
  getTruleafSessionIdentityProof,
  recordTruleafSessionIdentityProof,
} from './truleafSessionIdentity';

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  findUnique: vi.fn(),
  queryRawUnsafe: vi.fn(),
  updateMany: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    client: {
      $queryRawUnsafe: mocks.queryRawUnsafe,
      truleafSessionIdentity: {
        deleteMany: mocks.deleteMany,
        findUnique: mocks.findUnique,
        updateMany: mocks.updateMany,
        upsert: mocks.upsert,
      },
    },
  },
}));

const websiteId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const distinctId = '507f1f77bcf86cd799439011';

function createProof() {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({
    sub: distinctId,
    websiteId,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.signature`;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TRULEAF_NETWORK_ENCRYPTION_KEYS = `v1:${Buffer.alloc(32, 8).toString('base64')}`;
  mocks.upsert.mockResolvedValue({ id: 'identity-1' });
  mocks.deleteMany.mockResolvedValue({ count: 0 });
  mocks.queryRawUnsafe.mockResolvedValue([]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  delete process.env.TRULEAF_NETWORK_ENCRYPTION_KEYS;
});

test('stores only encrypted proof material in the dedicated table', async () => {
  const proof = createProof();

  await recordTruleafSessionIdentityProof(websiteId, sessionId, distinctId, proof);

  const args = mocks.upsert.mock.calls[0][0];
  expect(args.where).toEqual({ websiteId_sessionId: { websiteId, sessionId } });
  expect(args.create.proofCiphertext).toBeInstanceOf(Uint8Array);
  expect(JSON.stringify(args)).not.toContain(proof);
});

test('reads an unexpired proof only from the dedicated record', async () => {
  const proof = createProof();

  await recordTruleafSessionIdentityProof(websiteId, sessionId, distinctId, proof);
  const created = mocks.upsert.mock.calls[0][0].create;
  mocks.findUnique.mockResolvedValue(created);

  await expect(getTruleafSessionIdentityProof(websiteId, sessionId)).resolves.toBe(proof);
  expect(mocks.findUnique).toHaveBeenCalledWith({
    where: {
      websiteId_sessionId: { websiteId, sessionId },
      expiresAt: { gt: expect.any(Date) },
    },
  });
});

test('fails closed for corrupt encrypted proof material without exposing it', async () => {
  mocks.findUnique.mockResolvedValue({
    proofCiphertext: Uint8Array.from([1, 2, 3]),
    nonce: Uint8Array.from([1, 2, 3]),
    encryptionKeyVersion: 'v1',
  });

  await expect(getTruleafSessionIdentityProof(websiteId, sessionId)).resolves.toBeUndefined();
});

test('deletes identity records at their proof expiry', async () => {
  const now = new Date('2026-07-26T12:00:00Z');

  await deleteExpiredTruleafSessionIdentities(now);

  expect(mocks.deleteMany).toHaveBeenCalledWith({
    where: { expiresAt: { lte: now } },
  });
});

test('selects pending retries with an anti-join before applying the batch limit', async () => {
  const now = new Date('2026-07-26T12:00:00Z');

  await getPendingTruleafSessionIdentities(now, 500);

  expect(mocks.queryRawUnsafe).toHaveBeenCalledWith(
    expect.stringContaining('left join verified_identity_profile'),
    now,
    100,
  );
  expect(mocks.queryRawUnsafe.mock.calls[0][0]).toContain('profile.identity_profile_id is null');
});

test('backs poison proofs off and eventually parks them until proof expiry', async () => {
  const now = new Date('2026-07-26T12:00:00Z');
  const expiresAt = new Date('2026-08-26T12:00:00Z');

  await deferTruleafIdentityProfileRetry(
    { websiteId, sessionId, expiresAt, profileAttemptCount: 7 },
    now,
  );

  expect(mocks.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        profileAttemptCount: { increment: 1 },
        profileRetryAt: expiresAt,
      }),
    }),
  );
});
