import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { UmamiAgentClient } from './client';
import type { McpConfig } from './config';
import { createServer } from './server';

const config: McpConfig = {
  baseUrl: 'https://analytics.example.com',
  websiteId: 'e79ef216-70ab-48df-addc-596b6e9e65a8',
  apiKey: `umami_sk_${'a'.repeat(43)}`,
  project: 'truleaf',
  timezone: 'Europe/Lisbon',
  timeoutMs: 30_000,
};

describe('Umami MCP server', () => {
  const catalog = vi.fn();
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    catalog.mockResolvedValue({ schemaVersion: '1.0', queryKinds: ['snapshot'] });
    query.mockImplementation(input => Promise.resolve({ schemaVersion: '1.0', query: input }));
  });

  async function connect() {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer(config, { catalog, query } as unknown as UmamiAgentClient);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { client, server };
  }

  test('exposes project-prefixed semantic tools and a live catalog resource', async () => {
    const { client, server } = await connect();
    const tools = await client.listTools();
    expect(tools.tools.map(tool => tool.name)).toEqual([
      'umami_truleaf_catalog',
      'umami_truleaf_snapshot',
      'umami_truleaf_timeseries',
      'umami_truleaf_breakdown',
      'umami_truleaf_product_health',
      'umami_truleaf_content_performance',
      'umami_truleaf_quality',
      'umami_truleaf_moderation_queue',
    ]);

    const resources = await client.listResources();
    expect(resources.resources).toEqual(
      expect.arrayContaining([expect.objectContaining({ uri: 'umami://truleaf/catalog' })]),
    );
    await client.close();
    await server.close();
  });

  test('applies configured timezone/default period and preserves structured JSON', async () => {
    const { client, server } = await connect();
    const response = await client.callTool({
      name: 'umami_truleaf_snapshot',
      arguments: {},
    });

    expect(query).toHaveBeenCalledWith({
      kind: 'snapshot',
      period: { preset: 'week', timezone: 'Europe/Lisbon' },
    });
    expect(response.structuredContent).toMatchObject({
      result: { schemaVersion: '1.0' },
    });
    await client.close();
    await server.close();
  });
});
