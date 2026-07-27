import { expect, test, vi } from 'vitest';
import { getProductHealthNavItems, hasProductHealthCapability } from './useWebsiteNavItems';

test.each([
  ['while the website capability is loading', undefined],
  ['when the product cockpit is disabled', false],
] as const)('does not expose Product health %s', (_label, enabled) => {
  const renderPath = vi.fn((path: string) => path);

  expect(getProductHealthNavItems(enabled, renderPath, 'Product health')).toEqual([]);
  expect(renderPath).not.toHaveBeenCalled();
});

test('places Product health on its dedicated route when enabled', () => {
  const renderPath = vi.fn((path: string) => `/websites/website-1${path}`);

  expect(getProductHealthNavItems(true, renderPath, 'Product health')).toMatchObject([
    {
      id: 'product-health',
      label: 'Product health',
      path: '/websites/website-1/product-health',
    },
  ]);
  expect(renderPath).toHaveBeenCalledOnce();
});

test('does not reuse a previous website capability while the next website is loading', () => {
  expect(
    hasProductHealthCapability({ id: 'website-a', productCockpitEnabled: true }, 'website-b'),
  ).toBe(false);
  expect(
    hasProductHealthCapability({ id: 'website-b', productCockpitEnabled: true }, 'website-b'),
  ).toBe(true);
});
