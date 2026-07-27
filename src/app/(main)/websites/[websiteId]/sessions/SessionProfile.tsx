'use client';
import {
  Button,
  Column,
  Icon,
  Row,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  TextField,
} from '@umami/react-zen';
import { X } from 'lucide-react';
import { Avatar } from '@/components/common/Avatar';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import { useMessages, useWebsiteSessionQuery } from '@/components/hooks';
import { SessionActivity } from './SessionActivity';
import { SessionData } from './SessionData';
import { SessionInfo } from './SessionInfo';
import { SessionReplaysDataTable } from './SessionReplaysDataTable';
import { SessionReviewControl } from './SessionReviewControl';
import { SessionStats } from './SessionStats';
import { TruleafModerationPanel } from './TruleafModerationPanel';

export function SessionProfile({
  websiteId,
  sessionId,
  showReplays = true,
  reviewsEnabled = false,
  onClose,
}: {
  websiteId: string;
  sessionId: string;
  showReplays?: boolean;
  reviewsEnabled?: boolean;
  onClose?: () => void;
}) {
  const { data, isLoading, error } = useWebsiteSessionQuery(websiteId, sessionId);
  const { t, labels } = useMessages();

  return (
    <LoadingPanel
      data={data}
      isLoading={isLoading}
      error={error}
      loadingIcon="spinner"
      loadingPlacement="absolute"
    >
      {data && (
        <Column gap>
          {onClose && (
            <Row justifyContent="flex-end">
              <Button onPress={onClose} variant="quiet" aria-label="Close session">
                <Icon>
                  <X />
                </Icon>
              </Button>
            </Row>
          )}
          <Column gap="6">
            <Row justifyContent="center" alignItems="center" gap="6" wrap="wrap">
              <Avatar
                seed={data?.id}
                size={128}
                src={
                  data.identityProfile?.hasAvatar
                    ? `/api/websites/${websiteId}/sessions/${sessionId}/identity-avatar`
                    : undefined
                }
                alt={data.identityProfile?.displayName ?? t(labels.unknown)}
              />
              <Column gap="2" width="100%" maxWidth="420px">
                <Text size="xl" weight="bold">
                  {data.identityProfile?.displayName ?? t(labels.unknown)}
                </Text>
                {data.identityProfile && (
                  <Text color="muted">
                    @{data.identityProfile.username} · {data.identityProfile.role} ·{' '}
                    {data.identityProfile.plan}
                  </Text>
                )}
                <TextField label={t(labels.session)} value={data?.id} allowCopy />
              </Column>
            </Row>
            <SessionStats data={data} />
            <SessionInfo data={data} />
            {reviewsEnabled && (
              <Row justifyContent="flex-end">
                <SessionReviewControl websiteId={websiteId} sessionId={sessionId} />
              </Row>
            )}
            <TruleafModerationPanel websiteId={websiteId} sessionId={sessionId} />

            <Tabs>
              <TabList>
                <Tab id="activity">{t(labels.activity)}</Tab>
                <Tab id="properties">{t(labels.properties)}</Tab>
                {showReplays && <Tab id="replays">{t(labels.replays)}</Tab>}
              </TabList>
              <TabPanel id="activity">
                <SessionActivity
                  websiteId={websiteId}
                  sessionId={sessionId}
                  startDate={data?.firstAt}
                  endDate={data?.lastAt}
                />
              </TabPanel>
              <TabPanel id="properties">
                <SessionData sessionId={sessionId} websiteId={websiteId} />
              </TabPanel>
              {showReplays && (
                <TabPanel id="replays">
                  <SessionReplaysDataTable websiteId={websiteId} sessionId={sessionId} />
                </TabPanel>
              )}
            </Tabs>
          </Column>
        </Column>
      )}
    </LoadingPanel>
  );
}
