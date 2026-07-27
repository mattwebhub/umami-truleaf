import { z } from 'zod';
import prisma from '@/lib/prisma';
import { parseRequest } from '@/lib/request';
import { forbidden, json, notFound } from '@/lib/response';
import {
  createServiceApiKey,
  isActiveServiceApiKeyWebsite,
  SERVICE_API_KEY_SCOPES,
  type ServiceApiKeyScope,
  serviceApiKeyScopeSchema,
} from '@/lib/service-api-key';
import { canUpdateWebsite } from '@/permissions';

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(serviceApiKeyScopeSchema).min(1).max(SERVICE_API_KEY_SCOPES.length),
  expiresAt: z.iso.datetime().nullable().optional(),
});

const selectPublicFields = {
  id: true,
  websiteId: true,
  name: true,
  keyPrefix: true,
  scopes: true,
  expiresAt: true,
  revokedAt: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, error } = await parseRequest(request);
  if (error) return error();

  const { websiteId } = await params;
  if (!(await isActiveServiceApiKeyWebsite(websiteId))) return notFound();
  if (!(await canUpdateWebsite(auth, websiteId))) return forbidden();

  const keys = await prisma.client.serviceApiKey.findMany({
    where: { websiteId },
    select: selectPublicFields,
    orderBy: { createdAt: 'desc' },
  });

  return json({ keys, availableScopes: SERVICE_API_KEY_SCOPES });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, body, error } = await parseRequest(request, createSchema);
  if (error) return error();

  const { websiteId } = await params;
  if (!(await isActiveServiceApiKeyWebsite(websiteId))) return notFound();
  if (!(await canUpdateWebsite(auth, websiteId))) return forbidden();

  const scopes = [...new Set(body.scopes as ServiceApiKeyScope[])];
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

  if (expiresAt && expiresAt <= new Date()) {
    return Response.json(
      {
        error: {
          message: 'Expiration must be in the future',
          code: 'invalid-expiration',
          status: 400,
        },
      },
      { status: 400 },
    );
  }

  const { key, token } = await createServiceApiKey({
    websiteId,
    name: body.name,
    scopes,
    createdByUserId: auth.user.id,
    expiresAt,
  });
  return Response.json(
    {
      key: {
        id: key.id,
        websiteId: key.websiteId,
        name: key.name,
        keyPrefix: key.keyPrefix,
        scopes: key.scopes,
        expiresAt: key.expiresAt,
        revokedAt: key.revokedAt,
        lastUsedAt: key.lastUsedAt,
        createdAt: key.createdAt,
        updatedAt: key.updatedAt,
      },
      token,
      warning: 'Copy this token now. It will not be shown again.',
    },
    { status: 201 },
  );
}
