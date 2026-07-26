import crypto from 'node:crypto';
import ipaddr from 'ipaddr.js';

const ALGORITHM = 'aes-256-gcm';
const AUTH_TAG_BYTES = 16;
const NONCE_BYTES = 12;
const KEY_BYTES = 32;

export interface EncryptedNetworkAddress {
  ciphertext: Buffer;
  nonce: Buffer;
  keyVersion: string;
  hmac: string;
  family: 4 | 6;
}

interface EncryptionKeyring {
  activeVersion: string;
  encryptionKeys: Map<string, Buffer>;
}

interface Keyring extends EncryptionKeyring {
  hmacKey: Buffer;
}

function decodeKey(value: string, name: string) {
  const key = Buffer.from(value, 'base64');

  if (key.length !== KEY_BYTES) {
    throw new Error(`${name} must be a base64-encoded ${KEY_BYTES}-byte key`);
  }

  return key;
}

export function loadTruleafEncryptionKeyring(): EncryptionKeyring {
  const entries = (process.env.TRULEAF_NETWORK_ENCRYPTION_KEYS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(entry => {
      const separator = entry.indexOf(':');
      const version = entry.slice(0, separator);
      const value = entry.slice(separator + 1);

      if (separator < 1 || !/^[a-zA-Z0-9_-]{1,32}$/.test(version) || !value) {
        throw new Error('TRULEAF_NETWORK_ENCRYPTION_KEYS contains an invalid key entry');
      }

      return [version, decodeKey(value, `Encryption key ${version}`)] as const;
    });

  if (!entries.length) {
    throw new Error('TRULEAF_NETWORK_ENCRYPTION_KEYS is required');
  }

  if (new Set(entries.map(([version]) => version)).size !== entries.length) {
    throw new Error('TRULEAF_NETWORK_ENCRYPTION_KEYS contains a duplicate key version');
  }

  return {
    activeVersion: entries[0][0],
    encryptionKeys: new Map(entries),
  };
}

function loadKeyring(): Keyring {
  const encryption = loadTruleafEncryptionKeyring();
  const hmacKey = decodeKey(process.env.TRULEAF_NETWORK_HMAC_KEY ?? '', 'TRULEAF_NETWORK_HMAC_KEY');

  if ([...encryption.encryptionKeys.values()].some(key => key.equals(hmacKey))) {
    throw new Error('Truleaf network encryption and HMAC keys must be different');
  }

  return { ...encryption, hmacKey };
}

export function normalizeNetworkAddress(value: string) {
  let address = ipaddr.parse(value);

  if (address.kind() === 'ipv6' && (address as ipaddr.IPv6).isIPv4MappedAddress()) {
    address = (address as ipaddr.IPv6).toIPv4Address();
  }

  return {
    value: address.toNormalizedString(),
    family: address.kind() === 'ipv4' ? (4 as const) : (6 as const),
  };
}

function associatedData(websiteId: string, sessionId: string, keyVersion: string) {
  return Buffer.from(`truleaf-network:v1:${websiteId}:${sessionId}:${keyVersion}`, 'utf8');
}

export function encryptNetworkAddress(
  address: string,
  websiteId: string,
  sessionId: string,
): EncryptedNetworkAddress {
  const normalized = normalizeNetworkAddress(address);
  const keyring = loadKeyring();
  const keyVersion = keyring.activeVersion;
  const activeKey = keyring.encryptionKeys.get(keyVersion);

  if (!activeKey) {
    throw new Error('Active Truleaf network encryption key is unavailable');
  }

  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, activeKey, nonce);

  cipher.setAAD(associatedData(websiteId, sessionId, keyVersion));

  const encrypted = Buffer.concat([cipher.update(normalized.value, 'utf8'), cipher.final()]);
  const ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]);
  const hmac = crypto
    .createHmac('sha256', keyring.hmacKey)
    .update(`${websiteId}:${normalized.value}`)
    .digest('hex');

  return { ciphertext, nonce, keyVersion, hmac, family: normalized.family };
}

export function decryptNetworkAddress(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  keyVersion: string,
  websiteId: string,
  sessionId: string,
) {
  const keyring = loadKeyring();
  const key = keyring.encryptionKeys.get(keyVersion);

  if (!key) {
    throw new Error(`Unknown Truleaf network encryption key version: ${keyVersion}`);
  }

  const value = Buffer.from(ciphertext);
  const tag = value.subarray(value.length - AUTH_TAG_BYTES);
  const encrypted = value.subarray(0, value.length - AUTH_TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(nonce));

  decipher.setAAD(associatedData(websiteId, sessionId, keyVersion));
  decipher.setAuthTag(tag);

  return normalizeNetworkAddress(
    Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'),
  ).value;
}

export function maskNetworkAddress(address: string) {
  const normalized = normalizeNetworkAddress(address);

  if (normalized.family === 4) {
    const parts = normalized.value.split('.');
    return `${parts[0]}.${parts[1]}.x.x`;
  }

  const parts = normalized.value.split(':');
  return `${parts.slice(0, 3).join(':')}:…`;
}
