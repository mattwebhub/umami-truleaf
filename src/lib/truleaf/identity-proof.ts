import crypto from 'node:crypto';
import debug from 'debug';
import { after } from 'next/server';
import { loadTruleafEncryptionKeyring } from '@/lib/truleaf/network-crypto';
import type { DynamicData } from '@/lib/types';

const ALGORITHM = 'aes-256-gcm';
const AUTH_TAG_BYTES = 16;
const NONCE_BYTES = 12;
const MAX_PROOF_BYTES = 4096;
const MAX_ACCEPTED_PROOF_LIFETIME_MS = 366 * 24 * 60 * 60 * 1000;
// Match Truleaf's approved default issuer lifetime. Longer structurally valid
// JWTs can be accepted, but the fork has no reason to retain them longer now
// that unban authorization is an independent opaque reference.
const MAX_STORED_PROOF_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const log = debug('umami:truleaf');

export const TRULEAF_IDENTITY_PROOF_KEY = 'truleafIdentityProof';

interface IdentityProofClaims {
  sub: string;
  websiteId: string;
  exp: number;
}

export interface EncryptedIdentityProof {
  ciphertext: Buffer;
  nonce: Buffer;
  keyVersion: string;
  expiresAt: Date;
}

function associatedData(websiteId: string, sessionId: string, keyVersion: string) {
  return Buffer.from(`truleaf-identity-proof:v1:${websiteId}:${sessionId}:${keyVersion}`, 'utf8');
}

function decodeClaims(proof: string): IdentityProofClaims | undefined {
  if (!proof || Buffer.byteLength(proof, 'utf8') > MAX_PROOF_BYTES) {
    return undefined;
  }

  const segments = proof.split('.');

  if (segments.length !== 3) {
    return undefined;
  }

  try {
    const value = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));

    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.sub !== 'string' ||
      !value.sub ||
      value.sub.length > 50 ||
      typeof value.websiteId !== 'string' ||
      typeof value.exp !== 'number' ||
      !Number.isSafeInteger(value.exp)
    ) {
      return undefined;
    }

    return value as IdentityProofClaims;
  } catch {
    return undefined;
  }
}

export function partitionTruleafIdentityProof(data: Record<string, unknown>): {
  sessionData: DynamicData;
  proof?: string;
} {
  const sessionData = { ...data };
  const candidate = sessionData[TRULEAF_IDENTITY_PROOF_KEY];

  delete sessionData[TRULEAF_IDENTITY_PROOF_KEY];

  return {
    sessionData: sessionData as DynamicData,
    proof: typeof candidate === 'string' ? candidate : undefined,
  };
}

export function encryptIdentityProof(
  proof: string,
  websiteId: string,
  sessionId: string,
  distinctId: string,
  now = new Date(),
): EncryptedIdentityProof | undefined {
  const claims = decodeClaims(proof);
  const expiresAt = claims ? new Date(claims.exp * 1000) : undefined;

  if (
    !claims ||
    claims.sub !== distinctId ||
    claims.websiteId !== websiteId ||
    !expiresAt ||
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt <= now ||
    expiresAt.getTime() - now.getTime() > MAX_ACCEPTED_PROOF_LIFETIME_MS
  ) {
    return undefined;
  }

  const keyring = loadTruleafEncryptionKeyring();
  const keyVersion = keyring.activeVersion;
  const key = keyring.encryptionKeys.get(keyVersion);

  if (!key) {
    throw new Error('Active Truleaf identity encryption key is unavailable');
  }

  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce);

  cipher.setAAD(associatedData(websiteId, sessionId, keyVersion));

  const encrypted = Buffer.concat([cipher.update(proof, 'utf8'), cipher.final()]);
  const ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]);

  return {
    ciphertext,
    nonce,
    keyVersion,
    expiresAt: new Date(
      Math.min(expiresAt.getTime(), now.getTime() + MAX_STORED_PROOF_LIFETIME_MS),
    ),
  };
}

export function decryptIdentityProof(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  keyVersion: string,
  websiteId: string,
  sessionId: string,
) {
  const key = loadTruleafEncryptionKeyring().encryptionKeys.get(keyVersion);

  if (!key) {
    throw new Error(`Unknown Truleaf identity encryption key version: ${keyVersion}`);
  }

  const value = Buffer.from(ciphertext);

  if (value.length <= AUTH_TAG_BYTES) {
    throw new Error('Truleaf identity proof ciphertext is invalid');
  }

  const tag = value.subarray(value.length - AUTH_TAG_BYTES);
  const encrypted = value.subarray(0, value.length - AUTH_TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(nonce));

  decipher.setAAD(associatedData(websiteId, sessionId, keyVersion));
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function scheduleTruleafIdentityProofStorage(
  task: () => Promise<unknown>,
  schedule: typeof after = after,
) {
  schedule(async () => {
    try {
      await task();
    } catch {
      // Never log the proof or encryption errors that may include sensitive input.
      log('identity proof storage failed');
    }
  });
}
