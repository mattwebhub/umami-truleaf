'use client';

import { Button } from '@umami/react-zen';
import { MessageCircle } from 'lucide-react';

export function getTruleafChatHref({
  baseUrl,
  distinctId,
  hasVerifiedAccount,
}: {
  baseUrl: string;
  distinctId?: string | null;
  hasVerifiedAccount: boolean;
}) {
  if (!distinctId) return null;
  const url = new URL('/admin/chat', baseUrl);
  url.searchParams.set('targetType', hasVerifiedAccount ? 'account' : 'visitor');
  url.searchParams.set('targetId', distinctId);
  return url.toString();
}

export function TruleafChatButton({
  distinctId,
  hasVerifiedAccount,
}: {
  distinctId?: string | null;
  hasVerifiedAccount: boolean;
}) {
  const href = getTruleafChatHref({
    baseUrl: process.env.NEXT_PUBLIC_TRULEAF_URL ?? 'https://truleaf.org',
    distinctId,
    hasVerifiedAccount,
  });

  if (!href) return null;

  return (
    <Button variant="primary" onPress={() => window.location.assign(href)}>
      <MessageCircle size={16} />
      Chat in Truleaf
    </Button>
  );
}
