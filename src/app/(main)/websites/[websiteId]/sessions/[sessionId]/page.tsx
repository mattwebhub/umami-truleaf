import type { Metadata } from 'next';
import { SessionProfile } from '@/app/(main)/websites/[websiteId]/sessions/SessionProfile';
import { getProductCockpitConfig } from '@/lib/product-cockpit/config';

export default async function ({
  params,
}: {
  params: Promise<{ websiteId: string; sessionId: string }>;
}) {
  const { websiteId, sessionId } = await params;

  return (
    <SessionProfile
      websiteId={websiteId}
      sessionId={sessionId}
      reviewsEnabled={Boolean(getProductCockpitConfig(websiteId))}
    />
  );
}

export const metadata: Metadata = {
  title: 'Session',
};
