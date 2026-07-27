import type { Metadata } from 'next';
import { getProductCockpitConfig } from '@/lib/product-cockpit/config';
import { SessionsPage } from './SessionsPage';

export default async function ({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;

  return (
    <SessionsPage
      websiteId={websiteId}
      reviewsEnabled={Boolean(getProductCockpitConfig(websiteId))}
    />
  );
}

export const metadata: Metadata = {
  title: 'Sessions',
};
