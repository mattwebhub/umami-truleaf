import { beforeEach, expect, test, vi } from 'vitest';
import { parseRequest } from '@/lib/request';
import { requestTruleafModeration } from '@/lib/truleaf/service';
import { canUpdateWebsite } from '@/permissions';
import {
  deleteTruleafSessionAccountBanReference,
  getTruleafSessionAccountBanReference,
  getTruleafSessionIdentityProof,
  getTruleafSessionNetworks,
  recordTruleafSessionAccountBanReference,
} from '@/queries/prisma';
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
  deleteTruleafSessionAccountBanReference: vi.fn(),
  getTruleafSessionAccountBanReference: vi.fn(),
  getTruleafSessionIdentityProof: vi.fn(),
  getTruleafSessionNetworks: vi.fn(),
  recordTruleafSessionAccountBanReference: vi.fn(),
}));

vi.mock('@/queries/sql', () => ({
  getWebsiteSession: vi.fn(),
}));

const parseRequestMock = vi.mocked(parseRequest);
const requestServiceMock = vi.mocked(requestTruleafModeration);
const canUpdateWebsiteMock = vi.mocked(canUpdateWebsite);
const deleteAccountBanReferenceMock = vi.mocked(deleteTruleafSessionAccountBanReference);
const getAccountBanReferenceMock = vi.mocked(getTruleafSessionAccountBanReference);
const getIdentityProofMock = vi.mocked(getTruleafSessionIdentityProof);
const getNetworksMock = vi.mocked(getTruleafSessionNetworks);
const getWebsiteSessionMock = vi.mocked(getWebsiteSession);
const recordAccountBanReferenceMock = vi.mocked(recordTruleafSessionAccountBanReference);
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
  getAccountBanReferenceMock.mockResolvedValue(undefined);
  deleteAccountBanReferenceMock.mockResolvedValue({ count: 0 } as any);
  recordAccountBanReferenceMock.mockResolvedValue({ id: 'reference-1' } as any);
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
        banId: 'must-not-reach-browser',
        displayValue: '192.0.x.x',
        banned: false,
        canUnban: false,
        sourceMatches: false,
      },
      {
        type: 'ip',
        targetId: 'opaque-shared-network',
        displayValue: '198.51.x.x',
        banned: true,
        canUnban: false,
        sourceMatches: false,
        vercel: 'applied',
      },
    ],
  });

  const response = await GET(new Request('http://localhost/moderation'), context);
  const body = await response.json();

  expect(body.account).toEqual({
    displayValue: 'user…1234',
    banned: false,
    canBan: true,
    canUnban: false,
  });
  expect(body.networks[0]).toMatchObject({
    maskedAddress: '192.0.x.x',
    banned: false,
    canBan: true,
    canUnban: false,
    sourceMatches: false,
  });
  expect(body.networks[1]).toMatchObject({
    maskedAddress: '198.51.x.x',
    banned: true,
    canBan: false,
    canUnban: false,
    sourceMatches: false,
    vercel: 'applied',
  });
  expect(body.status).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain('candidate-user');
  expect(JSON.stringify(body)).not.toContain('signed-proof');
  expect(JSON.stringify(body)).not.toContain('192.0.2.10');
  expect(JSON.stringify(body)).not.toContain('opaque-network');
  expect(JSON.stringify(body)).not.toContain('must-not-reach-browser');
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
        canUnban: false,
        sourceMatches: false,
      },
    ],
  });

  const response = await GET(new Request('http://localhost/moderation'), context);
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.account).toEqual({
    displayValue: 'Unverified account candidate',
    banned: false,
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

test('GET exposes account unban only for an active ban with a source-bound ban ID', async () => {
  parseRequestMock.mockResolvedValue({ auth: { user: { id: 'operator-1' } } });
  requestServiceMock.mockResolvedValue({
    targets: [
      {
        type: 'account',
        targetId: 'must-not-reach-browser',
        displayValue: 'user…1234',
        banned: false,
        canBan: true,
        canUnban: true,
      },
    ],
  });

  const inactiveResponse = await GET(new Request('http://localhost/moderation'), context);
  const inactiveBody = await inactiveResponse.json();

  expect(inactiveBody.account.canUnban).toBe(false);
  expect(recordAccountBanReferenceMock).not.toHaveBeenCalled();

  requestServiceMock.mockResolvedValueOnce({
    targets: [
      {
        type: 'account',
        targetId: 'must-not-reach-browser',
        banId: 'source-bound-account-ban',
        displayValue: 'user…1234',
        banned: true,
        canBan: false,
        canUnban: true,
        expiresAt: '2027-01-01T00:00:00.000Z',
      },
    ],
  });

  const activeResponse = await GET(new Request('http://localhost/moderation'), context);
  const activeBody = await activeResponse.json();

  expect(activeBody.account).toMatchObject({
    banned: true,
    canBan: false,
    canUnban: true,
  });
  expect(recordAccountBanReferenceMock).toHaveBeenCalledWith(
    'website-1',
    'session-1',
    'candidate-user',
    'source-bound-account-ban',
    new Date('2027-01-01T00:00:00.000Z'),
  );
  expect(JSON.stringify(activeBody)).not.toContain('source-bound-account-ban');
  expect(JSON.stringify(activeBody)).not.toContain('must-not-reach-browser');
});

test('GET runs bounded status chunks concurrently and preserves target ordering', async () => {
  parseRequestMock.mockResolvedValue({ auth: { user: { id: 'operator-1' } } });
  getNetworksMock.mockResolvedValue(
    Array.from({ length: 11 }, (_, index) => createNetwork(index + 1)),
  );
  const pending: Array<{
    body: any;
    resolve: (value: any) => void;
  }> = [];
  requestServiceMock.mockImplementation(
    ({ body }: any) =>
      new Promise(resolve => {
        pending.push({ body, resolve });
      }),
  );

  const responsePromise = GET(new Request('http://localhost/moderation'), context);

  await vi.waitFor(() => expect(requestServiceMock).toHaveBeenCalledTimes(2));
  expect(pending).toHaveLength(2);

  const createStatus = ({ body }: (typeof pending)[number], banned: boolean) => ({
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
            banned,
            canUnban: false,
            sourceMatches: false,
          },
    ),
  });

  // Resolve out of order to prove Promise completion order cannot remap targets.
  pending[1].resolve(createStatus(pending[1], true));
  pending[0].resolve(createStatus(pending[0], false));

  const response = await responsePromise;
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.networks).toHaveLength(11);
  expect(body.status).toBeUndefined();
  expect(body.networks.slice(0, 9).every((network: any) => network.banned === false)).toBe(true);
  expect(body.networks.slice(9).every((network: any) => network.banned === true)).toBe(true);
  expect(requestServiceMock).toHaveBeenCalledTimes(2);
  expect(
    requestServiceMock.mock.calls.every(
      ([request]) => (request.body as { targets: unknown[] }).targets.length <= 10,
    ),
  ).toBe(true);
});

test('POST resolves only explicitly selected opaque network IDs after checking current status', async () => {
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
  requestServiceMock
    .mockResolvedValueOnce({
      targets: [
        {
          type: 'ip',
          displayValue: '198.51.x.x',
          banned: false,
          canUnban: false,
          sourceMatches: false,
        },
      ],
    })
    .mockResolvedValueOnce({
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
  expect(requestServiceMock).toHaveBeenCalledTimes(2);
  expect(requestServiceMock.mock.calls[1][0].body).toMatchObject({
    targets: [{ type: 'ip', value: '198.51.100.20' }],
  });
  expect(JSON.stringify(requestServiceMock.mock.calls[1][0].body)).not.toContain('192.0.2.10');
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

test('POST persists a successful account ban reference without exposing internal identifiers', async () => {
  parseRequestMock.mockResolvedValue({
    auth: { user: { id: 'operator-1' } },
    body: {
      requestId: '33333333-3333-4333-8333-333333333333',
      action: 'ban',
      targetTypes: ['account'],
      networkIds: [],
      reason: 'Policy decision',
      expiresAt: '2027-01-01T00:00:00.000Z',
    },
  });
  requestServiceMock
    .mockResolvedValueOnce({
      targets: [
        {
          type: 'account',
          targetId: 'candidate-user',
          displayValue: 'user…1234',
          banned: false,
          canBan: true,
          canUnban: true,
        },
      ],
    })
    .mockResolvedValueOnce({
      operationId: 'source-bound-account-ban',
      requestId: '33333333-3333-4333-8333-333333333333',
      status: 'applied',
      targets: [
        {
          type: 'account',
          targetId: 'candidate-user',
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
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(recordAccountBanReferenceMock).toHaveBeenCalledWith(
    'website-1',
    'session-1',
    'candidate-user',
    'source-bound-account-ban',
    new Date('2027-01-01T00:00:00.000Z'),
  );
  expect(body).toMatchObject({
    requestId: '33333333-3333-4333-8333-333333333333',
    status: 'applied',
  });
  expect(body.operationId).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain('source-bound-account-ban');
  expect(JSON.stringify(body)).not.toContain('candidate-user');
});

test('POST never uses a persisted unban reference to authorize a new account ban', async () => {
  getIdentityProofMock.mockResolvedValue(undefined);
  getAccountBanReferenceMock.mockResolvedValue('existing-account-ban');
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

  const response = await POST(
    new Request('http://localhost/moderation', { method: 'POST', body: '{}' }),
    context,
  );

  expect(response.status).toBe(400);
  expect(requestServiceMock).not.toHaveBeenCalled();
  expect(recordAccountBanReferenceMock).not.toHaveBeenCalled();
});

test('POST allows account unban after proof expiry using the persisted source-bound reference', async () => {
  getIdentityProofMock.mockResolvedValue(undefined);
  getAccountBanReferenceMock.mockResolvedValue('ban-account-1');
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
  expect(requestServiceMock.mock.calls[0][0].body).toMatchObject({
    targets: [{ type: 'account', value: 'candidate-user', banId: 'ban-account-1' }],
  });
  expect(JSON.stringify(requestServiceMock.mock.calls[0][0].body)).not.toContain('proof');
  expect(requestServiceMock.mock.calls[1][0].body).toMatchObject({ action: 'unban' });
  expect(requestServiceMock.mock.calls[1][0].body).toMatchObject({
    targets: [{ type: 'account', value: 'candidate-user', banId: 'ban-account-1' }],
  });
  expect(JSON.stringify(requestServiceMock.mock.calls[1][0].body)).not.toContain('signed-proof');
  expect(deleteAccountBanReferenceMock).toHaveBeenCalledWith('website-1', 'session-1');
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

test('POST unbans an IP only with the server-side source-matched opaque ban ID', async () => {
  parseRequestMock.mockResolvedValue({
    auth: { user: { id: 'operator-1' } },
    body: {
      requestId: '33333333-3333-4333-8333-333333333333',
      action: 'unban',
      targetTypes: ['ip'],
      networkIds: ['11111111-1111-4111-8111-111111111111'],
    },
  });
  requestServiceMock
    .mockResolvedValueOnce({
      targets: [
        {
          type: 'ip',
          targetId: 'opaque-network',
          banId: 'source-bound-ban-id',
          displayValue: '192.0.x.x',
          banned: true,
          canUnban: true,
          sourceMatches: true,
          vercel: 'applied',
        },
      ],
    })
    .mockResolvedValueOnce({
      operationId: 'operation-1',
      requestId: '33333333-3333-4333-8333-333333333333',
      status: 'applied',
      targets: [
        {
          type: 'ip',
          displayValue: '192.0.x.x',
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
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(requestServiceMock).toHaveBeenCalledTimes(2);
  expect(requestServiceMock.mock.calls[1][0].body).toMatchObject({
    action: 'unban',
    targets: [
      {
        type: 'ip',
        value: '192.0.2.10',
        banId: 'source-bound-ban-id',
      },
    ],
  });
  expect(JSON.stringify(body)).not.toContain('192.0.2.10');
  expect(JSON.stringify(body)).not.toContain('source-bound-ban-id');
  expect(JSON.stringify(body)).not.toContain('signed-proof');
});

test('POST refuses cross-session unban of an active ban on the same shared IP', async () => {
  parseRequestMock.mockResolvedValue({
    auth: { user: { id: 'operator-1' } },
    body: {
      requestId: '33333333-3333-4333-8333-333333333333',
      action: 'unban',
      targetTypes: ['ip'],
      networkIds: ['11111111-1111-4111-8111-111111111111'],
    },
  });
  requestServiceMock.mockResolvedValue({
    targets: [
      {
        type: 'ip',
        targetId: 'opaque-network',
        displayValue: '192.0.x.x',
        banned: true,
        canUnban: false,
        sourceMatches: false,
        vercel: 'applied',
      },
    ],
  });

  const response = await POST(
    new Request('http://localhost/moderation', { method: 'POST', body: '{}' }),
    context,
  );
  const body = await response.json();

  expect(response.status).toBe(401);
  expect(body.error.message).toContain('did not originate from this Umami session');
  expect(requestServiceMock).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(body)).not.toContain('192.0.2.10');
  expect(JSON.stringify(body)).not.toContain('signed-proof');
});

test('POST refuses to ban an IP that already has an active ban', async () => {
  parseRequestMock.mockResolvedValue({
    auth: { user: { id: 'operator-1' } },
    body: {
      requestId: '33333333-3333-4333-8333-333333333333',
      action: 'ban',
      targetTypes: ['ip'],
      networkIds: ['11111111-1111-4111-8111-111111111111'],
      reason: 'Policy decision',
    },
  });
  requestServiceMock.mockResolvedValue({
    targets: [
      {
        type: 'ip',
        targetId: 'opaque-network',
        displayValue: '192.0.x.x',
        banned: true,
        canUnban: false,
        sourceMatches: false,
        vercel: 'applied',
      },
    ],
  });

  const response = await POST(
    new Request('http://localhost/moderation', { method: 'POST', body: '{}' }),
    context,
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: {
      message: 'An active ban already exists for a selected network',
    },
  });
  expect(requestServiceMock).toHaveBeenCalledTimes(1);
});
