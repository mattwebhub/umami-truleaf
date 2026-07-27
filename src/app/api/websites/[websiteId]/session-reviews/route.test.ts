import { beforeEach, expect, test, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { parseRequest } from '@/lib/request';
import { canUpdateWebsite } from '@/permissions';
import { GET, POST } from './route';

vi.mock('@/lib/crypto', () => ({ uuid: () => 'review-id' }));
vi.mock('@/lib/prisma', () => ({
  default: {
    client: {
      session: { findFirst: vi.fn() },
      sessionReview: { findMany: vi.fn(), upsert: vi.fn() },
    },
  },
}));
vi.mock('@/lib/request', () => ({ parseRequest: vi.fn() }));
vi.mock('@/permissions', () => ({ canUpdateWebsite: vi.fn() }));

const websiteId = 'e79ef216-70ab-48df-addc-596b6e9e65a8';
const sessionId = '83b32c88-64ad-4776-917f-89014c58c233';
const context = { params: Promise.resolve({ websiteId }) };
const sessionFindFirstMock = prisma.client.session.findFirst as unknown as ReturnType<typeof vi.fn>;
const reviewUpsertMock = prisma.client.sessionReview.upsert as unknown as ReturnType<typeof vi.fn>;
const reviewFindManyMock = prisma.client.sessionReview.findMany as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseRequest).mockResolvedValue({
    auth: { user: { id: 'operator-id' } },
    body: {
      sessionId,
      reason: 'Manual operator review',
      severity: 'high',
    },
  } as never);
  vi.mocked(canUpdateWebsite).mockResolvedValue(true);
  sessionFindFirstMock.mockResolvedValue({ id: sessionId });
  reviewUpsertMock.mockResolvedValue({ id: 'review-id' });
});

test('creates operator review state for a session in the same website', async () => {
  const response = await POST(
    new Request('http://localhost/session-reviews', { method: 'POST' }),
    context,
  );

  expect(response.status).toBe(200);
  expect(prisma.client.session.findFirst).toHaveBeenCalledWith({
    where: { id: sessionId, websiteId },
    select: { id: true },
  });
  expect(prisma.client.sessionReview.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { websiteId_sessionId: { websiteId, sessionId } },
      create: expect.objectContaining({
        createdByUserId: 'operator-id',
        reason: 'Manual operator review',
        severity: 'high',
        severityRank: 0,
      }),
    }),
  );
});

test('paginates in database severity order so older high-risk reviews remain reachable', async () => {
  vi.mocked(parseRequest).mockResolvedValueOnce({
    auth: { user: { id: 'operator-id' } },
    url: new URL('http://localhost/session-reviews?status=open&page=2'),
  } as never);
  reviewFindManyMock.mockResolvedValueOnce(
    Array.from({ length: 51 }, (_, index) => ({ id: `review-${index}` })),
  );

  const response = await GET(
    new Request('http://localhost/session-reviews?status=open&page=2'),
    context,
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(prisma.client.sessionReview.findMany).toHaveBeenCalledWith({
    where: { websiteId, status: 'open' },
    orderBy: [{ severityRank: 'asc' }, { updatedAt: 'desc' }, { id: 'asc' }],
    skip: 100,
    take: 51,
  });
  expect(body).toMatchObject({ page: 2, hasMore: true });
  expect(body.data).toHaveLength(50);
});

test('rejects a session belonging to another website', async () => {
  sessionFindFirstMock.mockResolvedValueOnce(null);

  const response = await POST(
    new Request('http://localhost/session-reviews', { method: 'POST' }),
    context,
  );

  expect(response.status).toBe(400);
  expect(prisma.client.sessionReview.upsert).not.toHaveBeenCalled();
});
