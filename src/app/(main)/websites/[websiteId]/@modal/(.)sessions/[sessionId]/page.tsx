import { SessionProfileModal } from '@/app/(main)/websites/[websiteId]/sessions/SessionProfileModal';
import { getProductCockpitConfig } from '@/lib/product-cockpit/config';

export default async function ({
  params,
}: {
  params: Promise<{ websiteId: string; sessionId: string }>;
}) {
  const { websiteId, sessionId } = await params;

  return (
    <SessionProfileModal
      websiteId={websiteId}
      sessionId={sessionId}
      reviewsEnabled={Boolean(getProductCockpitConfig(websiteId))}
    />
  );
}
