import { beforeEach, expect, test, vi } from 'vitest';
import { parseRequest } from '@/lib/request';
import {
  scheduleTruleafIdentityProofStorage,
  TRULEAF_IDENTITY_PROOF_KEY,
} from '@/lib/truleaf/identity-proof';
import { recordTruleafSessionIdentityProof, recordTruleafSessionNetwork } from '@/queries/prisma';
import { createSession, saveEvent, saveSessionData } from '@/queries/sql';
import { POST } from './route';

vi.mock('isbot', () => ({ isbot: () => false }));
vi.mock('@/lib/clickhouse', () => ({ default: { enabled: false } }));
vi.mock('@/lib/crypto', () => ({
  getSalt: () => 'salt',
  hash: () => 'hash',
  secret: () => 'secret',
  uuid: (...args: unknown[]) => (args.length ? 'session-id' : 'generated-id'),
}));
vi.mock('@/lib/detect', () => ({
  getClientInfo: vi.fn(async () => ({
    ip: '192.0.2.10',
    userAgent: 'browser',
    device: 'desktop',
    browser: 'Chrome',
    os: 'Linux',
    country: 'US',
    region: 'CA',
    city: 'Example',
  })),
  hasBlockedIp: () => false,
}));
vi.mock('@/lib/jwt', () => ({
  createToken: () => 'cache-token',
  parseToken: () => null,
}));
vi.mock('@/lib/load', () => ({ fetchWebsite: vi.fn(async () => ({ id: 'website' })) }));
vi.mock('@/lib/request', () => ({ parseRequest: vi.fn() }));
vi.mock('@/lib/truleaf/capture-source', () => ({
  getTruleafCaptureAddress: () => undefined,
  scheduleTruleafNetworkCapture: vi.fn(),
  shouldCaptureTruleafNetwork: () => false,
}));
vi.mock('@/lib/truleaf/config', () => ({
  isTruleafModerationEnabled: vi.fn(() => true),
  isTruleafNetworkCaptureEnabled: () => false,
  isTruleafWebsite: vi.fn(() => true),
}));
vi.mock('@/lib/truleaf/identity-proof', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/truleaf/identity-proof')>()),
  scheduleTruleafIdentityProofStorage: vi.fn((task: () => Promise<unknown>) => task()),
}));
vi.mock('@/queries/prisma', () => ({
  recordTruleafSessionIdentityProof: vi.fn(async () => ({})),
  recordTruleafSessionNetwork: vi.fn(),
}));
vi.mock('@/queries/sql', () => ({
  createSession: vi.fn(),
  saveEvent: vi.fn(),
  saveSessionData: vi.fn(),
}));

const websiteId = '11111111-1111-4111-8111-111111111111';
const distinctId = '507f1f77bcf86cd799439011';
const proof = 'header.payload.signature';
const parseRequestMock = vi.mocked(parseRequest);
const recordIdentityMock = vi.mocked(recordTruleafSessionIdentityProof);
const scheduleIdentityMock = vi.mocked(scheduleTruleafIdentityProofStorage);
const saveEventMock = vi.mocked(saveEvent);
const saveSessionDataMock = vi.mocked(saveSessionData);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PRODUCT_COCKPIT_CONFIG;
  parseRequestMock.mockResolvedValue({
    body: {
      type: 'identify',
      payload: {
        website: websiteId,
        id: distinctId,
        data: {
          role: 'user',
          plan: 'free',
          [TRULEAF_IDENTITY_PROOF_KEY]: proof,
        },
      },
    },
  } as any);
});

test('isolates the reserved proof before generic identify persistence', async () => {
  const response = await POST(new Request('http://localhost/api/send', { method: 'POST' }));

  expect(response.status).toBe(200);
  expect(createSession).toHaveBeenCalledOnce();
  expect(saveEvent).not.toHaveBeenCalled();
  expect(saveSessionDataMock).toHaveBeenCalledWith(
    expect.objectContaining({
      websiteId,
      sessionId: 'session-id',
      distinctId,
      sessionData: { role: 'user', plan: 'free' },
    }),
  );
  expect(JSON.stringify(saveSessionDataMock.mock.calls)).not.toContain(proof);
  expect(scheduleIdentityMock).toHaveBeenCalledOnce();
  expect(recordIdentityMock).toHaveBeenCalledWith(websiteId, 'session-id', distinctId, proof);
  expect(recordTruleafSessionNetwork).not.toHaveBeenCalled();
});

test('discards the reserved proof when moderation storage is disabled', async () => {
  const { isTruleafModerationEnabled } = await import('@/lib/truleaf/config');
  vi.mocked(isTruleafModerationEnabled).mockReturnValueOnce(false);

  const response = await POST(new Request('http://localhost/api/send', { method: 'POST' }));

  expect(response.status).toBe(200);
  expect(saveSessionDataMock).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionData: { role: 'user', plan: 'free' },
    }),
  );
  expect(scheduleIdentityMock).not.toHaveBeenCalled();
  expect(recordIdentityMock).not.toHaveBeenCalled();
  expect(JSON.stringify(saveSessionDataMock.mock.calls)).not.toContain(proof);
});

test('rejects the trusted namespace even without cockpit configuration', async () => {
  parseRequestMock.mockResolvedValueOnce({
    body: {
      type: 'event',
      payload: {
        website: websiteId,
        hostname: 'truleaf.org',
        url: '/pricing',
        name: 'server.subscription-verified',
        data: { revenue: 999999 },
      },
    },
  } as any);

  const response = await POST(new Request('http://localhost/api/send', { method: 'POST' }));

  expect(response.status).toBe(403);
  expect(saveEventMock).not.toHaveBeenCalled();
});

test('strips the reserved proof from custom-event data without treating it as identity', async () => {
  parseRequestMock.mockResolvedValue({
    body: {
      type: 'event',
      payload: {
        website: websiteId,
        id: distinctId,
        hostname: 'truleaf.org',
        url: '/insights',
        name: 'content-view',
        data: {
          article: 'soil-health',
          [TRULEAF_IDENTITY_PROOF_KEY]: proof,
        },
      },
    },
  } as any);

  const response = await POST(new Request('http://localhost/api/send', { method: 'POST' }));

  expect(response.status).toBe(200);
  expect(saveEventMock).toHaveBeenCalledWith(
    expect.objectContaining({
      eventName: 'content-view',
      eventData: { article: 'soil-health' },
    }),
  );
  expect(JSON.stringify(saveEventMock.mock.calls)).not.toContain(proof);
  expect(scheduleIdentityMock).not.toHaveBeenCalled();
  expect(recordIdentityMock).not.toHaveBeenCalled();
});
