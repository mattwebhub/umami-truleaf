import { Column, DataColumn, DataTable, type DataTableProps, Row, Text } from '@umami/react-zen';
import { Avatar } from '@/components/common/Avatar';
import { DateDistance } from '@/components/common/DateDistance';
import Link from '@/components/common/Link';
import { TypeIcon } from '@/components/common/TypeIcon';
import { useFormat, useMessages } from '@/components/hooks';
import { Server } from '@/components/icons';
import {
  isServerSession,
  SERVER_SESSION_DESCRIPTION,
  SERVER_SESSION_NAME,
  ServerSessionAvatar,
} from './ServerSession';

export function SessionsTable({
  websiteId,
  getSessionHref,
  showIdentity = false,
  ...props
}: DataTableProps & {
  websiteId: string;
  getSessionHref?: (row: any) => string;
  showIdentity?: boolean;
}) {
  const { t, labels } = useMessages();
  const { formatValue } = useFormat();

  return (
    <DataTable {...props}>
      <DataColumn id="id" label={t(labels.session)} width={showIdentity ? '240px' : '100px'}>
        {(row: any) => {
          const serverSession = isServerSession(row);
          const displayName =
            row.identityProfile?.displayName ??
            (serverSession ? SERVER_SESSION_NAME : t(labels.unknown));

          return (
            <Link
              href={
                getSessionHref ? getSessionHref(row) : `/websites/${websiteId}/sessions/${row.id}`
              }
            >
              {showIdentity ? (
                <Row alignItems="center" gap="3">
                  {serverSession && !row.identityProfile ? (
                    <ServerSessionAvatar />
                  ) : (
                    <Avatar
                      seed={row.id}
                      size={32}
                      src={
                        row.identityProfile?.hasAvatar
                          ? `/api/websites/${websiteId}/sessions/${row.id}/identity-avatar`
                          : undefined
                      }
                      alt={displayName}
                    />
                  )}
                  <Column>
                    <Text weight="bold">{displayName}</Text>
                    {row.identityProfile?.username ? (
                      <Text color="muted">@{row.identityProfile.username}</Text>
                    ) : (
                      serverSession && <Text color="muted">{SERVER_SESSION_DESCRIPTION}</Text>
                    )}
                  </Column>
                </Row>
              ) : serverSession ? (
                <ServerSessionAvatar />
              ) : (
                <Avatar seed={row.id} size={32} />
              )}
            </Link>
          );
        }}
      </DataColumn>
      <DataColumn id="visits" label={t(labels.visits)} width="80px">
        {(row: any) => (isServerSession(row) ? '—' : row.visits)}
      </DataColumn>
      <DataColumn id="views" label={t(labels.views)} width="80px">
        {(row: any) => (isServerSession(row) ? '—' : row.views)}
      </DataColumn>
      <DataColumn id="events" label={t(labels.events)} width="80px" />
      <DataColumn id="location" label={t(labels.location)} width="200px">
        {(row: any) =>
          isServerSession(row) ? (
            <Row alignItems="center" gap="2">
              <Server aria-hidden size={16} />
              {SERVER_SESSION_NAME}
            </Row>
          ) : (
            <TypeIcon type="country" value={row.country}>
              {row.city ? `${row.city}, ` : ''}
              {formatValue(row.country, 'country')}
            </TypeIcon>
          )
        }
      </DataColumn>
      <DataColumn id="browser" label={t(labels.browser)} width="140px">
        {(row: any) => (
          <TypeIcon type="browser" value={row.browser}>
            {isServerSession(row) ? 'Trusted API' : formatValue(row.browser, 'browser')}
          </TypeIcon>
        )}
      </DataColumn>
      <DataColumn id="os" label={t(labels.os)} width="140px">
        {(row: any) => (
          <TypeIcon type="os" value={row.os}>
            {isServerSession(row) ? 'Server-side' : formatValue(row.os, 'os')}
          </TypeIcon>
        )}
      </DataColumn>
      <DataColumn id="device" label={t(labels.device)} width="140px">
        {(row: any) => (
          <TypeIcon type="device" value={row.device}>
            {isServerSession(row) ? 'Service' : formatValue(row.device, 'device')}
          </TypeIcon>
        )}
      </DataColumn>
      <DataColumn id="lastAt" label={t(labels.lastSeen)} width="140px">
        {(row: any) => <DateDistance date={new Date(row.createdAt)} />}
      </DataColumn>
    </DataTable>
  );
}
