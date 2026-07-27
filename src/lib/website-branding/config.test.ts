import { afterEach, describe, expect, test, vi } from 'vitest';
import { getWebsiteBrand } from './config';

const websiteId = 'e79ef216-70ab-48df-addc-596b6e9e65a8';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('website branding configuration', () => {
  test('scopes a reviewed profile to the exact configured website', () => {
    const source = JSON.stringify({
      websites: [{ websiteId, profile: 'truleaf' }],
    });

    expect(getWebsiteBrand(websiteId, source)).toBe('truleaf');
    expect(getWebsiteBrand('bf2c084a-75bc-44db-99d7-346670152168', source)).toBeNull();
  });

  test('fails closed for unknown profiles, malformed JSON, and oversized maps', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      getWebsiteBrand(
        websiteId,
        JSON.stringify({ websites: [{ websiteId, profile: 'arbitrary-css' }] }),
      ),
    ).toBeNull();
    expect(getWebsiteBrand(websiteId, '{')).toBeNull();
    expect(
      getWebsiteBrand(
        websiteId,
        JSON.stringify({
          websites: Array.from({ length: 101 }, () => ({ websiteId, profile: 'truleaf' })),
        }),
      ),
    ).toBeNull();
    expect(error).toHaveBeenCalled();
  });
});
