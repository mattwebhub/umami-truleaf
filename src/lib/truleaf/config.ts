const TRUE_VALUES = new Set(['1', 'true', 'yes']);

function enabled(value: string | undefined) {
  return TRUE_VALUES.has(value?.toLowerCase() ?? '');
}

function csv(value: string | undefined) {
  return new Set(
    (value ?? '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean),
  );
}

export function isTruleafModerationEnabled() {
  return enabled(process.env.TRULEAF_MODERATION_ENABLED);
}

export function isTruleafNetworkCaptureEnabled() {
  return enabled(process.env.TRULEAF_NETWORK_CAPTURE_ENABLED);
}

export function isTruleafWebsite(websiteId: string) {
  return csv(process.env.TRULEAF_WEBSITE_IDS).has(websiteId);
}

export function isTruleafModerationOperator(userId: string) {
  return csv(process.env.TRULEAF_MODERATION_OPERATOR_IDS).has(userId);
}

export function getTruleafNetworkRetentionDays() {
  const value = Number(process.env.TRULEAF_NETWORK_RETENTION_DAYS ?? 30);

  return Number.isInteger(value) && value > 0 && value <= 365 ? value : 30;
}
