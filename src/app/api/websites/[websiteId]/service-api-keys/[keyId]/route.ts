import { parseRequest } from '@/lib/request';
import { forbidden, notFound } from '@/lib/response';
import { isActiveServiceApiKeyWebsite, revokeServiceApiKey } from '@/lib/service-api-key';
import { canUpdateWebsite } from '@/permissions';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; keyId: string }> },
) {
  const { auth, error } = await parseRequest(request);
  if (error) return error();

  const { websiteId, keyId } = await params;
  if (!(await isActiveServiceApiKeyWebsite(websiteId))) return notFound();
  if (!(await canUpdateWebsite(auth, websiteId))) return forbidden();

  const revoked = await revokeServiceApiKey({
    keyId,
    websiteId,
    requestId: request.headers.get('x-request-id') ?? undefined,
  });
  if (!revoked) return notFound();

  return Response.json({ ok: true });
}
