import type { Metadata } from 'next';
import { getProductCockpitConfig } from '@/lib/product-cockpit/config';
import { WebsitePage } from './WebsitePage';

export default async function ({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  const productCockpit = getProductCockpitConfig(websiteId);

  return <WebsitePage websiteId={websiteId} productCockpit={productCockpit} />;
}

export const metadata: Metadata = {
  title: 'Websites',
};
