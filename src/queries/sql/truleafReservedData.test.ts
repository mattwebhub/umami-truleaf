import { beforeEach, expect, test, vi } from 'vitest';
import { TRULEAF_IDENTITY_PROOF_KEY } from '@/lib/truleaf/identity-proof';
import { saveEventData } from './events/saveEventData';
import { saveSessionData } from './sessions/saveSessionData';

const mocks = vi.hoisted(() => ({
  eventCreateMany: vi.fn(),
  sessionCreate: vi.fn(),
  sessionUpdateMany: vi.fn(),
}));

vi.mock('@/lib/clickhouse', () => ({
  default: {
    getUTCString: vi.fn(),
    insert: vi.fn(),
  },
}));
vi.mock('@/lib/crypto', () => ({ uuid: () => 'generated-id' }));
vi.mock('@/lib/db', () => ({
  CLICKHOUSE: 'clickhouse',
  PRISMA: 'prisma',
  runQuery: (queries: Record<string, () => Promise<unknown>>) => queries.prisma(),
}));
vi.mock('@/lib/kafka', () => ({
  default: {
    enabled: false,
    sendMessage: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    client: {
      eventData: {
        createMany: mocks.eventCreateMany,
      },
      sessionData: {
        create: mocks.sessionCreate,
        updateMany: mocks.sessionUpdateMany,
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eventCreateMany.mockResolvedValue({ count: 1 });
  mocks.sessionUpdateMany.mockResolvedValue({ count: 0 });
});

test('event-data persistence strips the reserved proof even when called directly', async () => {
  await saveEventData({
    websiteId: 'website-1',
    sessionId: 'session-1',
    eventId: 'event-1',
    eventData: {
      article: 'soil-health',
      [TRULEAF_IDENTITY_PROOF_KEY]: 'header.payload.signature',
    },
  });

  expect(mocks.eventCreateMany).toHaveBeenCalledOnce();
  expect(mocks.eventCreateMany.mock.calls[0][0].data).toHaveLength(1);
  expect(mocks.eventCreateMany.mock.calls[0][0].data[0]).toMatchObject({
    dataKey: 'article',
    stringValue: 'soil-health',
  });
  expect(JSON.stringify(mocks.eventCreateMany.mock.calls)).not.toContain(
    TRULEAF_IDENTITY_PROOF_KEY,
  );
});

test('session-data persistence strips the reserved proof even when called directly', async () => {
  await saveSessionData({
    websiteId: 'website-1',
    sessionId: 'session-1',
    distinctId: 'account-1',
    sessionData: {
      role: 'user',
      [TRULEAF_IDENTITY_PROOF_KEY]: 'header.payload.signature',
    },
  });

  expect(mocks.sessionUpdateMany).toHaveBeenCalledOnce();
  expect(mocks.sessionUpdateMany.mock.calls[0][0].where).toEqual({
    sessionId: 'session-1',
    dataKey: 'role',
  });
  expect(mocks.sessionCreate).toHaveBeenCalledOnce();
  expect(JSON.stringify(mocks.sessionCreate.mock.calls)).not.toContain(TRULEAF_IDENTITY_PROOF_KEY);
});

test('generic persistence performs no write when only the reserved proof is supplied', async () => {
  await saveEventData({
    websiteId: 'website-1',
    eventId: 'event-1',
    eventData: {
      [TRULEAF_IDENTITY_PROOF_KEY]: 'header.payload.signature',
    },
  });
  await saveSessionData({
    websiteId: 'website-1',
    sessionId: 'session-1',
    sessionData: {
      [TRULEAF_IDENTITY_PROOF_KEY]: 'header.payload.signature',
    },
  });

  expect(mocks.eventCreateMany).not.toHaveBeenCalled();
  expect(mocks.sessionUpdateMany).not.toHaveBeenCalled();
  expect(mocks.sessionCreate).not.toHaveBeenCalled();
});
