import { beforeEach, expect, test, vi } from 'vitest';
import { fetchWebsite } from '@/lib/load';
import prisma from '@/lib/prisma';
import { createServerEventSignature } from '@/lib/server-events';
import { scheduleTruleafIdentityProofStorage } from '@/lib/truleaf/identity-proof';
import { requestTruleafIdentityProfiles } from '@/lib/truleaf/service';
import { recordTruleafSessionIdentityProof, recordVerifiedSessionIdentity } from '@/queries/prisma';
import { createSession, saveEvent } from '@/queries/sql';
import { POST } from './route';

vi.mock('@/lib/crypto', () => ({
  uuid: (...parts: string[]) => `uuid:${parts.join(':')}`,
}));
vi.mock('@/lib/load', () => ({
  fetchWebsite: vi.fn(async () => ({ id: 'website' })),
}));
vi.mock('@/lib/truleaf/config', () => ({
  isTruleafIdentityProfileEnabled: () => true,
  isTruleafModerationEnabled: () => true,
  isTruleafWebsite: () => true,
}));
vi.mock('@/lib/truleaf/identity-proof', () => ({
  scheduleTruleafIdentityProofStorage: vi.fn((task: () => Promise<unknown>) =>
    task().catch(() => undefined),
  ),
}));
vi.mock('@/lib/truleaf/service', () => ({
  requestTruleafIdentityProfiles: vi.fn(),
}));
vi.mock('@/queries/prisma', () => ({
  recordTruleafSessionIdentityProof: vi.fn(async () => ({})),
  recordVerifiedSessionIdentity: vi.fn(),
}));
vi.mock('@/queries/sql', () => ({
  createSession: vi.fn(),
  saveEvent: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    client: {
      serverEventFact: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    },
  },
}));

const websiteId = 'e79ef216-70ab-48df-addc-596b6e9e65a8';
const secret = Buffer.alloc(32, 9);
const keyId = 'backend-v1';
const idempotencyKey = 'stripe:evt_1:subscription-verified';
const body = JSON.stringify({
  websiteId,
  name: 'server.subscription-verified',
  distinctId: 'account-1',
  occurredAt: '2026-07-27T00:00:00.000Z',
  urlPath: '/server/subscription',
  data: { plan: 'professional', revenue: 9.99, currency: 'USD' },
});

function createRequest(overrides: Record<string, string> = {}, rawBody = body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createServerEventSignature({
    secret,
    timestamp,
    idempotencyKey,
    rawBody,
  });

  return new Request('http://localhost/api/server-events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-umami-key-id': keyId,
      'x-umami-timestamp': timestamp,
      'x-umami-idempotency-key': idempotencyKey,
      'x-umami-signature': signature,
      ...overrides,
    },
    body: rawBody,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SERVER_EVENT_KEYS = JSON.stringify({
    [keyId]: {
      secret: secret.toString('base64'),
      websiteIds: [websiteId],
    },
  });
  process.env.PRODUCT_COCKPIT_CONFIG = JSON.stringify({
    websites: [
      {
        websiteId,
        authoritativeEvents: ['server.subscription-verified'],
        metrics: [],
        funnels: [],
        features: [],
      },
    ],
  });
});

test('accepts a signed, website-scoped fact with a deterministic event ID', async () => {
  const response = await POST(createRequest());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    duplicate: false,
    projected: true,
  });
  expect(fetchWebsite).toHaveBeenCalledWith(websiteId);
  expect(createSession).toHaveBeenCalledWith(
    expect.objectContaining({
      id: `uuid:${websiteId}:server:account-1`,
      distinctId: 'account-1',
    }),
  );
  expect(saveEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      eventId: `uuid:server-event:${websiteId}:${keyId}:${idempotencyKey}`,
      eventName: 'server.subscription-verified',
    }),
  );
  expect(vi.mocked(saveEvent).mock.calls[0][0]).not.toHaveProperty('eventData');
  expect(prisma.client.serverEventFact.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        eventName: 'server.subscription-verified',
        idempotencyKey,
      }),
    }),
  );
});

test('resolves a signed server event to its authoritative account profile', async () => {
  const identityProof = 'header.payload.signature';
  const rawBody = JSON.stringify({
    websiteId,
    name: 'server.subscription-verified',
    distinctId: 'account-1',
    identityProof,
    occurredAt: '2026-07-27T00:00:00.000Z',
    urlPath: '/server/subscription',
  });
  vi.mocked(requestTruleafIdentityProfiles).mockResolvedValueOnce({
    profiles: [
      {
        websiteId,
        sessionId: `uuid:${websiteId}:server:account-1`,
        distinctId: 'account-1',
        displayName: 'Matheus Paranhos',
        username: 'matheus',
        role: 'user',
        plan: 'premium',
        profileVersion: '2026-07-27T12:00:00.000Z',
        verifiedUntil: '2026-08-27T12:00:00.000Z',
      },
    ],
  });

  const response = await POST(createRequest({}, rawBody));

  expect(response.status).toBe(200);
  expect(scheduleTruleafIdentityProofStorage).toHaveBeenCalledOnce();
  expect(recordTruleafSessionIdentityProof).toHaveBeenCalledWith(
    websiteId,
    `uuid:${websiteId}:server:account-1`,
    'account-1',
    identityProof,
  );
  expect(recordVerifiedSessionIdentity).toHaveBeenCalledWith(
    expect.objectContaining({
      websiteId,
      sessionId: `uuid:${websiteId}:server:account-1`,
      distinctId: 'account-1',
    }),
  );
});

test('keeps the sender retryable until the signed identity proof is durable', async () => {
  const identityProof = 'header.payload.signature';
  const rawBody = JSON.stringify({
    websiteId,
    name: 'server.subscription-verified',
    distinctId: 'account-1',
    identityProof,
    occurredAt: '2026-07-27T00:00:00.000Z',
    urlPath: '/server/subscription',
  });
  vi.mocked(recordTruleafSessionIdentityProof).mockRejectedValueOnce(
    new Error('identity store unavailable'),
  );

  const response = await POST(createRequest({}, rawBody));

  expect(response.status).toBe(202);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    duplicate: false,
    projected: false,
    identityStored: false,
  });
  expect(saveEvent).not.toHaveBeenCalled();
  expect(prisma.client.serverEventFact.update).not.toHaveBeenCalled();
});

test('acknowledges a durable proof when asynchronous profile resolution is unavailable', async () => {
  const identityProof = 'header.payload.signature';
  const rawBody = JSON.stringify({
    websiteId,
    name: 'server.subscription-verified',
    distinctId: 'account-1',
    identityProof,
    occurredAt: '2026-07-27T00:00:00.000Z',
    urlPath: '/server/subscription',
  });
  vi.mocked(requestTruleafIdentityProfiles).mockRejectedValueOnce(
    new Error('resolver unavailable'),
  );

  const response = await POST(createRequest({}, rawBody));

  expect(response.status).toBe(200);
  expect(recordTruleafSessionIdentityProof).toHaveBeenCalledOnce();
  expect(saveEvent).toHaveBeenCalledOnce();
});

test('returns an idempotent success for an existing deterministic event', async () => {
  vi.mocked(prisma.client.serverEventFact.create).mockRejectedValueOnce({
    code: 'P2002',
  });
  vi.mocked(prisma.client.serverEventFact.findUnique).mockResolvedValueOnce({
    id: 'fact',
    websiteId,
    eventName: 'server.subscription-verified',
    distinctId: 'account-1',
    projectedAt: new Date(),
  } as never);

  const response = await POST(createRequest());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    duplicate: true,
    projected: true,
  });
  expect(saveEvent).not.toHaveBeenCalled();
});

test('keeps an accepted ledger fact retryable until native projection succeeds', async () => {
  vi.mocked(saveEvent).mockRejectedValueOnce(new Error('projection unavailable'));

  const response = await POST(createRequest());

  expect(response.status).toBe(202);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    duplicate: false,
    projected: false,
  });
  expect(prisma.client.serverEventFact.update).not.toHaveBeenCalled();
});

test('rejects a modified signature before writing anything', async () => {
  const response = await POST(createRequest({ 'x-umami-signature': 'invalid' }));

  expect(response.status).toBe(401);
  expect(createSession).not.toHaveBeenCalled();
  expect(saveEvent).not.toHaveBeenCalled();
});
