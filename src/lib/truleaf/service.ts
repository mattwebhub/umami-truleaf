import crypto from 'node:crypto';
import { z } from 'zod';

const SIGNATURE_VERSION = 'v1';
const REQUEST_TIMEOUT_MS = 10_000;

export type ModerationTarget =
  | { type: 'account'; value: string; proof: string }
  | { type: 'account'; value: string; banId: string }
  | { type: 'ip'; value: string; banId?: string };

export interface ModerationSource {
  system: 'umami';
  websiteId: string;
  sessionId: string;
}

interface ServiceRequest {
  path:
    | '/api/v1/internal/moderation/status'
    | '/api/v1/internal/moderation/actions'
    | '/api/v1/internal/moderation/identity-profiles';
  body: Record<string, unknown>;
  schema: z.ZodType;
}

export interface IdentityProfileRequest {
  websiteId: string;
  sessionId: string;
  distinctId: string;
  proof: string;
}

const identityProfileSchema = z.object({
  websiteId: z.uuid(),
  sessionId: z.uuid(),
  distinctId: z.string().min(1).max(50),
  displayName: z.string().min(1).max(100),
  username: z.string().min(1).max(50),
  avatarUrl: z
    .url()
    .max(2183)
    .refine(value => value.startsWith('https:'), 'Avatar URL must use HTTPS')
    .optional(),
  role: z.enum(['user', 'admin', 'expert', 'creator']),
  plan: z.enum(['free', 'premium', 'professional']),
  profileVersion: z.iso.datetime(),
  verifiedUntil: z.iso.datetime(),
});

export const identityProfilesSchema = z.object({
  profiles: z.array(identityProfileSchema).max(100),
});

export type VerifiedIdentityProfileResponse = z.infer<typeof identityProfileSchema>;

export const moderationTargetStatusSchema = z.object({
  type: z.enum(['account', 'ip']),
  targetId: z.string().optional(),
  banId: z.string().optional(),
  displayValue: z.string().optional(),
  banned: z.boolean(),
  canBan: z.boolean().optional(),
  canUnban: z.boolean().optional(),
  sourceMatches: z.boolean().optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
  vercel: z.enum(['applied', 'pending', 'failed', 'not_applicable']).optional(),
});

export const moderationStatusSchema = z.object({
  targets: z.array(moderationTargetStatusSchema),
});

const enforcementStateSchema = z.enum(['applied', 'pending', 'failed', 'not_applicable']);

export const moderationActionSchema = z.object({
  operationId: z.string(),
  requestId: z.string(),
  status: z.enum(['applied', 'partial', 'pending', 'failed']),
  targets: z.array(
    z.object({
      type: z.enum(['account', 'ip']),
      displayValue: z.string(),
      status: z.enum(['applied', 'pending', 'failed']),
      api: enforcementStateSchema,
      vercel: enforcementStateSchema,
      code: z.string().optional(),
      message: z.string().optional(),
    }),
  ),
});

export const moderationBrowserActionSchema = z.object({
  requestId: z.string(),
  status: z.enum(['applied', 'partial', 'pending', 'failed']),
  targets: z.array(
    z.object({
      type: z.enum(['account', 'ip']),
      status: z.enum(['applied', 'pending', 'failed']),
      api: enforcementStateSchema,
      vercel: enforcementStateSchema,
      code: z.string().optional(),
      message: z.string().optional(),
    }),
  ),
});

export type ModerationStatusResponse = z.infer<typeof moderationStatusSchema>;
export type ModerationActionResponse = z.infer<typeof moderationActionSchema>;
export type ModerationBrowserActionResponse = z.infer<typeof moderationBrowserActionSchema>;

function getServiceConfig() {
  const baseUrl = process.env.TRULEAF_MODERATION_API_URL;
  const keyId = process.env.TRULEAF_MODERATION_KEY_ID;
  const secret = process.env.TRULEAF_MODERATION_HMAC_SECRET;

  if (!baseUrl || !keyId || !secret) {
    throw new Error('Truleaf moderation service configuration is incomplete');
  }

  const url = new URL(baseUrl);
  const decodedSecret = Buffer.from(secret, 'base64');
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

  if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production' && !isLoopback) {
    throw new Error('TRULEAF_MODERATION_API_URL must use HTTPS in production');
  }

  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('TRULEAF_MODERATION_API_URL must use HTTP or HTTPS');
  }

  if (decodedSecret.length !== 32) {
    throw new Error('TRULEAF_MODERATION_HMAC_SECRET must be a base64-encoded 32-byte key');
  }

  return {
    baseUrl: url,
    keyId,
    secret: decodedSecret,
  };
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function createTruleafServiceSignature({
  method,
  pathname,
  timestamp,
  nonce,
  rawBody,
  secret,
}: {
  method: string;
  pathname: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
  secret: Uint8Array;
}) {
  const canonical = [
    SIGNATURE_VERSION,
    method.toUpperCase(),
    pathname,
    timestamp,
    nonce,
    sha256(rawBody),
  ].join('\n');

  return crypto.createHmac('sha256', secret).update(canonical).digest('base64url');
}

export async function requestTruleafModeration<T extends z.ZodType>({
  path,
  body,
  schema,
}: ServiceRequest & { schema: T }): Promise<z.infer<T>> {
  const { baseUrl, keyId, secret } = getServiceConfig();
  const url = new URL(path, baseUrl);
  const rawBody = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const signature = createTruleafServiceSignature({
    method: 'POST',
    pathname: url.pathname,
    timestamp,
    nonce,
    rawBody,
    secret,
  });
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': String(body.requestId ?? nonce),
      'x-truleaf-key-id': keyId,
      'x-truleaf-timestamp': timestamp,
      'x-truleaf-nonce': nonce,
      'x-truleaf-signature': signature,
    },
    body: rawBody,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok || responseBody?.success !== true) {
    const error = new Error(
      responseBody?.error?.message || `Truleaf moderation service returned ${response.status}`,
    );
    Object.assign(error, {
      status: response.status,
      code: responseBody?.error?.details?.code ?? responseBody?.error?.code,
    });
    throw error;
  }

  const parsed = schema.safeParse(responseBody.data);

  if (!parsed.success) {
    throw new Error('Truleaf moderation service returned an invalid response');
  }

  return parsed.data;
}

export function requestTruleafIdentityProfiles(identities: IdentityProfileRequest[]) {
  return requestTruleafModeration({
    path: '/api/v1/internal/moderation/identity-profiles',
    body: { identities },
    schema: identityProfilesSchema,
  });
}
