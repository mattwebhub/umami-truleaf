import { afterEach, beforeEach, expect, test } from 'vitest';
import { decryptAccountBanReference, encryptAccountBanReference } from './account-ban-reference';

const websiteId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const distinctId = '507f1f77bcf86cd799439011';
const key = Buffer.alloc(32, 9).toString('base64');

beforeEach(() => {
  process.env.TRULEAF_NETWORK_ENCRYPTION_KEYS = `v1:${key}`;
});

afterEach(() => {
  delete process.env.TRULEAF_NETWORK_ENCRYPTION_KEYS;
});

test('encrypts an opaque reference and binds it to website, session, and account', () => {
  const banId = 'opaque-operation-id';
  const encrypted = encryptAccountBanReference(banId, websiteId, sessionId, distinctId);

  expect(Buffer.from(encrypted.ciphertext).toString('utf8')).not.toContain(banId);
  expect(
    decryptAccountBanReference(
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.keyVersion,
      websiteId,
      sessionId,
      distinctId,
    ),
  ).toBe(banId);
  expect(() =>
    decryptAccountBanReference(
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.keyVersion,
      websiteId,
      sessionId,
      'different-account',
    ),
  ).toThrow();
});

test('rejects empty and oversized references', () => {
  expect(() => encryptAccountBanReference('', websiteId, sessionId, distinctId)).toThrow();
  expect(() =>
    encryptAccountBanReference('x'.repeat(129), websiteId, sessionId, distinctId),
  ).toThrow();
});
