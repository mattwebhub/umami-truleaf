import { agentApiRateLimitError, serviceApiKeyError } from '@/lib/agent-api/response';
import { AGENT_BREAKDOWN_DIMENSIONS, AGENT_QUERY_SCOPES } from '@/lib/agent-api/schema';
import {
  authenticateServiceApiKey,
  enforceAgentApiIngressLimit,
  recordServiceApiKeyAuditSafely,
} from '@/lib/service-api-key';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { websiteId } = await params;
  if (await enforceAgentApiIngressLimit(request)) return agentApiRateLimitError();

  const auth = await authenticateServiceApiKey(request, websiteId);
  if (!auth.ok) return serviceApiKeyError(auth);
  await recordServiceApiKeyAuditSafely({
    keyId: auth.key.id,
    websiteId,
    action: 'query',
    queryType: 'catalog',
    status: 'success',
    requestId: request.headers.get('x-request-id') ?? undefined,
  });

  const availableKinds = Object.entries(AGENT_QUERY_SCOPES)
    .filter(([, scope]) => auth.key.scopes.includes(scope))
    .map(([kind, scope]) => ({ kind, requiredScope: scope }));

  return Response.json({
    schemaVersion: '1.0',
    websiteId,
    generatedAt: new Date().toISOString(),
    periods: {
      presets: ['day', 'week', 'month'],
      semantics: {
        day: 'Previous complete calendar day',
        week: 'Previous complete Monday-Sunday calendar week',
        month: 'Previous complete calendar month',
        custom: 'Explicit ISO-8601 startAt/endAt, maximum 366 days',
      },
      defaultTimezone: 'UTC',
    },
    queries: availableKinds,
    breakdownDimensions: AGENT_BREAKDOWN_DIMENSIONS,
    bounds: {
      customPeriodDays: 366,
      breakdownRows: 100,
      moderationRows: 50,
    },
    grantedScopes: auth.key.scopes,
    safety: {
      readOnly: true,
      rawSql: false,
      rawIpAddresses: false,
      unrestrictedSessionSearch: false,
    },
  });
}
