import { beforeEach, expect, test, vi } from 'vitest';
import { getProductCockpitConfig } from '@/lib/product-cockpit/config';
import { parseRequest } from '@/lib/request';
import { canUpdateWebsite, canViewSharedWebsite } from '@/permissions';
import { getWebsite } from '@/queries/prisma';
import { GET } from './route';

vi.mock('@/lib/request', () => ({ parseRequest: vi.fn() }));
vi.mock('@/lib/product-cockpit/config', () => ({ getProductCockpitConfig: vi.fn() }));
vi.mock('@/permissions', () => ({
  canViewSharedWebsite: vi.fn(),
  canUpdateWebsite: vi.fn(),
  canDeleteWebsite: vi.fn(),
}));
vi.mock('@/queries/prisma', () => ({
  getWebsite: vi.fn(),
  createShare: vi.fn(),
  deleteSharesByEntityId: vi.fn(),
  deleteWebsite: vi.fn(),
  getShareByEntityId: vi.fn(),
  updateWebsite: vi.fn(),
}));

const websiteId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseRequest).mockResolvedValue({
    auth: { user: { id: 'viewer' } },
  } as never);
  vi.mocked(canViewSharedWebsite).mockResolvedValue(true);
  vi.mocked(canUpdateWebsite).mockResolvedValue(false);
  vi.mocked(getProductCockpitConfig).mockReturnValue(null);
  vi.mocked(getWebsite).mockResolvedValue({
    id: websiteId,
    name: 'Read-only website',
  } as never);
});

test('exposes update capability without granting it to a read-only viewer', async () => {
  const response = await GET(new Request(`http://localhost/api/websites/${websiteId}`), {
    params: Promise.resolve({ websiteId }),
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    id: websiteId,
    canUpdate: false,
    productCockpitEnabled: false,
  });
  expect(canUpdateWebsite).toHaveBeenCalledWith(
    expect.objectContaining({ user: { id: 'viewer' } }),
    websiteId,
  );
});

test('exposes the optional product cockpit as a navigation capability', async () => {
  vi.mocked(getProductCockpitConfig).mockReturnValue({
    websiteId,
    title: 'Product health',
  } as never);

  const response = await GET(new Request(`http://localhost/api/websites/${websiteId}`), {
    params: Promise.resolve({ websiteId }),
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    id: websiteId,
    productCockpitEnabled: true,
  });
});

test('does not expose Product health to a shared overview viewer', async () => {
  vi.mocked(parseRequest).mockResolvedValueOnce({
    auth: {
      user: null,
      shareToken: { websiteId, parameters: { overview: true } },
    },
  } as never);
  vi.mocked(getProductCockpitConfig).mockReturnValue({
    websiteId,
    title: 'Product health',
  } as never);

  const response = await GET(new Request(`http://localhost/api/websites/${websiteId}`), {
    params: Promise.resolve({ websiteId }),
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    id: websiteId,
    productCockpitEnabled: false,
  });
});
