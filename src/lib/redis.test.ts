import { beforeEach, describe, expect, test, vi } from 'vitest';
import { UmamiRedisClient } from './redis';

describe('UmamiRedisClient.rateLimit', () => {
  const evalMock = vi.fn();
  let client: UmamiRedisClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new UmamiRedisClient('redis://localhost:6379');
    client.connect = vi.fn();
    client.client = { eval: evalMock } as never;
  });

  test('atomically gives a fresh weighted counter its expiry', async () => {
    evalMock.mockResolvedValueOnce(10);

    await expect(client.rateLimit('weighted', 121, 60, 10)).resolves.toBe(false);
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('EXPIRE', KEYS[1], ARGV[2])"),
      {
        keys: ['weighted'],
        arguments: ['10', '60'],
      },
    );
  });

  test('blocks exactly when the weighted counter reaches the supplied threshold', async () => {
    evalMock.mockResolvedValueOnce(120).mockResolvedValueOnce(121);

    await expect(client.rateLimit('weighted', 121, 60, 10)).resolves.toBe(false);
    await expect(client.rateLimit('weighted', 121, 60, 1)).resolves.toBe(true);
  });
});
