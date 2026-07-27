import debug from 'debug';
import { after } from 'next/server';
import { normalizeNetworkAddress } from '@/lib/truleaf/network-crypto';

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
  const header = process.env.CLIENT_IP_HEADER?.trim();

  if (!header) {
    return undefined;
  }

  const value = request.headers.get(header);

  if (!value) {
    return undefined;
  }

  try {
    return normalizeNetworkAddress(value).value;
  } catch {
    return undefined;
  }
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
