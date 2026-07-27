const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 100;
const CACHE_TTL_MS = 5 * 60_000;
const ALLOWED_CONTENT_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
const avatarCache = new Map<string, { body: Uint8Array; contentType: string; expiresAt: number }>();
const avatarInflight = new Map<
  string,
  Promise<{ body: Uint8Array; contentType: string } | undefined>
>();

function getAllowedHosts(source = process.env.IDENTITY_AVATAR_ALLOWED_HOSTS) {
  return (source ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

export function getVerifiedAvatarUrl(value: string, source?: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const allowed = getAllowedHosts(source).some(pattern =>
      pattern.startsWith('*.')
        ? hostname.endsWith(pattern.slice(1)) && hostname !== pattern.slice(2)
        : hostname === pattern,
    );

    return url.protocol === 'https:' && allowed ? url : undefined;
  } catch {
    return undefined;
  }
}

async function readBoundedBody(response: Response) {
  const reader = response.body?.getReader();

  if (!reader) {
    return undefined;
  }

  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    size += value.byteLength;
    if (size > MAX_AVATAR_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }

  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function loadVerifiedAvatar(url: URL, cacheKey: string) {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
    headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
  });
  const contentType = response.headers.get('content-type')?.split(';')[0].toLowerCase();
  const contentLength = Number(response.headers.get('content-length') ?? 0);

  if (
    !response.ok ||
    !contentType ||
    !ALLOWED_CONTENT_TYPES.has(contentType) ||
    (contentLength > 0 && contentLength > MAX_AVATAR_BYTES)
  ) {
    return undefined;
  }

  const body = await readBoundedBody(response);

  if (!body) {
    return undefined;
  }

  if (avatarCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = avatarCache.keys().next().value;
    if (oldestKey) {
      avatarCache.delete(oldestKey);
    }
  }
  avatarCache.set(cacheKey, {
    body,
    contentType,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return { body, contentType };
}

export async function fetchVerifiedAvatar(url: URL) {
  const cacheKey = url.toString();
  const cached = avatarCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return { body: cached.body, contentType: cached.contentType };
  }

  if (cached) {
    avatarCache.delete(cacheKey);
  }

  const inflight = avatarInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const request = loadVerifiedAvatar(url, cacheKey).finally(() => {
    avatarInflight.delete(cacheKey);
  });
  avatarInflight.set(cacheKey, request);
  return request;
}
