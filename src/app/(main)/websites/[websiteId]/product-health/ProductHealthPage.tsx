'use client';

import { Column } from '@umami/react-zen';
import type { ProductCockpitConfig } from '@/lib/product-cockpit/config';
import { ProductCockpit } from '../ProductCockpit';
import { WebsiteControls } from '../WebsiteControls';

export function ProductHealthPage({
  websiteId,
  config,
}: {
  websiteId: string;
  config: ProductCockpitConfig;
}) {
  return (
    <Column gap>
      <WebsiteControls websiteId={websiteId} allowBounceFilter={true} />
      <ProductCockpit websiteId={websiteId} config={config} />
    </Column>
  );
}
