import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

test('keeps review workflow separate from analytics event storage', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'prisma/migrations/24_add_session_review/migration.sql'),
    'utf8',
  );

  expect(sql).toContain('CREATE TABLE "session_review"');
  expect(sql).toContain('"created_by_user_id" UUID NOT NULL');
  expect(sql).toContain('"severity_rank" INTEGER NOT NULL DEFAULT 1');
  expect(sql).toContain('website_id_status_severity_rank_updated_at_idx');
  expect(sql).toContain('session_review_website_id_session_id_key');
  expect(sql).not.toContain('website_event');
  expect(sql).not.toContain('event_data');
});

test('cleans operator review state up with websites, sessions, and users', () => {
  const websiteQueries = fs.readFileSync(
    path.join(process.cwd(), 'src/queries/prisma/website.ts'),
    'utf8',
  );
  const userQueries = fs.readFileSync(
    path.join(process.cwd(), 'src/queries/prisma/user.ts'),
    'utf8',
  );

  expect(websiteQueries.match(/sessionReview\.deleteMany/g)).toHaveLength(2);
  expect(userQueries.match(/sessionReview\.deleteMany/g)).toHaveLength(2);
  expect(userQueries).toContain('{ createdByUserId: userId }');
});
