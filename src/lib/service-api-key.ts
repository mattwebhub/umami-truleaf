import crypto from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { z } from 'zod';
import { ROLES } from '@/lib/constants';
import { secret, uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';
import redis from '@/lib/redis';
import { canUpdateWebsite, canViewAuthenticatedWebsite } from '@/permissions';
import { getUser } from '@/queries/prisma';

export const SERVICE_API_KEY_PREFIX = 'umami_sk_';
export const SERVICE_API_KEY_SCOPES = [
  'analytics:summary:read',
  'analytics:product:read',
  'analytics:content:read',
  'analytics:quality:read',
  'moderation:read',
] as const;

export type ServiceApiKeyScope = (typeof SERVICE_API_KEY_SCOPES)[number];

export const serviceApiKeyScopeSchema = z.enum(SERVICE_API_KEY_SCOPES);

const DISPLAY_PREFIX_LENGTH = 20;
const LAST_USED_WRITE_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_RATE_LIMIT = 120;
const DEFAULT_INGRESS_RATE_LIMIT = 300;

function digest(value: string) {
  // Tokens contain 256 bits of entropy, so a plain digest is safe for lookup
  // and survives an unrelated APP_SECRET rotation.
  return crypto.createHash('sha256').update(value).digest('hex');
}

function equalDigest(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');

  return (
    leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function createServiceApiKeySecret() {
  const token = `${SERVICE_API_KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;

  return {
    token,
    keyPrefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
    keyHash: digest(token),
  };
}

export async function createServiceApiKey({
  websiteId,
  name,
  scopes,
  createdByUserId,
  expiresAt,
}: {
  websiteId: string;
  name: string;
  scopes: ServiceApiKeyScope[];
  createdByUserId: string;
  expiresAt?: Date | null;
}) {
  const credential = createServiceApiKeySecret();
  const keyId = uuid();
  const [key] = await prisma.transaction([
    prisma.client.serviceApiKey.create({
      data: {
        id: keyId,
        websiteId,
        name,
        keyPrefix: credential.keyPrefix,
        keyHash: credential.keyHash,
        scopes,
        createdByUserId,
        expiresAt,
      },
    }),
    prisma.client.serviceApiKeyAudit.create({
      data: {
        id: uuid(),
        keyId,
        websiteId,
        action: 'created',
        status: 'success',
        requestId: crypto.randomUUID(),
      },
    }),
  ]);

  return { key, token: credential.token };
}

export function getServiceApiKeyToken(request: Request) {
  const authorization = request.headers.get('authorization');

  if (!authorization?.startsWith('Bearer ')) return null;

  const token = authorization.slice('Bearer '.length);

  return token.startsWith(SERVICE_API_KEY_PREFIX) ? token : null;
}

function hasScope(scopes: unknown, requiredScope: ServiceApiKeyScope) {
  return (
    Array.isArray(scopes) &&
    scopes.every(scope => typeof scope === 'string') &&
    scopes.includes(requiredScope)
  );
}

async function enforceRateLimit(keyId: string, cost: number) {
  const configuredLimit = Number(process.env.AGENT_API_RATE_LIMIT_PER_MINUTE);
  const limit =
    Number.isSafeInteger(configuredLimit) && configuredLimit > 0
      ? configuredLimit
      : DEFAULT_RATE_LIMIT;

  if (redis.enabled) {
    // UmamiRedisClient reports true when the counter reaches the threshold.
    // Adding one keeps exactly `limit` requests available in the window.
    return redis.client.rateLimit(`agent-api:${keyId}`, limit + 1, 60, cost);
  }

  // Self-hosted deployments do not necessarily run Redis. Keep the limit
  // cluster-safe with one atomic Postgres update instead of an in-memory map.
  const rows = await prisma.rawQuery(
    `
    update service_api_key
    set
      rate_limit_window_at = case
        when rate_limit_window_at is null
          or rate_limit_window_at <= now() - interval '1 minute'
        then now()
        else rate_limit_window_at
      end,
      rate_limit_count = case
        when rate_limit_window_at is null
          or rate_limit_window_at <= now() - interval '1 minute'
        then {{cost}}
        else rate_limit_count + {{cost}}
      end
    where service_api_key_id = {{keyId::uuid}}
    returning rate_limit_count
    `,
    { keyId, cost },
    'enforceAgentApiRateLimit',
  );

  return Number(rows?.[0]?.rate_limit_count ?? limit + 1) > limit;
}

export function getAgentApiIngressFingerprint(request: Request) {
  const configuredHeader = process.env.AGENT_API_CLIENT_IP_HEADER?.trim().toLowerCase();
  let address = 'unattributed';

  // Only trust a single, explicitly configured header that the deployment's
  // ingress overwrites. Falling back to X-Forwarded-For would let callers
  // rotate arbitrary values and create unbounded limiter rows.
  if (configuredHeader && /^[a-z0-9-]+$/.test(configuredHeader)) {
    const candidate = request.headers.get(configuredHeader)?.trim();

    if (candidate && !candidate.includes(',') && ipaddr.isValid(candidate)) {
      let parsed = ipaddr.parse(candidate);
      if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
        parsed = (parsed as ipaddr.IPv6).toIPv4Address();
      }
      address = parsed.toString();
    }
  }

  return crypto.createHmac('sha256', secret()).update(`agent-api:${address}`).digest('hex');
}

export async function enforceAgentApiIngressLimit(request: Request) {
  const configuredLimit = Number(process.env.AGENT_API_INGRESS_RATE_LIMIT_PER_MINUTE);
  const limit =
    Number.isSafeInteger(configuredLimit) && configuredLimit > 0
      ? configuredLimit
      : DEFAULT_INGRESS_RATE_LIMIT;
  const fingerprint = getAgentApiIngressFingerprint(request);

  if (redis.enabled) {
    return redis.client.rateLimit(`agent-api-ingress:${fingerprint}`, limit + 1, 60);
  }

  const rows = await prisma.rawQuery(
    `
    insert into agent_api_ingress_window (fingerprint, window_at, count, updated_at)
    values ({{fingerprint}}, now(), 1, now())
    on conflict (fingerprint) do update
    set
      window_at = case
        when agent_api_ingress_window.window_at <= now() - interval '1 minute'
        then now()
        else agent_api_ingress_window.window_at
      end,
      count = case
        when agent_api_ingress_window.window_at <= now() - interval '1 minute'
        then 1
        else agent_api_ingress_window.count + 1
      end,
      updated_at = now()
    returning count
    `,
    { fingerprint },
    'enforceAgentApiIngressRateLimit',
  );

  return Number(rows?.[0]?.count ?? limit + 1) > limit;
}

export type ServiceApiKeyAuth =
  | {
      ok: true;
      key: {
        id: string;
        websiteId: string;
        name: string;
        scopes: ServiceApiKeyScope[];
      };
    }
  | {
      ok: false;
      reason:
        | 'missing'
        | 'invalid'
        | 'inactive'
        | 'expired'
        | 'revoked'
        | 'scope'
        | 'website'
        | 'owner'
        | 'permission'
        | 'rate-limit';
    };

export async function isActiveServiceApiKeyWebsite(websiteId: string) {
  const website = await prisma.client.website.findFirst({
    where: {
      id: websiteId,
      deletedAt: null,
      OR: [{ teamId: null }, { team: { deletedAt: null } }],
    },
    select: { id: true },
  });

  return Boolean(website);
}

export async function recordServiceApiKeyAudit({
  keyId,
  websiteId,
  action,
  reason,
  queryType,
  status,
  durationMs,
  requestId = crypto.randomUUID(),
}: {
  keyId: string;
  websiteId?: string;
  action: 'created' | 'query' | 'revoked';
  reason?: string;
  queryType?: string;
  status: 'success' | 'error' | 'denied';
  durationMs?: number;
  requestId?: string;
}) {
  await prisma.client.serviceApiKeyAudit.create({
    data: {
      id: uuid(),
      keyId,
      websiteId,
      action,
      reason,
      queryType,
      status,
      durationMs,
      requestId: requestId.slice(0, 64),
    },
  });
}

export async function recordServiceApiKeyAuditSafely(
  input: Parameters<typeof recordServiceApiKeyAudit>[0],
) {
  try {
    await recordServiceApiKeyAudit(input);
  } catch {
    // Analytics reads must not fail because their operational audit sink is
    // temporarily unavailable. Lifecycle audits remain transactional.
    console.error('Failed to persist service API key query audit');
  }
}

export async function revokeServiceApiKey({
  keyId,
  websiteId,
  requestId = crypto.randomUUID(),
}: {
  keyId: string;
  websiteId: string;
  requestId?: string;
}): Promise<boolean> {
  return prisma.transaction(async tx => {
    const result = await tx.serviceApiKey.updateMany({
      where: { id: keyId, websiteId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) return false;

    await tx.serviceApiKeyAudit.create({
      data: {
        id: uuid(),
        keyId,
        websiteId,
        action: 'revoked',
        reason: 'manual',
        status: 'success',
        requestId: requestId.slice(0, 64),
      },
    });
    return true;
  }) as unknown as Promise<boolean>;
}

export async function authenticateServiceApiKey(
  request: Request,
  websiteId: string,
  requiredScope?: ServiceApiKeyScope,
  cost = 1,
): Promise<ServiceApiKeyAuth> {
  const token = getServiceApiKeyToken(request);
  if (!token) return { ok: false, reason: 'missing' };

  const keyPrefix = token.slice(0, DISPLAY_PREFIX_LENGTH);
  const key = await prisma.client.serviceApiKey.findUnique({ where: { keyPrefix } });
  if (!key || !equalDigest(key.keyHash, digest(token))) {
    return { ok: false, reason: 'invalid' };
  }

  if (key.websiteId !== websiteId) {
    return { ok: false, reason: 'website' };
  }
  if (!(await isActiveServiceApiKeyWebsite(websiteId))) {
    return { ok: false, reason: 'inactive' };
  }
  if (key.revokedAt) return { ok: false, reason: 'revoked' };
  if (key.expiresAt && key.expiresAt <= new Date()) {
    return { ok: false, reason: 'expired' };
  }
  if (await enforceRateLimit(key.id, cost)) {
    return { ok: false, reason: 'rate-limit' };
  }
  if (requiredScope && !hasScope(key.scopes, requiredScope)) {
    return { ok: false, reason: 'scope' };
  }

  const owner = await getUser(key.createdByUserId);
  if (!owner) return { ok: false, reason: 'owner' };
  const ownerAuth = {
    user: {
      id: owner.id,
      username: owner.username,
      role: owner.role,
      isAdmin: owner.role === ROLES.admin,
    },
  };
  const storedScopes = key.scopes as ServiceApiKeyScope[];
  const canView = await canViewAuthenticatedWebsite(ownerAuth, websiteId);
  const canModerate = storedScopes.includes('moderation:read')
    ? await canUpdateWebsite(ownerAuth, websiteId)
    : false;
  const effectiveScopes = storedScopes.filter(scope =>
    scope === 'moderation:read' ? canModerate : canView,
  );
  if (effectiveScopes.length === 0 || (requiredScope && !effectiveScopes.includes(requiredScope))) {
    return { ok: false, reason: 'permission' };
  }

  const now = new Date();
  if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() >= LAST_USED_WRITE_INTERVAL_MS) {
    await prisma.client.serviceApiKey.updateMany({
      where: {
        id: key.id,
        OR: [
          { lastUsedAt: null },
          { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_WRITE_INTERVAL_MS) } },
        ],
      },
      data: { lastUsedAt: now },
    });
  }

  return {
    ok: true,
    key: {
      id: key.id,
      websiteId: key.websiteId,
      name: key.name,
      scopes: effectiveScopes,
    },
  };
}
