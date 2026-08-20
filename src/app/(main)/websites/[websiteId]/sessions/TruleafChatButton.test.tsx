import { describe, expect, test } from 'vitest';
import { getTruleafChatHref } from './TruleafChatButton';

describe('Truleaf session chat link', () => {
  test('targets a verified signed-in account', () => {
    expect(
      getTruleafChatHref({
        baseUrl: 'https://truleaf.org',
        distinctId: '507f1f77bcf86cd799439011',
        hasVerifiedAccount: true,
      }),
    ).toBe('https://truleaf.org/admin/chat?targetType=account&targetId=507f1f77bcf86cd799439011');
  });

  test('targets an opaque anonymous visitor ID', () => {
    expect(
      getTruleafChatHref({
        baseUrl: 'https://truleaf.org/',
        distinctId: '11111111-1111-4111-8111-111111111111',
        hasVerifiedAccount: false,
      }),
    ).toBe(
      'https://truleaf.org/admin/chat?targetType=visitor&targetId=11111111-1111-4111-8111-111111111111',
    );
  });

  test('does not offer chat for legacy anonymous sessions with no correlatable ID', () => {
    expect(
      getTruleafChatHref({
        baseUrl: 'https://truleaf.org',
        distinctId: null,
        hasVerifiedAccount: false,
      }),
    ).toBeNull();
  });
});
