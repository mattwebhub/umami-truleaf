import { z } from 'zod';

export const websiteBrandIds = ['truleaf'] as const;
export type WebsiteBrandId = (typeof websiteBrandIds)[number];

const brandingConfigSchema = z.object({
  websites: z
    .array(
      z.object({
        websiteId: z.uuid(),
        profile: z.enum(websiteBrandIds),
      }),
    )
    .max(100),
});

let cachedSource: string | undefined;
let cachedConfig: z.infer<typeof brandingConfigSchema> | null = null;

export function getWebsiteBrand(
  websiteId: string,
  source = process.env.WEBSITE_BRANDING_CONFIG,
): WebsiteBrandId | null {
  if (!source) {
    return null;
  }

  if (source !== cachedSource) {
    cachedSource = source;
    try {
      cachedConfig = brandingConfigSchema.parse(JSON.parse(source));
    } catch {
      cachedConfig = null;
      console.error('Invalid WEBSITE_BRANDING_CONFIG; website branding disabled');
    }
  }

  return cachedConfig?.websites.find(config => config.websiteId === websiteId)?.profile ?? null;
}
