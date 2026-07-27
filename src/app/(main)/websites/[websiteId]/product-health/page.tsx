import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProductCockpitConfig } from '@/lib/product-cockpit/config';
import { ProductHealthPage } from './ProductHealthPage';

export default async function ({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  const config = getProductCockpitConfig(websiteId);

  if (!config) {
    notFound();
  }

  return <ProductHealthPage websiteId={websiteId} config={config} />;
}

export const metadata: Metadata = {
  title: 'Product health',
};
