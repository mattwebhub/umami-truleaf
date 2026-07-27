import { badRequest, json, unauthorized } from '@/lib/response';
import { backfillLegacyServerSessions } from '@/lib/server-events-backfill';
import { hasValidTruleafMaintenanceSecret } from '@/lib/truleaf/maintenance-auth';

export async function POST(request: Request) {
  if (!hasValidTruleafMaintenanceSecret(request)) {
    return unauthorized();
  }

  const applyParameter = new URL(request.url).searchParams.get('apply');
  if (applyParameter !== null && applyParameter !== 'true' && applyParameter !== 'false') {
    return badRequest({ message: 'apply must be true or false' });
  }

  const apply = applyParameter === 'true';
  const result = await backfillLegacyServerSessions({ apply });

  return json({
    mode: apply ? 'apply' : 'dry-run',
    ...result,
  });
}
