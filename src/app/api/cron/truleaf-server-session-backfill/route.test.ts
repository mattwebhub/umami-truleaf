import { beforeEach, expect, test, vi } from 'vitest';
import { backfillLegacyServerSessions } from '@/lib/server-events-backfill';
import { POST } from './route';

vi.mock('@/lib/server-events-backfill', () => ({
  backfillLegacyServerSessions: vi.fn(),
}));

const secret = 'retention-secret-at-least-32-characters';
const summary = {
  identitiesFound: 2,
  identitiesMigrated: 0,
  eventsFound: 3,
  eventsMoved: 0,
  identityLinksCreated: 0,
  legacySessionsSanitized: 0,
};

function request(query = '', authorization = `Bearer ${secret}`) {
  return new Request(`http://localhost/api/cron/truleaf-server-session-backfill${query}`, {
    method: 'POST',
    headers: { authorization },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TRULEAF_RETENTION_SECRET = secret;
  vi.mocked(backfillLegacyServerSessions).mockResolvedValue(summary);
});

test('rejects requests without the dedicated maintenance credential', async () => {
  const response = await POST(request('', 'Bearer wrong'));

  expect(response.status).toBe(401);
  expect(backfillLegacyServerSessions).not.toHaveBeenCalled();
});

test('defaults the production endpoint to a non-mutating dry run', async () => {
  const response = await POST(request());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    mode: 'dry-run',
    ...summary,
  });
  expect(backfillLegacyServerSessions).toHaveBeenCalledWith({ apply: false });
});

test('requires an explicit boolean before applying the backfill', async () => {
  const invalid = await POST(request('?apply=yes'));
  const appliedSummary = {
    ...summary,
    identitiesMigrated: 2,
    eventsMoved: 3,
  };
  vi.mocked(backfillLegacyServerSessions).mockResolvedValueOnce(appliedSummary);
  const applied = await POST(request('?apply=true'));

  expect(invalid.status).toBe(400);
  expect(applied.status).toBe(200);
  await expect(applied.json()).resolves.toEqual({
    mode: 'apply',
    ...appliedSummary,
  });
  expect(backfillLegacyServerSessions).toHaveBeenCalledTimes(1);
  expect(backfillLegacyServerSessions).toHaveBeenCalledWith({ apply: true });
});
