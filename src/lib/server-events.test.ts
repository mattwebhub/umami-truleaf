import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createServerEventSignature,
  getServerEventKey,
  isServerEventName,
  verifyServerEventSignature,
} from './server-events';

const secret = Buffer.alloc(32, 7);
const websiteId = 'e79ef216-70ab-48df-addc-596b6e9e65a8';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('server event authentication', () => {
  test('reserves a configuration-independent trusted namespace', () => {
    expect(isServerEventName('server.account-created')).toBe(true);
    expect(isServerEventName('account-created')).toBe(false);
  });

  test('loads a scoped 32-byte key', () => {
    const source = JSON.stringify({
      backend: {
        secret: secret.toString('base64'),
        websiteIds: [websiteId],
      },
    });

    expect(getServerEventKey('backend', source)).toEqual({
      secret,
      websiteIds: [websiteId],
    });
    expect(getServerEventKey('other', source)).toBeNull();
  });

  test('signs the timestamp, idempotency key, and exact body', () => {
    const values = {
      secret,
      timestamp: '1785110400',
      idempotencyKey: 'stripe:event-1',
      rawBody: '{"name":"subscription-verified"}',
    };
    const signature = createServerEventSignature(values);

    expect(verifyServerEventSignature(signature, signature)).toBe(true);
    expect(
      verifyServerEventSignature(
        signature,
        createServerEventSignature({ ...values, rawBody: `${values.rawBody} ` }),
      ),
    ).toBe(false);
  });

  test('rejects malformed key configuration', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(
      getServerEventKey(
        'backend',
        JSON.stringify({
          backend: {
            secret: Buffer.alloc(8).toString('base64'),
            websiteIds: [websiteId],
          },
        }),
      ),
    ).toBeNull();
    expect(error).toHaveBeenCalledWith(
      'Invalid SERVER_EVENT_KEYS; trusted server ingestion disabled',
    );
  });
});
