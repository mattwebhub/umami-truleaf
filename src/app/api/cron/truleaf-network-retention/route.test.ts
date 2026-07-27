import { beforeEach, expect, test, vi } from 'vitest';
import { reconcileVerifiedIdentityProfiles } from '@/lib/truleaf/identity-profile-reconciler';
import {
  deleteExpiredTruleafSessionAccountBanReferences,
  deleteExpiredTruleafSessionIdentities,
  deleteExpiredTruleafSessionNetworks,
  deleteExpiredVerifiedIdentityProfiles,
} from '@/queries/prisma';
import { POST } from './route';

vi.mock('@/queries/prisma', () => ({
  deleteExpiredTruleafSessionAccountBanReferences: vi.fn(),
  deleteExpiredTruleafSessionIdentities: vi.fn(),
  deleteExpiredTruleafSessionNetworks: vi.fn(),
  deleteExpiredVerifiedIdentityProfiles: vi.fn(),
}));
vi.mock('@/lib/truleaf/identity-profile-reconciler', () => ({
  reconcileVerifiedIdentityProfiles: vi.fn(),
}));

const deleteExpiredReferencesMock = vi.mocked(deleteExpiredTruleafSessionAccountBanReferences);
const deleteExpiredIdentitiesMock = vi.mocked(deleteExpiredTruleafSessionIdentities);
const deleteExpiredMock = vi.mocked(deleteExpiredTruleafSessionNetworks);
const deleteExpiredProfilesMock = vi.mocked(deleteExpiredVerifiedIdentityProfiles);
const reconcileProfilesMock = vi.mocked(reconcileVerifiedIdentityProfiles);
const secret = 'retention-secret-at-least-32-characters';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TRULEAF_RETENTION_SECRET = secret;
  deleteExpiredReferencesMock.mockResolvedValue({ count: 0 });
  deleteExpiredIdentitiesMock.mockResolvedValue({ count: 0 });
  deleteExpiredProfilesMock.mockResolvedValue({ count: 0 });
  reconcileProfilesMock.mockResolvedValue({ attempted: 0, resolved: 0 });
});

test('rejects missing and invalid retention credentials', async () => {
  const missing = await POST(new Request('http://localhost/api/cron/retention'));
  const invalid = await POST(
    new Request('http://localhost/api/cron/retention', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
    }),
  );

  expect(missing.status).toBe(401);
  expect(invalid.status).toBe(401);
  expect(deleteExpiredMock).not.toHaveBeenCalled();
  expect(deleteExpiredIdentitiesMock).not.toHaveBeenCalled();
  expect(deleteExpiredReferencesMock).not.toHaveBeenCalled();
  expect(deleteExpiredProfilesMock).not.toHaveBeenCalled();
  expect(reconcileProfilesMock).not.toHaveBeenCalled();
});

test('deletes expired network, proof, profile, and ban-reference records with the dedicated credential', async () => {
  deleteExpiredMock.mockResolvedValue({ count: 3 });
  deleteExpiredIdentitiesMock.mockResolvedValue({ count: 2 });
  deleteExpiredReferencesMock.mockResolvedValue({ count: 1 });
  deleteExpiredProfilesMock.mockResolvedValue({ count: 4 });
  reconcileProfilesMock.mockResolvedValue({ attempted: 5, resolved: 2 });

  const response = await POST(
    new Request('http://localhost/api/cron/retention', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    }),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    deleted: 10,
    deletedNetworks: 3,
    deletedIdentityProofs: 2,
    deletedAccountBanReferences: 1,
    deletedIdentityProfiles: 4,
    reconciledIdentityProfiles: 2,
    attemptedIdentityProfiles: 5,
  });
  expect(deleteExpiredMock).toHaveBeenCalledOnce();
  expect(deleteExpiredIdentitiesMock).toHaveBeenCalledOnce();
  expect(deleteExpiredReferencesMock).toHaveBeenCalledOnce();
  expect(deleteExpiredProfilesMock).toHaveBeenCalledOnce();
  expect(reconcileProfilesMock).toHaveBeenCalledOnce();
});
