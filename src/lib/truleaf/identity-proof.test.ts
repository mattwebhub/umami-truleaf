import { afterEach, expect, test, vi } from 'vitest';
import {
  decryptIdentityProof,
  encryptIdentityProof,
  partitionTruleafIdentityProof,
  scheduleTruleafIdentityProofStorage,
  TRULEAF_IDENTITY_PROOF_KEY,
} from './identity-proof';

const websiteId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const distinctId = '507f1f77bcf86cd799439011';
const key = Buffer.alloc(32, 7).toString('base64');

function createProof(
  claims: Record<string, unknown> = {
    sub: distinctId,
    websiteId,
    exp: Math.floor(Date.now() / 1000) + 3600,
  },
) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`;
}

afterEach(() => {
  delete process.env.TRULEAF_NETWORK_ENCRYPTION_KEYS;
  vi.restoreAllMocks();
});

test('removes only the reserved proof from generic identify properties', () => {
  const proof = createProof();
  const result = partitionTruleafIdentityProof({
    role: 'user',
    locale: 'en',
    [TRULEAF_IDENTITY_PROOF_KEY]: proof,
  });

  expect(result).toEqual({
    sessionData: { role: 'user', locale: 'en' },
    proof,
  });
  expect(JSON.stringify(result.sessionData)).not.toContain(proof);
});

test('drops a malformed reserved value instead of passing it to session data', () => {
  const result = partitionTruleafIdentityProof({
    role: 'user',
    [TRULEAF_IDENTITY_PROOF_KEY]: ['not', 'a', 'proof'],
  });

  expect(result).toEqual({ sessionData: { role: 'user' }, proof: undefined });
});

test('encrypts a matching bounded proof and binds it to website and session', () => {
  process.env.TRULEAF_NETWORK_ENCRYPTION_KEYS = `v1:${key}`;
  const proof = createProof();
  const encrypted = encryptIdentityProof(proof, websiteId, sessionId, distinctId);

  expect(encrypted).toBeDefined();
  if (!encrypted) {
    throw new Error('Expected proof encryption to succeed');
  }
  expect(Buffer.from(encrypted.ciphertext).toString('utf8')).not.toContain(proof);
  expect(
    decryptIdentityProof(
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.keyVersion,
      websiteId,
      sessionId,
    ),
  ).toBe(proof);
  expect(() =>
    decryptIdentityProof(
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.keyVersion,
      websiteId,
      '33333333-3333-4333-8333-333333333333',
    ),
  ).toThrow();
});

test('rejects expired, mismatched, and implausibly long-lived proof candidates', () => {
  process.env.TRULEAF_NETWORK_ENCRYPTION_KEYS = `v1:${key}`;
  const now = new Date('2026-07-26T12:00:00Z');

  expect(
    encryptIdentityProof(
      createProof({
        sub: distinctId,
        websiteId,
        exp: Math.floor(now.getTime() / 1000) - 1,
      }),
      websiteId,
      sessionId,
      distinctId,
      now,
    ),
  ).toBeUndefined();
  expect(
    encryptIdentityProof(
      createProof({
        sub: 'different-user',
        websiteId,
        exp: Math.floor(now.getTime() / 1000) + 3600,
      }),
      websiteId,
      sessionId,
      distinctId,
      now,
    ),
  ).toBeUndefined();
  expect(
    encryptIdentityProof(
      createProof({
        sub: distinctId,
        websiteId,
        exp: Math.floor(now.getTime() / 1000) + 367 * 24 * 60 * 60,
      }),
      websiteId,
      sessionId,
      distinctId,
      now,
    ),
  ).toBeUndefined();
});

test('contains asynchronous storage failures without logging proof material', async () => {
  let scheduled: (() => Promise<void>) | undefined;
  const task = vi.fn(async () => {
    throw new Error(createProof());
  });

  scheduleTruleafIdentityProofStorage(task, callback => {
    if (typeof callback === 'function') {
      scheduled = callback as () => Promise<void>;
    }
  });

  expect(task).not.toHaveBeenCalled();
  await expect(scheduled?.()).resolves.toBeUndefined();
  expect(task).toHaveBeenCalledOnce();
});
