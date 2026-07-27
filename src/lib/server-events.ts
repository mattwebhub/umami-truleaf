import crypto from 'node:crypto';
import { z } from 'zod';

export const SERVER_EVENT_PREFIX = 'server.';

/**
 * Trusted facts live in a namespace that the public collector always rejects.
 * This invariant is independent of optional cockpit presentation configuration,
 * so a missing or malformed dashboard config can never make trusted names
 * writable by a browser.
 */
export function isServerEventName(name: string) {
  return name.startsWith(SERVER_EVENT_PREFIX);
}

const keySchema = z.record(
  z.string().min(1).max(80),
  z.object({
    secret: z
      .string()
      .min(1)
      .refine(value => Buffer.from(value, 'base64').byteLength === 32, {
        message: 'Secret must decode to 32 bytes',
      }),
    websiteIds: z.array(z.uuid()).min(1).max(100),
  }),
);

type ServerEventKey = {
  secret: Buffer;
  websiteIds: string[];
};

let cachedSource: string | undefined;
let cachedKeys: Record<string, ServerEventKey> | null = null;

export function getServerEventKey(
  keyId: string,
  source = process.env.SERVER_EVENT_KEYS,
): ServerEventKey | null {
  if (!source) return null;

  if (source !== cachedSource) {
    cachedSource = source;
    try {
      const parsed = keySchema.parse(JSON.parse(source));
      cachedKeys = Object.fromEntries(
        Object.entries(parsed).map(([id, value]) => [
          id,
          {
            secret: Buffer.from(value.secret, 'base64'),
            websiteIds: value.websiteIds,
          },
        ]),
      );
    } catch {
      cachedKeys = null;
      console.error('Invalid SERVER_EVENT_KEYS; trusted server ingestion disabled');
    }
  }

  return cachedKeys?.[keyId] ?? null;
}

export function createServerEventSignature({
  secret,
  timestamp,
  idempotencyKey,
  rawBody,
}: {
  secret: Buffer;
  timestamp: string;
  idempotencyKey: string;
  rawBody: string;
}) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${idempotencyKey}.${rawBody}`)
    .digest('base64url');
}

export function verifyServerEventSignature(expected: string, supplied: string) {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);

  return (
    expectedBuffer.byteLength === suppliedBuffer.byteLength &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}
