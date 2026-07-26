import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

test('purges the reserved proof from PostgreSQL and ClickHouse generic stores', () => {
  const postgres = fs.readFileSync(
    path.join(
      process.cwd(),
      'prisma/migrations/23_add_truleaf_account_ban_reference/migration.sql',
    ),
    'utf8',
  );
  const clickhouse = fs.readFileSync(
    path.join(
      process.cwd(),
      'db/clickhouse/migrations/14_remove_truleaf_identity_proof_event_data.sql',
    ),
    'utf8',
  );

  for (const sql of [postgres, clickhouse]) {
    expect(sql).toContain('session_data');
    expect(sql).toContain('event_data');
    expect(sql).toMatch(/"?data_key"? = 'truleafIdentityProof'/);
  }

  expect(clickhouse.match(/SETTINGS mutations_sync = 2/g)).toHaveLength(2);
});
