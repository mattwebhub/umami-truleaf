import { beforeEach, expect, test, vi } from 'vitest';
import { parseRequest } from '@/lib/request';
import { revokeServiceApiKey } from '@/lib/service-api-key';
import { canUpdateWebsite } from '@/permissions';
import { DELETE } from './route';

vi.mock('@/lib/request', () => ({ parseRequest: vi.fn() }));
vi.mock('@/lib/service-api-key', () => ({
  isActiveServiceApiKeyWebsite: vi.fn(async () => true),
  revokeServiceApiKey: vi.fn(),
}));
vi.mock('@/permissions', () => ({ canUpdateWebsite: vi.fn() }));

const websiteId = 'e79ef216-70ab-48df-addc-596b6e9e65a8';
const keyId = '83b32c88-64ad-4776-917f-89014c58c233';
const context = { params: Promise.resolve({ websiteId, keyId }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseRequest).mockResolvedValue({ auth: { user: { id: 'operator' } } } as never);
  vi.mocked(canUpdateWebsite).mockResolvedValue(true);
});

test('revokes the exact website-bound key and writes a lifecycle audit', async () => {
  vi.mocked(revokeServiceApiKey).mockResolvedValue(true);

  const response = await DELETE(
    new Request('http://localhost/service-api-keys/key-id', { method: 'DELETE' }),
    context,
  );

  expect(response.status).toBe(200);
  expect(revokeServiceApiKey).toHaveBeenCalledWith(expect.objectContaining({ keyId, websiteId }));
});

test('does not reveal whether a key exists without website update permission', async () => {
  vi.mocked(canUpdateWebsite).mockResolvedValue(false);

  const response = await DELETE(
    new Request('http://localhost/service-api-keys/key-id', { method: 'DELETE' }),
    context,
  );

  expect(response.status).toBe(403);
  expect(revokeServiceApiKey).not.toHaveBeenCalled();
});
