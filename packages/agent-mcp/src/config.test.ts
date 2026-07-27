import { describe, expect, test } from 'vitest';
import { loadConfig } from './config';

const valid = {
  UMAMI_MCP_BASE_URL: 'https://analytics.example.com/',
  UMAMI_MCP_WEBSITE_ID: 'e79ef216-70ab-48df-addc-596b6e9e65a8',
  UMAMI_MCP_API_KEY: `umami_sk_${'a'.repeat(43)}`,
};

describe('loadConfig', () => {
  test('normalizes safe project configuration without exposing its key', () => {
    expect(
      loadConfig({
        ...valid,
        UMAMI_MCP_PROJECT: 'TrueLeaf Website',
        UMAMI_MCP_DEFAULT_TIMEZONE: 'Europe/Lisbon',
      }),
    ).toMatchObject({
      baseUrl: 'https://analytics.example.com',
      project: 'trueleaf_website',
      timezone: 'Europe/Lisbon',
    });
  });

  test('rejects invalid endpoint, website, key, and timezone together', () => {
    expect(() =>
      loadConfig({
        UMAMI_MCP_BASE_URL: 'file:///tmp/analytics',
        UMAMI_MCP_WEBSITE_ID: 'website',
        UMAMI_MCP_API_KEY: 'secret',
        UMAMI_MCP_DEFAULT_TIMEZONE: 'Mars/Olympus',
      }),
    ).toThrow(/Invalid Umami MCP configuration/);
  });

  test('requires TLS for remote hosts while allowing exact loopback development URLs', () => {
    expect(() =>
      loadConfig({
        ...valid,
        UMAMI_MCP_BASE_URL: 'http://analytics.example.com',
      }),
    ).toThrow(/must use https/);
    expect(() =>
      loadConfig({
        ...valid,
        UMAMI_MCP_BASE_URL: 'http://127.0.0.1:3000',
      }),
    ).not.toThrow();
    expect(() =>
      loadConfig({
        ...valid,
        UMAMI_MCP_BASE_URL: 'http://localhost:3000',
      }),
    ).not.toThrow();
    expect(() =>
      loadConfig({
        ...valid,
        UMAMI_MCP_BASE_URL: 'http://[::1]:3000',
      }),
    ).not.toThrow();
  });
});
