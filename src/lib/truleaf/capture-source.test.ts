import { afterEach, expect, test, vi } from 'vitest';
import {
  getTruleafCaptureAddress,
  scheduleTruleafNetworkCapture,
  shouldCaptureTruleafNetwork,
} from './capture-source';

afterEach(() => {
  delete process.env.CLIENT_IP_HEADER;
  vi.unstubAllEnvs();
});

test('uses only the configured transport header for moderation provenance', () => {
  process.env.CLIENT_IP_HEADER = 'x-real-ip';
  const request = new Request('https://analytics.example/api/send', {
    method: 'POST',
    headers: {
      'x-real-ip': '192.0.2.10',
      'x-forwarded-for': '198.51.100.20',
    },
    body: JSON.stringify({ payload: { ip: '203.0.113.30' } }),
  });

  expect(getTruleafCaptureAddress(request)).toBe('192.0.2.10');
});

test('cannot read a visitor-supplied IP from the analytics body', () => {
  const request = new Request('https://analytics.example/api/send', {
    method: 'POST',
    body: JSON.stringify({ payload: { ip: '203.0.113.30' } }),
  });

  expect(getTruleafCaptureAddress(request)).toBeUndefined();
});

test('does not fall back to spoofable headers when the trusted header is absent', () => {
  vi.stubEnv('NODE_ENV', 'production');
  process.env.CLIENT_IP_HEADER = 'x-real-ip';
  const request = new Request('https://analytics.example/api/send', {
    headers: {
      'true-client-ip': '192.0.2.10',
      'x-forwarded-for': '198.51.100.20',
    },
  });

  expect(getTruleafCaptureAddress(request)).toBeUndefined();
});

test('rejects a malformed value in the configured transport header', () => {
  process.env.CLIENT_IP_HEADER = 'x-real-ip';
  const request = new Request('https://analytics.example/api/send', {
    headers: { 'x-real-ip': '198.51.100.20, 203.0.113.30' },
  });

  expect(getTruleafCaptureAddress(request)).toBeUndefined();
});

test('fails closed for capture when production has no explicit client IP header', () => {
  vi.stubEnv('NODE_ENV', 'production');
  const request = new Request('https://analytics.example/api/send', {
    headers: { 'x-forwarded-for': '198.51.100.20' },
  });

  expect(getTruleafCaptureAddress(request)).toBeUndefined();
});

test('schedules capture outside collector response latency and contains failures', async () => {
  let scheduled: (() => Promise<void>) | undefined;
  let release: (() => void) | undefined;
  const task = vi.fn(
    () =>
      new Promise<void>(resolve => {
        release = resolve;
      }),
  );

  scheduleTruleafNetworkCapture(task, callback => {
    if (typeof callback === 'function') {
      scheduled = callback as () => Promise<void>;
    }
  });

  expect(task).not.toHaveBeenCalled();
  const pending = scheduled?.();
  expect(task).toHaveBeenCalledOnce();
  release?.();
  await pending;

  scheduleTruleafNetworkCapture(
    async () => {
      throw new Error('sensitive value');
    },
    callback => (typeof callback === 'function' ? callback() : callback),
  );
});

test('captures only a cache miss or session identity transition', () => {
  expect(shouldCaptureTruleafNetwork(undefined, 'anonymous-session')).toBe(true);
  expect(shouldCaptureTruleafNetwork('anonymous-session', 'anonymous-session')).toBe(false);
  expect(shouldCaptureTruleafNetwork('anonymous-session', 'identified-session')).toBe(true);
});
