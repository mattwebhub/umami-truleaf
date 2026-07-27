import { beforeEach, expect, test, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { backfillLegacyServerSessions } from './server-events-backfill';

vi.mock('@/lib/crypto', () => ({
  uuid: (...parts: string[]) => (parts.length ? `uuid:${parts.join(':')}` : 'new-link-id'),
}));
vi.mock('@/lib/prisma', () => {
  const client = {
    serverEventFact: {
      findMany: vi.fn(),
    },
    websiteEvent: {
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    session: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    verifiedIdentityProfile: {
      findUnique: vi.fn(),
    },
    verifiedSessionIdentity: {
      upsert: vi.fn(),
    },
  };

  return {
    default: {
      client,
      transaction: vi.fn(async callback => callback(client)),
    },
  };
});

const websiteId = '11111111-1111-4111-8111-111111111111';
const distinctId = 'account-1';
const occurredAt = new Date('2026-07-20T10:00:00.000Z');
const now = new Date('2026-07-27T18:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CLICKHOUSE_URL;
  vi.mocked(prisma.client.websiteEvent.count).mockReset();
  vi.mocked(prisma.client.serverEventFact.findMany).mockReset();
  vi.mocked(prisma.client.serverEventFact.findMany).mockResolvedValueOnce([
    {
      websiteId,
      distinctId,
    },
  ] as never);
  vi.mocked(prisma.client.serverEventFact.findMany).mockResolvedValueOnce([
    {
      id: 'event-1',
      occurredAt,
    },
  ] as never);
  vi.mocked(prisma.client.websiteEvent.count).mockResolvedValueOnce(1).mockResolvedValueOnce(2);
  vi.mocked(prisma.client.websiteEvent.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.client.session.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.client.verifiedIdentityProfile.findUnique).mockResolvedValue({
    verifiedUntil: new Date('2026-08-27T18:00:00.000Z'),
  } as never);
});

test('defaults to a non-mutating dry run based on the trusted fact ledger', async () => {
  await expect(backfillLegacyServerSessions({ now })).resolves.toEqual({
    identitiesFound: 1,
    identitiesMigrated: 0,
    eventsFound: 1,
    eventsMoved: 0,
    identityLinksCreated: 0,
    legacySessionsSanitized: 0,
  });

  expect(prisma.transaction).not.toHaveBeenCalled();
  expect(prisma.client.websiteEvent.count).toHaveBeenCalledWith({
    where: {
      id: { in: ['event-1'] },
      websiteId,
      sessionId: `uuid:${websiteId}:${distinctId}`,
    },
  });
});

test('moves legacy facts into a trusted namespace and preserves the browser session', async () => {
  await expect(backfillLegacyServerSessions({ apply: true, now })).resolves.toEqual({
    identitiesFound: 1,
    identitiesMigrated: 1,
    eventsFound: 1,
    eventsMoved: 1,
    identityLinksCreated: 1,
    legacySessionsSanitized: 1,
  });

  const serverSessionId = `uuid:${websiteId}:server:${distinctId}`;
  expect(prisma.client.session.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: serverSessionId },
      create: expect.objectContaining({
        id: serverSessionId,
        browser: 'server',
        os: 'server',
        device: 'server',
      }),
    }),
  );
  expect(prisma.client.websiteEvent.updateMany).toHaveBeenCalledWith({
    where: {
      id: { in: ['event-1'] },
      websiteId,
      sessionId: `uuid:${websiteId}:${distinctId}`,
    },
    data: {
      sessionId: serverSessionId,
    },
  });
  expect(prisma.client.verifiedSessionIdentity.upsert).toHaveBeenCalled();
  expect(prisma.client.session.updateMany).toHaveBeenCalledWith({
    where: {
      id: `uuid:${websiteId}:${distinctId}`,
      websiteId,
      browser: 'server',
      os: 'server',
      device: 'server',
    },
    data: {
      browser: null,
      os: null,
      device: null,
    },
  });
});

test('refuses to mutate ClickHouse-backed event storage', async () => {
  process.env.CLICKHOUSE_URL = 'http://localhost:8123/umami';

  await expect(backfillLegacyServerSessions({ apply: true })).rejects.toThrow(
    'supports PostgreSQL event storage only',
  );
  expect(prisma.client.serverEventFact.findMany).not.toHaveBeenCalled();
});

test('bounds event reads and writes to database-safe statement batches', async () => {
  const facts = Array.from({ length: 251 }, (_, index) => ({
    id: `event-${index}`,
    occurredAt: new Date(occurredAt.getTime() + index),
  }));
  vi.mocked(prisma.client.serverEventFact.findMany).mockReset();
  vi.mocked(prisma.client.serverEventFact.findMany)
    .mockResolvedValueOnce([{ websiteId, distinctId }] as never)
    .mockResolvedValueOnce(facts as never);
  vi.mocked(prisma.client.websiteEvent.count).mockReset();
  vi.mocked(prisma.client.websiteEvent.count)
    .mockResolvedValueOnce(250)
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(0);
  vi.mocked(prisma.client.websiteEvent.updateMany)
    .mockResolvedValueOnce({ count: 250 } as never)
    .mockResolvedValueOnce({ count: 1 } as never);
  vi.mocked(prisma.client.verifiedIdentityProfile.findUnique).mockResolvedValue(null);

  await expect(backfillLegacyServerSessions({ apply: true, now })).resolves.toMatchObject({
    eventsFound: 251,
    eventsMoved: 251,
  });

  const writes = vi.mocked(prisma.client.websiteEvent.updateMany).mock.calls;
  expect(writes).toHaveLength(2);
  expect(writes.every(([{ where }]: any) => where.id.in.length <= 250)).toBe(true);
});
