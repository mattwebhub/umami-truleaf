import { afterEach, describe, expect, test, vi } from 'vitest';
import { getProductCockpitConfig } from './config';

const websiteId = '3f37bd2a-5fb7-4c65-98ca-60d6c4d15534';

afterEach(() => {
  delete process.env.PRODUCT_COCKPIT_CONFIG;
  vi.restoreAllMocks();
});

describe('product cockpit configuration', () => {
  test('returns only the requested website configuration', () => {
    const source = JSON.stringify({
      websites: [
        {
          websiteId,
          title: 'Product health',
          metrics: [
            {
              id: 'signup-rate',
              label: 'Signup conversion',
              type: 'rate',
              numerator: ['signup-completed', 'legacy-signup'],
              denominator: ['signup-intent'],
            },
          ],
          funnels: [],
          features: [],
        },
      ],
    });

    expect(getProductCockpitConfig(websiteId, source)).toMatchObject({
      title: 'Product health',
      metrics: [{ id: 'signup-rate' }],
    });
    expect(getProductCockpitConfig('bf2c084a-75bc-44db-99d7-346670152168', source)).toBeNull();
  });

  test('fails closed for malformed or oversized configuration', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(getProductCockpitConfig(websiteId, '{')).toBeNull();
    expect(
      getProductCockpitConfig(
        websiteId,
        JSON.stringify({
          websites: [
            {
              websiteId,
              metrics: [
                {
                  id: 'unsafe',
                  label: 'Unsafe',
                  type: 'count',
                  events: Array.from({ length: 21 }, (_, index) => `event-${index}`),
                },
              ],
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(error).toHaveBeenCalledWith('Invalid PRODUCT_COCKPIT_CONFIG; product cockpit disabled');
  });

  test('requires authoritative events to use the public-reserved namespace', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = JSON.stringify({
      websites: [
        {
          websiteId,
          authoritativeEvents: ['account-created'],
          metrics: [],
          funnels: [],
          features: [],
        },
      ],
    });

    expect(getProductCockpitConfig(websiteId, source)).toBeNull();
    expect(error).toHaveBeenCalledWith('Invalid PRODUCT_COCKPIT_CONFIG; product cockpit disabled');
  });
});
