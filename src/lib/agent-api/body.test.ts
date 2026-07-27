import { expect, test } from 'vitest';
import { readBoundedJson } from './body';

test('parses bounded JSON without trusting content-length', async () => {
  const result = await readBoundedJson(
    new Request('http://localhost/query', {
      method: 'POST',
      body: JSON.stringify({ kind: 'snapshot' }),
    }),
    1024,
  );

  expect(result).toEqual({ ok: true, value: { kind: 'snapshot' } });
});

test('rejects declared and streamed bodies over the limit', async () => {
  const declared = await readBoundedJson(
    new Request('http://localhost/query', {
      method: 'POST',
      headers: { 'content-length': '2048' },
      body: '{}',
    }),
    1024,
  );
  const streamed = await readBoundedJson(
    new Request('http://localhost/query', {
      method: 'POST',
      body: JSON.stringify({ value: 'x'.repeat(2048) }),
    }),
    1024,
  );

  expect(declared).toEqual({ ok: false, reason: 'too-large' });
  expect(streamed).toEqual({ ok: false, reason: 'too-large' });
});
