'use client';
import { Column, Row } from '@umami/react-zen';
import { ExpandedViewModal } from '@/app/(main)/websites/[websiteId]/ExpandedViewModal';
import { Panel } from '@/components/common/Panel';
import { UnitFilter } from '@/components/input/UnitFilter';
import type { ProductCockpitConfig } from '@/lib/product-cockpit/config';
import { ProductCockpit } from './ProductCockpit';
import { WebsiteChart } from './WebsiteChart';
import { WebsiteControls } from './WebsiteControls';
import { WebsiteMetricsBar } from './WebsiteMetricsBar';
import { WebsitePanels } from './WebsitePanels';

export function WebsitePage({
  websiteId,
  productCockpit,
}: {
  websiteId: string;
  productCockpit?: ProductCockpitConfig | null;
}) {
  return (
    <Column gap>
      <WebsiteControls websiteId={websiteId} allowBounceFilter={true} />
      {productCockpit && <ProductCockpit websiteId={websiteId} config={productCockpit} />}
      <WebsiteMetricsBar websiteId={websiteId} showChange={true} />
      <Panel minHeight="520px">
        <Row justifyContent="end">
          <UnitFilter />
        </Row>
        <WebsiteChart websiteId={websiteId} />
      </Panel>
      <WebsitePanels websiteId={websiteId} />
      <ExpandedViewModal websiteId={websiteId} />
    </Column>
  );
}
