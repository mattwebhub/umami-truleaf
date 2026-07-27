import type { ServiceApiKeyAuth } from '@/lib/service-api-key';

export function agentApiRateLimitError() {
  return Response.json(
    {
      error: {
        message: 'Rate limit exceeded',
        code: 'rate-limit',
        status: 429,
      },
    },
    { status: 429, headers: { 'Retry-After': '60' } },
  );
}

export function serviceApiKeyError(auth: ServiceApiKeyAuth) {
  if (!('reason' in auth)) {
    throw new Error('Expected failed service API key authentication');
  }

  if (auth.reason === 'rate-limit') {
    return agentApiRateLimitError();
  }

  if (auth.reason === 'scope' || auth.reason === 'website' || auth.reason === 'permission') {
    return Response.json(
      {
        error: {
          message: 'API key does not have the required scope',
          code: 'insufficient-scope',
          status: 403,
        },
      },
      { status: 403 },
    );
  }

  return Response.json(
    {
      error: {
        message: 'Invalid service API key',
        code: `service-key-${auth.reason}`,
        status: 401,
      },
    },
    { status: 401 },
  );
}
