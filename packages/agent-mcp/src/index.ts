#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config';
import { createServer } from './server';

async function main() {
  const config = loadConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  await server.connect(transport);
  console.error(`Umami MCP ready for project "${config.project}"`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Unable to start Umami MCP');
  process.exit(1);
});
