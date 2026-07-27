import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchVerifiedAvatar, getVerifiedAvatarUrl } from './verified-avatar';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('verified identity avatar boundary', () => {
  test('accepts only HTTPS URLs on an explicitly allowed host', () => {
    const hosts = '*.googleusercontent.com,images.example.test';

    expect(
      getVerifiedAvatarUrl('https://lh3.googleusercontent.com/avatar.png', hosts)?.hostname,
    ).toBe('lh3.googleusercontent.com');
    expect(getVerifiedAvatarUrl('https://images.example.test/avatar.png', hosts)?.hostname).toBe(
      'images.example.test',
    );
    expect(getVerifiedAvatarUrl('http://images.example.test/avatar.png', hosts)).toBeUndefined();
    expect(getVerifiedAvatarUrl('https://googleusercontent.com/avatar.png', hosts)).toBeUndefined();
    expect(getVerifiedAvatarUrl('https://attacker.test/avatar.png', hosts)).toBeUndefined();
  });

  test('returns bounded image responses and rejects redirects or non-images', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(Uint8Array.from([1, 2, 3]), {
            headers: { 'content-type': 'image/png', 'content-length': '3' },
          }),
        )
        .mockResolvedValueOnce(
          new Response('not an image', { headers: { 'content-type': 'text/html' } }),
        ),
    );

    await expect(
      fetchVerifiedAvatar(new URL('https://images.example.test/a.png')),
    ).resolves.toEqual({
      body: Uint8Array.from([1, 2, 3]),
      contentType: 'image/png',
    });
    await expect(
      fetchVerifiedAvatar(new URL('https://images.example.test/not-image')),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  test('coalesces concurrent cold requests for the same approved avatar', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Uint8Array.from([4, 5, 6]), {
        headers: { 'content-type': 'image/png', 'content-length': '3' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const url = new URL('https://images.example.test/concurrent.png');

    const [first, second, third] = await Promise.all([
      fetchVerifiedAvatar(url),
      fetchVerifiedAvatar(url),
      fetchVerifiedAvatar(url),
    ]);

    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
