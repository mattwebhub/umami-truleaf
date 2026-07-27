import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

test('purges the reserved proof without rebuilding live ClickHouse aggregate groups', () => {
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
  const clickhouseSchema = fs.readFileSync(
    path.join(process.cwd(), 'db/clickhouse/schema.sql'),
    'utf8',
  );
  const clickhouseCanary = fs.readFileSync(
    path.join(process.cwd(), 'scripts/canary-clickhouse-migration-14.sh'),
    'utf8',
  );

  for (const sql of [postgres, clickhouse]) {
    expect(sql).toContain('session_data');
    expect(sql).toContain('event_data');
    expect(sql).toMatch(/"?data_key"? = 'truleafIdentityProof'/);
  }

  expect(clickhouse).toContain('umami.event_data_pivot');
  expect(clickhouse).toContain('umami.session_data_pivot');
  expect(clickhouse).toContain('DROP VIEW IF EXISTS umami.session_data_pivot_mv SYNC');
  expect(clickhouse).toContain('DROP TABLE IF EXISTS umami.session_data_pivot SYNC');
  expect(clickhouse).toContain('finalizeAggregation(property_keys)');
  expect(clickhouse.match(/arrayReduce\(\n\s*'groupArrayState'/g)).toHaveLength(3);
  expect(clickhouse).toContain('SELECT throwIf(');
  expect(clickhouse).toContain('INTERVAL 5 MINUTE');
  expect(clickhouse.match(/SETTINGS mutations_sync = 2/g)).toHaveLength(3);
  expect(clickhouse).not.toContain('INSERT INTO umami.event_data_pivot');
  expect(clickhouse).not.toContain('ALTER TABLE umami.session_data_pivot');
  expect(clickhouseSchema).not.toContain('CREATE TABLE IF NOT EXISTS umami.session_data_pivot');
  expect(clickhouseSchema).not.toContain(
    'CREATE MATERIALIZED VIEW IF NOT EXISTS umami.session_data_pivot_mv',
  );
  expect(clickhouseSchema).toContain('allow_dimensions_outside_sorting_key = 1');

  const dropSessionView = clickhouse.indexOf('DROP VIEW IF EXISTS umami.session_data_pivot_mv');
  const dropSessionTable = clickhouse.indexOf('DROP TABLE IF EXISTS umami.session_data_pivot');
  const purgeEventBase = clickhouse.indexOf('ALTER TABLE umami.event_data\n');
  const purgeSessionBase = clickhouse.indexOf('ALTER TABLE umami.session_data\n');
  const sanitizeEventPivot = clickhouse.indexOf('ALTER TABLE umami.event_data_pivot\n');

  expect(dropSessionView).toBeGreaterThan(-1);
  expect(dropSessionView).toBeLessThan(dropSessionTable);
  expect(dropSessionTable).toBeLessThan(purgeSessionBase);
  expect(purgeSessionBase).toBeLessThan(purgeEventBase);
  expect(purgeEventBase).toBeLessThan(sanitizeEventPivot);

  expect(clickhouseCanary).toContain(
    'clickhouse/clickhouse-server@sha256:d7556a3841027651307b5aa08d72b5c467d0241d3db5b67d9e158ef3975626f5',
  );
  expect(clickhouseCanary).toContain("run_variant 'absent'");
  expect(clickhouseCanary).toContain("run_variant 'present'");
  expect(clickhouseCanary).toContain('SYSTEM STOP MERGES umami.event_data_pivot');
  expect(clickhouseCanary).toContain('allow_dimensions_outside_sorting_key = 1');
  expect(clickhouseCanary).toContain('Migration unexpectedly accepted active proof ingestion');
  expect(clickhouseCanary).toContain('CLICKHOUSE_CANARY_ALLOW_DROP_UMAMI');
  expect(clickhouseCanary).toContain('CLICKHOUSE_CANARY_CLIENT_SHA256');
  expect(clickhouseCanary).toContain('ClickHouse version mismatch');
  expect(clickhouseCanary).toContain('multiquery <');
});
