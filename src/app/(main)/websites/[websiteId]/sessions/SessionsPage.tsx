'use client';
import { Column, Tab, TabList, TabPanel, Tabs } from '@umami/react-zen';
import { type Key, useState } from 'react';
import { WebsiteControls } from '@/app/(main)/websites/[websiteId]/WebsiteControls';
import { Panel } from '@/components/common/Panel';
import { useMessages, useWebsite } from '@/components/hooks';
import { getItem, setItem } from '@/lib/storage';
import { SessionModal } from './SessionModal';
import { SessionProperties } from './SessionProperties';
import { SessionReviewQueue } from './SessionReviewQueue';
import { SessionsDataTable } from './SessionsDataTable';

const KEY_NAME = 'umami.sessions.tab';

export function SessionsPage({
  websiteId,
  reviewsEnabled = false,
}: {
  websiteId: string;
  reviewsEnabled?: boolean;
}) {
  const [tab, setTab] = useState(getItem(KEY_NAME) || 'activity');
  const { t, labels } = useMessages();
  const website = useWebsite();
  const canReview = reviewsEnabled && website.canUpdate;
  const selectedTab = !canReview && tab === 'reviews' ? 'activity' : tab;

  const handleSelect = (value: Key) => {
    setItem(KEY_NAME, value);
    setTab(value);
  };

  return (
    <Column gap="3">
      <WebsiteControls websiteId={websiteId} />
      <SessionModal websiteId={websiteId} reviewsEnabled={canReview} />
      <Panel minWidth="0" width="100%" style={{ overflow: 'hidden' }}>
        <Tabs
          selectedKey={selectedTab}
          onSelectionChange={handleSelect}
          style={{ minWidth: 0, width: '100%' }}
        >
          <TabList>
            <Tab id="activity">{t(labels.activity)}</Tab>
            <Tab id="properties">{t(labels.properties)}</Tab>
            {canReview && <Tab id="reviews">Review queue</Tab>}
          </TabList>
          <TabPanel id="activity" style={{ minWidth: 0, width: '100%' }}>
            <SessionsDataTable websiteId={websiteId} />
          </TabPanel>
          <TabPanel id="properties" style={{ minWidth: 0, width: '100%', overflow: 'hidden' }}>
            <SessionProperties websiteId={websiteId} />
          </TabPanel>
          {canReview && (
            <TabPanel id="reviews" style={{ minWidth: 0, width: '100%', overflow: 'hidden' }}>
              <SessionReviewQueue websiteId={websiteId} />
            </TabPanel>
          )}
        </Tabs>
      </Panel>
    </Column>
  );
}
