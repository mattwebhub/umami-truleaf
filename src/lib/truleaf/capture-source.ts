import debug from 'debug';
import { after } from 'next/server';
import { getIpAddress } from '@/lib/ip';

const log = debug('umami:truleaf');

/**
 * Resolve moderation provenance exclusively from the request transport.
 *
 * The analytics payload supports an `ip` override for Umami Cloud geo processing,
 * but that value is visitor-controlled in self-hosted deployments and must never
 * become a ban target. Production ingress must overwrite the configured client-IP
 * header and prevent direct access to the collector.
 */
export function getTruleafCaptureAddress(request: Request) {
  if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_IP_HEADER) {
    return undefined;
  }

  return getIpAddress(request.headers);
}

export function shouldCaptureTruleafNetwork(
  cachedSessionId: string | undefined,
  computedSessionId: string,
) {
  return !cachedSessionId || cachedSessionId !== computedSessionId;
}

export function scheduleTruleafNetworkCapture(
  task: () => Promise<unknown>,
  schedule: typeof after = after,
) {
  schedule(async () => {
    try {
      await task();
    } catch {
      // Address parsing failures can contain the address, so keep this generic.
      log('network capture failed');
    }
  });
}
