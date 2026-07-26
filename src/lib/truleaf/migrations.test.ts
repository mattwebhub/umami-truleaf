import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

test('purges the reserved proof from base and ClickHouse materialized aggregate stores', () => {
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

  expect(clickhouse).toContain('umami.event_data_pivot');
  expect(clickhouse).toContain('umami.session_data_pivot');
  expect(clickhouse).toContain('groupArrayMerge(property_keys)');
  expect(clickhouse).toContain('umami.truleaf_proof_event_pivot_keys');
  expect(clickhouse).toContain('umami.truleaf_proof_session_pivot_keys');
  expect(clickhouse.match(/SETTINGS mutations_sync = 2/g)).toHaveLength(4);
  expect(clickhouse.match(/data_key != 'truleafIdentityProof'/g)).toHaveLength(2);
  expect(clickhouse.match(/ANY INNER JOIN/g)).toHaveLength(2);
  expect(clickhouse).toContain('DROP TABLE umami.truleaf_proof_event_pivot_keys');
  expect(clickhouse).toContain('DROP TABLE umami.truleaf_proof_session_pivot_keys');
  expect(clickhouse).not.toContain('TRUNCATE TABLE');

  const captureEventKeys = clickhouse.indexOf('INSERT INTO umami.truleaf_proof_event_pivot_keys');
  const captureSessionKeys = clickhouse.indexOf(
    'INSERT INTO umami.truleaf_proof_session_pivot_keys',
  );
  const purgeEventBase = clickhouse.indexOf('ALTER TABLE umami.event_data\n');
  const purgeSessionBase = clickhouse.indexOf('ALTER TABLE umami.session_data\n');
  const purgeEventPivot = clickhouse.indexOf('ALTER TABLE umami.event_data_pivot\n');
  const purgeSessionPivot = clickhouse.indexOf('ALTER TABLE umami.session_data_pivot\n');
  const rebuildEventPivot = clickhouse.lastIndexOf('INSERT INTO umami.event_data_pivot');
  const rebuildSessionPivot = clickhouse.lastIndexOf('INSERT INTO umami.session_data_pivot');

  expect(captureEventKeys).toBeGreaterThan(-1);
  expect(captureEventKeys).toBeLessThan(purgeEventBase);
  expect(purgeEventBase).toBeLessThan(purgeEventPivot);
  expect(purgeEventPivot).toBeLessThan(rebuildEventPivot);
  expect(captureSessionKeys).toBeGreaterThan(-1);
  expect(captureSessionKeys).toBeLessThan(purgeSessionBase);
  expect(purgeSessionBase).toBeLessThan(purgeSessionPivot);
  expect(purgeSessionPivot).toBeLessThan(rebuildSessionPivot);
});
