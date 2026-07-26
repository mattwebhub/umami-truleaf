import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createTruleafServiceSignature,
  moderationActionSchema,
  moderationStatusSchema,
  requestTruleafModeration,
} from './service';

beforeEach(() => {
  process.env.TRULEAF_MODERATION_API_URL = 'http://localhost:4000';
  process.env.TRULEAF_MODERATION_KEY_ID = 'test-key';
  process.env.TRULEAF_MODERATION_HMAC_SECRET = Buffer.alloc(32, 7).toString('base64');
});

afterEach(() => {
  delete process.env.TRULEAF_MODERATION_API_URL;
  delete process.env.TRULEAF_MODERATION_KEY_ID;
  delete process.env.TRULEAF_MODERATION_HMAC_SECRET;
  vi.unstubAllGlobals();
});

describe('Truleaf service signing', () => {
  test('signs the versioned canonical request with base64url HMAC-SHA256', () => {
    const signature = createTruleafServiceSignature({
      method: 'post',
      pathname: '/api/v1/internal/moderation/actions',
      timestamp: '1720000000',
      nonce: 'nonce-1',
      rawBody: '{"hello":"world"}',
      secret: Buffer.from('test-secret'),
    });

    expect(signature).toBe('Y4X1b7QBWk04DPnf0iKrsHVfy4WvY8b9efa7-nXG0Ck');
  });

  test('binds the signature to the request body', () => {
    const values = {
      method: 'POST',
      pathname: '/api/v1/internal/moderation/actions',
      timestamp: '1720000000',
      nonce: 'nonce-1',
      secret: Buffer.from('test-secret'),
    };

    expect(createTruleafServiceSignature({ ...values, rawBody: '{}' })).not.toBe(
      createTruleafServiceSignature({ ...values, rawBody: '{"action":"ban"}' }),
    );
  });
});

describe('Truleaf service response boundary', () => {
  test('unwraps and strips non-contract fields from a success envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          success: true,
          data: {
            targets: [
              {
                type: 'ip',
                targetId: 'opaque-network',
                banId: 'source-bound-ban-id',
                displayValue: '192.0.x.x',
                banned: true,
                canUnban: true,
                sourceMatches: true,
                value: 'must-not-cross-the-boundary',
                proof: 'must-not-cross-the-boundary',
              },
            ],
          },
          timestamp: '2026-07-25T00:00:00Z',
        }),
      ),
    );

    await expect(
      requestTruleafModeration({
        path: '/api/v1/internal/moderation/status',
        body: { targets: [] },
        schema: moderationStatusSchema,
      }),
    ).resolves.toEqual({
      targets: [
        {
          type: 'ip',
          targetId: 'opaque-network',
          banId: 'source-bound-ban-id',
          displayValue: '192.0.x.x',
          banned: true,
          canUnban: true,
          sourceMatches: true,
        },
      ],
    });
  });

  test('strips source-bound ban IDs and raw values from action responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          success: true,
          data: {
            operationId: 'operation-1',
            requestId: 'request-1',
            status: 'applied',
            targets: [
              {
                type: 'ip',
                targetId: 'opaque-network',
                banId: 'must-not-reach-browser',
                displayValue: '192.0.x.x',
                value: '192.0.2.10',
                proof: 'must-not-reach-browser',
                status: 'applied',
                api: 'applied',
                vercel: 'applied',
              },
            ],
          },
        }),
      ),
    );

    await expect(
      requestTruleafModeration({
        path: '/api/v1/internal/moderation/actions',
        body: { targets: [] },
        schema: moderationActionSchema,
      }),
    ).resolves.toEqual({
      operationId: 'operation-1',
      requestId: 'request-1',
      status: 'applied',
      targets: [
        {
          type: 'ip',
          targetId: 'opaque-network',
          displayValue: '192.0.x.x',
          status: 'applied',
          api: 'applied',
          vercel: 'applied',
        },
      ],
    });
  });

  test('normalizes nested service error codes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            success: false,
            error: {
              message: 'Proof expired',
              details: { code: 'IDENTITY_PROOF_EXPIRED' },
            },
          },
          { status: 403 },
        ),
      ),
    );

    await expect(
      requestTruleafModeration({
        path: '/api/v1/internal/moderation/status',
        body: { targets: [] },
        schema: moderationStatusSchema,
      }),
    ).rejects.toMatchObject({
      message: 'Proof expired',
      status: 403,
      code: 'IDENTITY_PROOF_EXPIRED',
    });
  });

  test('rejects malformed success payloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ success: true, data: { targets: 'invalid' } })),
    );

    await expect(
      requestTruleafModeration({
        path: '/api/v1/internal/moderation/status',
        body: { targets: [] },
        schema: moderationStatusSchema,
      }),
    ).rejects.toThrow('invalid response');
  });
});
