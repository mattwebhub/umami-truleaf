import { z } from 'zod';
import { EVENT_TYPE } from '@/lib/constants';
import { uuid } from '@/lib/crypto';
import { fetchWebsite } from '@/lib/load';
import prisma from '@/lib/prisma';
import { getProductCockpitConfig } from '@/lib/product-cockpit/config';
import { badRequest, forbidden, json, serverError, unauthorized } from '@/lib/response';
import {
  createServerEventSignature,
  getServerEventKey,
  isServerEventName,
  verifyServerEventSignature,
} from '@/lib/server-events';
import { createSession, saveEvent } from '@/queries/sql';

const MAX_BODY_BYTES = 16 * 1024;
const CLOCK_SKEW_SECONDS = 300;
const SENSITIVE_STRING =
  /(?:https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|bearer\s+|eyJ[a-zA-Z0-9_-]{10,}|password|token|secret)/i;

const safeServerString = z
  .string()
  .max(120)
  .refine(value => !SENSITIVE_STRING.test(value), 'Sensitive or high-cardinality string rejected');

const serverEventSchema = z.object({
  websiteId: z.uuid(),
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9][a-z0-9._-]*$/),
  distinctId: z.string().min(1).max(50),
  occurredAt: z.iso.datetime().optional(),
  urlPath: z.string().startsWith('/').max(500).default('/server'),
  data: z
    .record(
      z.string().min(1).max(50),
      z.union([safeServerString, z.number().finite(), z.boolean()]),
    )
    .refine(value => Object.keys(value).length <= 20)
    .optional(),
});

function isUniqueConstraint(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
      return badRequest({ message: 'Payload is too large' });
    }

    const keyId = request.headers.get('x-umami-key-id') ?? '';
    const timestamp = request.headers.get('x-umami-timestamp') ?? '';
    const idempotencyKey = request.headers.get('x-umami-idempotency-key') ?? '';
    const signature = request.headers.get('x-umami-signature') ?? '';
    const key = getServerEventKey(keyId);

    if (!key) return unauthorized();
    if (!/^[a-zA-Z0-9:._-]{1,160}$/.test(idempotencyKey)) return badRequest();

    const timestampSeconds = Number(timestamp);
    if (
      !Number.isInteger(timestampSeconds) ||
      Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > CLOCK_SKEW_SECONDS
    ) {
      return unauthorized({ message: 'Request timestamp is outside the accepted window' });
    }

    const expected = createServerEventSignature({
      secret: key.secret,
      timestamp,
      idempotencyKey,
      rawBody,
    });
    if (!verifyServerEventSignature(expected, signature)) return unauthorized();

    const parsed = serverEventSchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) return badRequest();

    const { websiteId, name, distinctId, occurredAt, urlPath, data } = parsed.data;
    if (!key.websiteIds.includes(websiteId)) return forbidden();
    if (!(await fetchWebsite(websiteId))) return badRequest({ message: 'Website not found' });
    if (!isServerEventName(name)) {
      return forbidden({ message: 'Trusted event names must use the reserved server namespace' });
    }
    if (!getProductCockpitConfig(websiteId)?.authoritativeEvents.includes(name)) {
      return forbidden({ message: 'Event is not configured as a server-authoritative fact' });
    }

    const createdAt = occurredAt ? new Date(occurredAt) : new Date();
    const sessionId = uuid(websiteId, distinctId);
    const eventId = uuid('server-event', websiteId, keyId, idempotencyKey);
    const visitId = uuid(sessionId, 'server-event', idempotencyKey);
    let duplicate = false;

    try {
      await prisma.client.serverEventFact.create({
        data: {
          id: eventId,
          websiteId,
          keyId,
          idempotencyKey,
          eventName: name,
          distinctId,
          urlPath,
          data,
          occurredAt: createdAt,
        },
      });
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      duplicate = true;
      const existing = await prisma.client.serverEventFact.findUnique({
        where: { keyId_idempotencyKey: { keyId, idempotencyKey } },
      });
      if (
        !existing ||
        existing.websiteId !== websiteId ||
        existing.eventName !== name ||
        existing.distinctId !== distinctId
      ) {
        return badRequest({ message: 'Idempotency key was already used for another fact' });
      }
      if (existing.projectedAt) return json({ ok: true, duplicate: true, projected: true });
    }

    await createSession({
      id: sessionId,
      websiteId,
      browser: 'server',
      os: 'server',
      device: 'server',
      distinctId,
      createdAt,
    });

    try {
      await saveEvent({
        eventId,
        websiteId,
        sessionId,
        visitId,
        eventType: EVENT_TYPE.customEvent,
        eventName: name,
        hostname: 'server',
        urlPath,
        distinctId,
        browser: 'server',
        os: 'server',
        device: 'server',
        createdAt,
      });
    } catch (error) {
      if (!isUniqueConstraint(error)) {
        return Response.json({ ok: true, duplicate, projected: false }, { status: 202 });
      }
    }

    await prisma.client.serverEventFact.update({
      where: { id: eventId },
      data: { projectedAt: new Date() },
    });

    return json({ ok: true, duplicate, projected: true });
  } catch (error) {
    if (error instanceof SyntaxError) return badRequest();
    return serverError(error);
  }
}
