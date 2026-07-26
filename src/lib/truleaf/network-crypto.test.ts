import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  decryptNetworkAddress,
  encryptNetworkAddress,
  maskNetworkAddress,
  normalizeNetworkAddress,
} from './network-crypto';

const encryptionKey = crypto.randomBytes(32).toString('base64');
const previousKey = crypto.randomBytes(32).toString('base64');
const hmacKey = crypto.randomBytes(32).toString('base64');

describe('Truleaf network cryptography', () => {
  beforeEach(() => {
    process.env.TRULEAF_NETWORK_ENCRYPTION_KEYS = `v2:${encryptionKey},v1:${previousKey}`;
    process.env.TRULEAF_NETWORK_HMAC_KEY = hmacKey;
  });

  afterEach(() => {
    delete process.env.TRULEAF_NETWORK_ENCRYPTION_KEYS;
    delete process.env.TRULEAF_NETWORK_HMAC_KEY;
  });

  test('normalizes IPv4-mapped addresses', () => {
    expect(normalizeNetworkAddress('::ffff:192.0.2.25')).toEqual({
      value: '192.0.2.25',
      family: 4,
    });
  });

  test('encrypts, authenticates, and decrypts an address with associated data', () => {
    const result = encryptNetworkAddress('2001:0db8::1', 'website-1', 'session-1');

    expect(result.keyVersion).toBe('v2');
    expect(result.hmac).toHaveLength(64);
    expect(
      decryptNetworkAddress(
        result.ciphertext,
        result.nonce,
        result.keyVersion,
        'website-1',
        'session-1',
      ),
    ).toBe('2001:db8:0:0:0:0:0:1');
  });

  test('rejects ciphertext moved to another session', () => {
    const result = encryptNetworkAddress('192.0.2.25', 'website-1', 'session-1');

    expect(() =>
      decryptNetworkAddress(
        result.ciphertext,
        result.nonce,
        result.keyVersion,
        'website-1',
        'session-2',
      ),
    ).toThrow();
  });

  test('creates stable blind indexes without deterministic ciphertext', () => {
    const first = encryptNetworkAddress('192.0.2.25', 'website-1', 'session-1');
    const second = encryptNetworkAddress('192.0.2.25', 'website-1', 'session-1');

    expect(first.hmac).toBe(second.hmac);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
    expect(first.nonce).not.toEqual(second.nonce);
  });

  test('does not correlate the same address across websites in blind indexes', () => {
    const first = encryptNetworkAddress('192.0.2.25', 'website-1', 'session-1');
    const second = encryptNetworkAddress('192.0.2.25', 'website-2', 'session-1');

    expect(first.hmac).not.toBe(second.hmac);
  });

  test('rejects duplicate versions and key reuse', () => {
    process.env.TRULEAF_NETWORK_ENCRYPTION_KEYS = `v1:${encryptionKey},v1:${previousKey}`;
    expect(() => encryptNetworkAddress('192.0.2.25', 'website-1', 'session-1')).toThrow(
      'duplicate key version',
    );

    process.env.TRULEAF_NETWORK_ENCRYPTION_KEYS = `v1:${encryptionKey}`;
    process.env.TRULEAF_NETWORK_HMAC_KEY = encryptionKey;
    expect(() => encryptNetworkAddress('192.0.2.25', 'website-1', 'session-1')).toThrow(
      'must be different',
    );
  });

  test('masks addresses for operator display', () => {
    expect(maskNetworkAddress('192.0.2.25')).toBe('192.0.x.x');
    expect(maskNetworkAddress('2001:db8::1')).toBe('2001:db8:0:…');
  });
});
