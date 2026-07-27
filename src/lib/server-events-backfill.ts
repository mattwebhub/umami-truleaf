import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';

export interface LegacyServerSessionBackfillSummary {
  identitiesFound: number;
  identitiesMigrated: number;
  eventsFound: number;
  eventsMoved: number;
  identityLinksCreated: number;
  legacySessionsSanitized: number;
}

interface BackfillOptions {
  apply?: boolean;
  now?: Date;
}

interface ProjectedIdentity {
  websiteId: string;
  distinctId: string;
}

interface ProjectedFact {
  id: string;
  occurredAt: Date;
}

const EVENT_BATCH_SIZE = 250;

function batches<T>(values: T[], size = EVENT_BATCH_SIZE) {
  const result: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }

  return result;
}

function emptySummary(): LegacyServerSessionBackfillSummary {
  return {
    identitiesFound: 0,
    identitiesMigrated: 0,
    eventsFound: 0,
    eventsMoved: 0,
    identityLinksCreated: 0,
    legacySessionsSanitized: 0,
  };
}

/**
 * Separates trusted events written before server sessions received their own
 * namespace. A dry run is the default so operators can inspect the exact
 * number of affected identities and events before mutating production data.
 *
 * This migration deliberately uses the trusted ServerEventFact ledger rather
 * than dimensions such as browser=server, which public tracker clients can
 * forge.
 */
export async function backfillLegacyServerSessions({
  apply = false,
  now = new Date(),
}: BackfillOptions = {}): Promise<LegacyServerSessionBackfillSummary> {
  if (process.env.CLICKHOUSE_URL) {
    throw new Error(
      'Legacy server-session backfill currently supports PostgreSQL event storage only.',
    );
  }

  // The read-replica extension creates a union delegate whose generated
  // groupBy overload is not callable in TypeScript. A distinct relational
  // read is equivalent here and remains bounded to two selected columns.
  const identities = (await prisma.client.serverEventFact.findMany({
    where: { projectedAt: { not: null } },
    distinct: ['websiteId', 'distinctId'],
    select: { websiteId: true, distinctId: true },
  })) as ProjectedIdentity[];
  const summary = emptySummary();
  summary.identitiesFound = identities.length;

  for (const identity of identities) {
    const { websiteId, distinctId } = identity;
    const legacySessionId = uuid(websiteId, distinctId);
    const serverSessionId = uuid(websiteId, 'server', distinctId);
    const facts = (await prisma.client.serverEventFact.findMany({
      where: {
        websiteId,
        distinctId,
        projectedAt: { not: null },
      },
      select: {
        id: true,
        occurredAt: true,
      },
      orderBy: { occurredAt: 'asc' },
    })) as ProjectedFact[];
    const eventIds = facts.map(({ id }) => id);

    if (!eventIds.length) {
      continue;
    }

    let legacyEventCount = 0;
    for (const eventIdBatch of batches(eventIds)) {
      legacyEventCount += await prisma.client.websiteEvent.count({
        where: {
          id: { in: eventIdBatch },
          websiteId,
          sessionId: legacySessionId,
        },
      });
    }
    summary.eventsFound += legacyEventCount;

    if (!apply || !legacyEventCount) {
      continue;
    }

    const result = (await prisma.transaction(
      async client => {
        await client.session.upsert({
          where: { id: serverSessionId },
          create: {
            id: serverSessionId,
            websiteId,
            browser: 'server',
            os: 'server',
            device: 'server',
            distinctId,
            createdAt: facts[0].occurredAt,
          },
          update: {
            browser: 'server',
            os: 'server',
            device: 'server',
            distinctId,
          },
        });

        let eventsMoved = 0;

        for (const eventIdBatch of batches(eventIds)) {
          const moved = await client.websiteEvent.updateMany({
            where: {
              id: { in: eventIdBatch },
              websiteId,
              sessionId: legacySessionId,
            },
            data: {
              sessionId: serverSessionId,
            },
          });
          eventsMoved += moved.count;
        }

        const profile = await client.verifiedIdentityProfile.findUnique({
          where: {
            websiteId_distinctId: {
              websiteId,
              distinctId,
            },
          },
          select: { verifiedUntil: true },
        });
        let identityLinksCreated = 0;

        if (profile?.verifiedUntil > now) {
          await client.verifiedSessionIdentity.upsert({
            where: {
              websiteId_sessionId: {
                websiteId,
                sessionId: serverSessionId,
              },
            },
            create: {
              id: uuid(),
              websiteId,
              sessionId: serverSessionId,
              distinctId,
              verifiedAt: now,
            },
            update: {
              distinctId,
              verifiedAt: now,
            },
          });
          identityLinksCreated = 1;
        }

        const remainingLegacyEvents = await client.websiteEvent.count({
          where: {
            websiteId,
            sessionId: legacySessionId,
          },
        });
        let legacySessionsSanitized = 0;

        // Relational Umami stores browser metadata only on Session. When a
        // server event created the legacy row first, the real browser metadata
        // was never persisted. Null is honest; retaining "server" would keep
        // misrepresenting the remaining browser activity.
        if (eventsMoved && remainingLegacyEvents) {
          const sanitized = await client.session.updateMany({
            where: {
              id: legacySessionId,
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
          legacySessionsSanitized = sanitized.count;
        }

        return {
          eventsMoved,
          identityLinksCreated,
          legacySessionsSanitized,
        };
      },
      { isolationLevel: 'Serializable' },
    )) as unknown as {
      eventsMoved: number;
      identityLinksCreated: number;
      legacySessionsSanitized: number;
    };

    if (result.eventsMoved) {
      summary.identitiesMigrated += 1;
      summary.eventsMoved += result.eventsMoved;
      summary.identityLinksCreated += result.identityLinksCreated;
      summary.legacySessionsSanitized += result.legacySessionsSanitized;
    }
  }

  return summary;
}
