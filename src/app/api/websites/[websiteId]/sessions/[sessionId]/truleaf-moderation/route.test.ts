import { beforeEach, expect, test, vi } from 'vitest';
import { parseRequest } from '@/lib/request';
import { requestTruleafModeration } from '@/lib/truleaf/service';
import { canUpdateWebsite } from '@/permissions';
import { getTruleafSessionIdentityProof, getTruleafSessionNetworks } from '@/queries/prisma';
import { getWebsiteSession } from '@/queries/sql';
import { GET, POST } from './route';

vi.mock('@/lib/request', () => ({
  parseRequest: vi.fn(),
}));

vi.mock('@/lib/truleaf/config', () => ({
  isTruleafModerationEnabled: () => true,
  isTruleafModerationOperator: vi.fn(() => true),
  isTruleafWebsite: () => true,
}));

vi.mock('@/lib/truleaf/service', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/truleaf/service')>()),
  requestTruleafModeration: vi.fn(),
}));

vi.mock('@/permissions', () => ({
  canUpdateWebsite: vi.fn(),
}));

vi.mock('@/queries/prisma', () => ({
  getTruleafSessionIdentityProof: vi.fn(),
  getTruleafSessionNetworks: vi.fn(),
}));

vi.mock('@/queries/sql', () => ({
  getWebsiteSession: vi.fn(),
}));

const parseRequestMock = vi.mocked(parseRequest);
const requestServiceMock = vi.mocked(requestTruleafModeration);
const canUpdateWebsiteMock = vi.mocked(canUpdateWebsite);
const getIdentityProofMock = vi.mocked(getTruleafSessionIdentityProof);
const getNetworksMock = vi.mocked(getTruleafSessionNetworks);
const getWebsiteSessionMock = vi.mocked(getWebsiteSession);
const context = {
  params: Promise.resolve({ websiteId: 'website-1', sessionId: 'session-1' }),
};

function createNetwork(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    address: `198.51.100.${index}`,
    maskedAddress: '198.51.x.x',
    addressFamily: 4,
    firstSeenAt: new Date('2026-07-23T10:00:00Z'),
    lastSeenAt: new Date('2026-07-24T10:00:00Z'),
    expiresAt: new Date('2026-08-23T10:00:00Z'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  canUpdateWebsiteMock.mockResolvedValue(true);
  getWebsiteSessionMock.mockResolvedValue({ distinctId: 'candidate-user' } as any);
  getIdentityProofMock.mockResolvedValue('signed-proof');
  getNetworksMock.mockResolvedValue([
    {
      id: '11111111-1111-4111-8111-111111111111',
      address: '192.0.2.10',
      maskedAddress: '192.0.x.x',
      addressFamily: 4,
      firstSeenAt: new Date('2026-07-24T10:00:00Z'),
      lastSeenAt: new Date('2026-07-25T10:00:00Z'),
      expiresAt: new Date('2026-08-24T10:00:00Z'),
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      address: '198.51.100.20',
      maskedAddress: '198.51.x.x',
      addressFamily: 4,
      firstSeenAt: new Date('2026-07-23T10:00:00Z'),
      lastSeenAt: new Date('2026-07-24T10:00:00Z'),
      expiresAt: new Date('2026-08-23T10:00:00Z'),
    },
  ]);
});

test('GET rejects a share-token-only viewer', async () => {
  parseRequestMock.mockResolvedValue({
    auth: { shareToken: { websiteId: 'website-1' } },
  });

  const response = await GET(new Request('http://localhost/moderation'), context);

  expect(response.status).toBe(401);
  expect(canUpdateWebsiteMock).not.toHaveBeenCalled();
  expect(requestServiceMock).not.toHaveBeenCalled();
});

test('GET rejects an authenticated read-only website member', async () => {
  parseRequestMock.mockResolvedValue({ auth: { user: { id: 'viewer-1' } } });
  canUpdateWebsiteMock.mockResolvedValue(false);

  const response = await GET(new Request('http://localhost/moderation'), context);

  expect(response.status).toBe(401);
  expect(requestServiceMock).not.toHaveBeenCalled();
});

test('GET rejects a website editor outside the moderation operator allowlist', async () => {
  const { isTruleafModerationOperator } = await import('@/lib/truleaf/config');
  vi.mocked(isTruleafModerationOperator).mockReturnValueOnce(false);
  parseRequestMock.mockResolvedValue({ auth: { user: { id: 'editor-1' } } });

  const response = await GET(new Request('http://localhost/moderation'), context);

  expect(response.status).toBe(401);
  expect(canUpdateWebsiteMock).not.toHaveBeenCalled();
  expect(requestServiceMock).not.toHaveBeenCalled();
});

test('GET exposes only masked targets and a Truleaf-verified account label', async () => {
  parseRequestMock.mockResolvedValue({ auth: { user: { id: 'operator-1' } } });
  requestServiceMock.mockResolvedValue({
    targets: [
      {
        type: 'account',
        targetId: 'opaque-account',
        displayValue: 'user…1234',
        banned: false,
        canBan: true,
        canUnban: false,
      },
      {
        type: 'ip',
        targetId: 'opaque-network',
        displayValue: '192.0.x.x',
        banned: false,
      },
    ],
  });

  const response = await GET(new Request('http://localhost/moderation'), context);
  const body = await response.json();

  expect(body.account).toEqual({
    displayValue: 'user…1234',
    canBan: true,
    canUnban: false,
  });
  expect(body.networks[0].maskedAddress).toBe('192.0.x.x');
  expect(JSON.stringify(body)).not.toContain('candidate-user');
  expect(JSON.stringify(body)).not.toContain('signed-proof');
  expect(JSON.stringify(body)).not.toContain('192.0.2.10');
  expect(getIdentityProofMock).toHaveBeenCalledWith('website-1', 'session-1');
});

test('GET keeps anonymous IP moderation available for a forged distinctId without proof', async () => {
  parseRequestMock.mockResolvedValue({ auth: { user: { id: 'operator-1' } } });
  getIdentityProofMock.mockResolvedValue(undefined);
  requestServiceMock.mockResolvedValue({
    targets: [
      {
        type: 'ip',
        targetId: 'opaque-network',
        displayValue: '192.0.x.x',
        banned: false,
      },
    ],
  });

  const response = await GET(new Request('http://localhost/moderation'), context);
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.account).toEqual({
    displayValue: 'Unverified account candidate',
    canBan: false,
    canUnban: false,
  });
  expect(body.networks).toHaveLength(2);
  expect(requestServiceMock.mock.calls[0][0].body).toMatchObject({
    targets: [
      { type: 'ip', value: '192.0.2.10' },
      { type: 'ip', value: '198.51.100.20' },
    ],
  });
});

test('GET chunks more than ten retained targets and combines their status', async () => {
  parseRequestMock.mockResolvedValue({ auth: { user: { id: 'operator-1' } } });
  getNetworksMock.mockResolvedValue(
    Array.from({ length: 11 }, (_, index) => createNetwork(index + 1)),
  );
  requestServiceMock.mockImplementation(async ({ body }: any) => ({
    targets: body.targets.map((target: any) =>
      target.type === 'account'
        ? {
            type: 'account',
            targetId: 'opaque-account',
            displayValue: 'user…1234',
            banned: false,
            canBan: true,
            canUnban: false,
          }
        : {
            type: 'ip',
            targetId: `opaque-${target.value}`,
            displayValue: '198.51.x.x',
            banned: false,
          },
    ),
  }));

  const response = await GET(new Request('http://localhost/moderation'), context);
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.networks).toHaveLength(11);
  expect(body.status.targets).toHaveLength(12);
  expect(requestServiceMock).toHaveBeenCalledTimes(2);
  expect(
    requestServiceMock.mock.calls.every(
      ([request]) => (request.body as { targets: unknown[] }).targets.length <= 10,
    ),
  ).toBe(true);
});

test('POST resolves only explicitly selected opaque network IDs', async () => {
  parseRequestMock.mockResolvedValue({
    auth: { user: { id: 'operator-1' } },
    body: {
      requestId: '33333333-3333-4333-8333-333333333333',
      action: 'ban',
      targetTypes: ['ip'],
      networkIds: ['22222222-2222-4222-8222-222222222222'],
      reason: 'Policy decision',
    },
  });
  requestServiceMock.mockResolvedValue({
    operationId: 'operation-1',
    requestId: '33333333-3333-4333-8333-333333333333',
    status: 'applied',
    targets: [
      {
        type: 'ip',
        displayValue: '198.51.x.x',
        status: 'applied',
        api: 'applied',
        vercel: 'applied',
      },
    ],
  });

  const response = await POST(
    new Request('http://localhost/moderation', { method: 'POST', body: '{}' }),
    context,
  );

  expect(response.status).toBe(200);
  expect(requestServiceMock).toHaveBeenCalledTimes(1);
  expect(requestServiceMock.mock.calls[0][0].body).toMatchObject({
    targets: [{ type: 'ip', value: '198.51.100.20' }],
  });
  expect(JSON.stringify(requestServiceMock.mock.calls[0][0].body)).not.toContain('192.0.2.10');
});

test('POST accepts one account plus nine explicitly selected networks', async () => {
  const networks = Array.from({ length: 9 }, (_, index) => createNetwork(index + 1));
  getNetworksMock.mockResolvedValue(networks);
  parseRequestMock.mockResolvedValue({
    auth: { user: { id: 'operator-1' } },
    body: {
      requestId: '33333333-3333-4333-8333-333333333333',
      action: 'ban',
      targetTypes: ['account', 'ip'],
      networkIds: networks.map(({ id }) => id),
      reason: 'Policy decision',
    },
  });
  requestServiceMock
    .mockResolvedValueOnce({
      targets: [
        {
          type: 'account',
          targetId: 'opaque-account',
          displayValue: 'user…1234',
          banned: false,
          canBan: true,
          canUnban: false,
        },
        ...networks.map((_, index) => ({
          type: 'ip' as const,
          targetId: `opaque-${index}`,
          displayValue: '198.51.x.x',
          banned: false,
        })),
      ],
    })
    .mockResolvedValueOnce({
      operationId: 'operation-1',
      requestId: '33333333-3333-4333-8333-333333333333',
      status: 'applied',
      targets: [],
    });

  const response = await POST(
    new Request('http://localhost/moderation', { method: 'POST', body: '{}' }),
    context,
  );

  expect(response.status).toBe(200);
  expect(requestServiceMock).toHaveBeenCalledTimes(2);
  expect((requestServiceMock.mock.calls[1][0].body as { targets: unknown[] }).targets).toHaveLength(
    10,
  );
});

test('POST rejects one account plus ten networks before calling Truleaf', async () => {
  const networks = Array.from({ length: 10 }, (_, index) => createNetwork(index + 1));
  getNetworksMock.mockResolvedValue(networks);
  parseRequestMock.mockResolvedValue({
    auth: { user: { id: 'operator-1' } },
    body: {
      requestId: '33333333-3333-4333-8333-333333333333',
      action: 'ban',
      targetTypes: ['account', 'ip'],
      networkIds: networks.map(({ id }) => id),
      reason: 'Policy decision',
    },
  });

  const response = await POST(
    new Request('http://localhost/moderation', { method: 'POST', body: '{}' }),
    context,
  );

  expect(response.status).toBe(400);
  expect(requestServiceMock).not.toHaveBeenCalled();
});

test('POST rejects stale or forged network record IDs without calling Truleaf', async () => {
  parseRequestMock.mockResolvedValue({
    auth: { user: { id: 'operator-1' } },
    body: {
      requestId: '33333333-3333-4333-8333-333333333333',
      action: 'ban',
      targetTypes: ['ip'],
      networkIds: ['99999999-9999-4999-8999-999999999999'],
      reason: 'Policy decision',
    },
  });

  const response = await POST(
    new Request('http://localhost/moderation', { method: 'POST', body: '{}' }),
    context,
  );

  expect(response.status).toBe(400);
  expect(requestServiceMock).not.toHaveBeenCalled();
});

test('POST refuses an account action when Truleaf does not verify its proof', async () => {
  parseRequestMock.mockResolvedValue({
    auth: { user: { id: 'operator-1' } },
    body: {
      requestId: '33333333-3333-4333-8333-333333333333',
      action: 'ban',
      targetTypes: ['account'],
      networkIds: [],
      reason: 'Policy decision',
    },
  });
  requestServiceMock.mockResolvedValue({
    targets: [
      {
        type: 'account',
        displayValue: 'user…1234',
        banned: false,
        canBan: false,
        canUnban: false,
      },
    ],
  });

  const response = await POST(
    new Request('http://localhost/moderation', { method: 'POST', body: '{}' }),
    context,
  );

  expect(response.status).toBe(401);
  expect(requestServiceMock).toHaveBeenCalledTimes(1);
});

test('POST allows unban when an expired proof is unban-authorized but not ban-authorized', async () => {
  parseRequestMock.mockResolvedValue({
    auth: { user: { id: 'operator-1' } },
    body: {
      requestId: '33333333-3333-4333-8333-333333333333',
      action: 'unban',
      targetTypes: ['account'],
      networkIds: [],
    },
  });
  requestServiceMock
    .mockResolvedValueOnce({
      targets: [
        {
          type: 'account',
          targetId: 'opaque-account',
          banId: 'ban-account-1',
          displayValue: 'user…1234',
          banned: true,
          canBan: false,
          canUnban: true,
        },
      ],
    })
    .mockResolvedValueOnce({
      operationId: 'operation-1',
      requestId: '33333333-3333-4333-8333-333333333333',
      status: 'applied',
      targets: [
        {
          type: 'account',
          displayValue: 'user…1234',
          status: 'applied',
          api: 'applied',
          vercel: 'not_applicable',
        },
      ],
    });

  const response = await POST(
    new Request('http://localhost/moderation', { method: 'POST', body: '{}' }),
    context,
  );

  expect(response.status).toBe(200);
  expect(requestServiceMock).toHaveBeenCalledTimes(2);
  expect(requestServiceMock.mock.calls[1][0].body).toMatchObject({ action: 'unban' });
  expect(requestServiceMock.mock.calls[1][0].body).toMatchObject({
    targets: [{ type: 'account', value: 'candidate-user', banId: 'ban-account-1' }],
  });
  expect(JSON.stringify(requestServiceMock.mock.calls[1][0].body)).not.toContain('signed-proof');
});

test('POST refuses account unban without a source-bound ban ID', async () => {
  parseRequestMock.mockResolvedValue({
    auth: { user: { id: 'operator-1' } },
    body: {
      requestId: '33333333-3333-4333-8333-333333333333',
      action: 'unban',
      targetTypes: ['account'],
      networkIds: [],
    },
  });
  requestServiceMock.mockResolvedValue({
    targets: [
      {
        type: 'account',
        displayValue: 'user…1234',
        banned: true,
        canBan: false,
        canUnban: true,
      },
    ],
  });

  const response = await POST(
    new Request('http://localhost/moderation', { method: 'POST', body: '{}' }),
    context,
  );

  expect(response.status).toBe(401);
  expect(requestServiceMock).toHaveBeenCalledTimes(1);
});
