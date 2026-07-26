import crypto from 'node:crypto';
import { loadTruleafEncryptionKeyring } from '@/lib/truleaf/network-crypto';

const ALGORITHM = 'aes-256-gcm';
const AUTH_TAG_BYTES = 16;
const NONCE_BYTES = 12;
const MAX_REFERENCE_BYTES = 128;

export interface EncryptedAccountBanReference {
  ciphertext: Buffer;
  nonce: Buffer;
  keyVersion: string;
}

function associatedData(
  websiteId: string,
  sessionId: string,
  distinctId: string,
  keyVersion: string,
) {
  return Buffer.from(
    `truleaf-account-ban-reference:v1:${websiteId}:${sessionId}:${distinctId}:${keyVersion}`,
    'utf8',
  );
}

export function encryptAccountBanReference(
  banId: string,
  websiteId: string,
  sessionId: string,
  distinctId: string,
): EncryptedAccountBanReference {
  if (!banId || Buffer.byteLength(banId, 'utf8') > MAX_REFERENCE_BYTES) {
    throw new Error('Truleaf account ban reference is invalid');
  }

  const keyring = loadTruleafEncryptionKeyring();
  const keyVersion = keyring.activeVersion;
  const key = keyring.encryptionKeys.get(keyVersion);

  if (!key) {
    throw new Error('Active Truleaf account ban-reference encryption key is unavailable');
  }

  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce);

  cipher.setAAD(associatedData(websiteId, sessionId, distinctId, keyVersion));

  const encrypted = Buffer.concat([cipher.update(banId, 'utf8'), cipher.final()]);
  const ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]);

  return { ciphertext, nonce, keyVersion };
}

export function decryptAccountBanReference(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  keyVersion: string,
  websiteId: string,
  sessionId: string,
  distinctId: string,
) {
  const key = loadTruleafEncryptionKeyring().encryptionKeys.get(keyVersion);

  if (!key) {
    throw new Error(`Unknown Truleaf account ban-reference key version: ${keyVersion}`);
  }

  const value = Buffer.from(ciphertext);

  if (value.length <= AUTH_TAG_BYTES) {
    throw new Error('Truleaf account ban-reference ciphertext is invalid');
  }

  const tag = value.subarray(value.length - AUTH_TAG_BYTES);
  const encrypted = value.subarray(0, value.length - AUTH_TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(nonce));

  decipher.setAAD(associatedData(websiteId, sessionId, distinctId, keyVersion));
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
