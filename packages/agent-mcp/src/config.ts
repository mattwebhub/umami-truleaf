import fs from 'node:fs';
import { z } from 'zod';

const configSchema = z
  .object({
    baseUrl: z.url().refine(
      url => {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:') return true;
        return (
          parsed.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
        );
      },
      {
        message: 'must use https (http is allowed only for exact loopback development hosts)',
      },
    ),
    websiteId: z.uuid(),
    apiKey: z.string().startsWith('umami_sk_').min(50),
    project: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .transform(value =>
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, ''),
      )
      .refine(Boolean, 'must contain letters or numbers'),
    timezone: z
      .string()
      .trim()
      .min(1)
      .refine(value => {
        try {
          Intl.DateTimeFormat('en-US', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'must be a valid IANA timezone'),
    timeoutMs: z.number().int().min(1_000).max(120_000),
  })
  .strict();

export type McpConfig = z.infer<typeof configSchema>;

type Environment = Record<string, string | undefined>;

function readApiKey(environment: Environment) {
  if (environment.UMAMI_MCP_API_KEY) return environment.UMAMI_MCP_API_KEY.trim();

  const keyFile = environment.UMAMI_MCP_API_KEY_FILE?.trim();
  if (!keyFile) return '';

  try {
    return fs.readFileSync(keyFile, 'utf8').trim();
  } catch {
    throw new Error(`Unable to read UMAMI_MCP_API_KEY_FILE at ${keyFile}`);
  }
}

export function loadConfig(environment: Environment = process.env): McpConfig {
  const timeout = Number(environment.UMAMI_MCP_TIMEOUT_MS);
  const result = configSchema.safeParse({
    baseUrl: environment.UMAMI_MCP_BASE_URL?.trim().replace(/\/+$/, ''),
    websiteId: environment.UMAMI_MCP_WEBSITE_ID?.trim(),
    apiKey: readApiKey(environment),
    project: environment.UMAMI_MCP_PROJECT?.trim() || 'analytics',
    timezone: environment.UMAMI_MCP_DEFAULT_TIMEZONE?.trim() || 'UTC',
    timeoutMs: Number.isSafeInteger(timeout) && timeout > 0 ? timeout : 30_000,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map(issue => `${issue.path.join('.') || 'configuration'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid Umami MCP configuration: ${issues}`);
  }

  return result.data;
}
