import { Column, DataColumn, DataTable, type DataTableProps, Row, Text } from '@umami/react-zen';
import { Avatar } from '@/components/common/Avatar';
import { DateDistance } from '@/components/common/DateDistance';
import Link from '@/components/common/Link';
import { TypeIcon } from '@/components/common/TypeIcon';
import { useFormat, useMessages } from '@/components/hooks';

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
        {(row: any) => (
          <Link
            href={
              getSessionHref ? getSessionHref(row) : `/websites/${websiteId}/sessions/${row.id}`
            }
          >
            {showIdentity ? (
              <Row alignItems="center" gap="3">
                <Avatar
                  seed={row.id}
                  size={32}
                  src={
                    row.identityProfile?.hasAvatar
                      ? `/api/websites/${websiteId}/sessions/${row.id}/identity-avatar`
                      : undefined
                  }
                  alt={row.identityProfile?.displayName ?? t(labels.unknown)}
                />
                <Column>
                  <Text weight="bold">{row.identityProfile?.displayName ?? t(labels.unknown)}</Text>
                  {row.identityProfile?.username && (
                    <Text color="muted">@{row.identityProfile.username}</Text>
                  )}
                </Column>
              </Row>
            ) : (
              <Avatar seed={row.id} size={32} />
            )}
          </Link>
        )}
      </DataColumn>
      <DataColumn id="visits" label={t(labels.visits)} width="80px" />
      <DataColumn id="views" label={t(labels.views)} width="80px" />
      <DataColumn id="events" label={t(labels.events)} width="80px" />
      <DataColumn id="location" label={t(labels.location)} width="200px">
        {(row: any) => (
          <TypeIcon type="country" value={row.country}>
            {row.city ? `${row.city}, ` : ''}
            {formatValue(row.country, 'country')}
          </TypeIcon>
        )}
      </DataColumn>
      <DataColumn id="browser" label={t(labels.browser)} width="140px">
        {(row: any) => (
          <TypeIcon type="browser" value={row.browser}>
            {formatValue(row.browser, 'browser')}
          </TypeIcon>
        )}
      </DataColumn>
      <DataColumn id="os" label={t(labels.os)} width="140px">
        {(row: any) => (
          <TypeIcon type="os" value={row.os}>
            {formatValue(row.os, 'os')}
          </TypeIcon>
        )}
      </DataColumn>
      <DataColumn id="device" label={t(labels.device)} width="140px">
        {(row: any) => (
          <TypeIcon type="device" value={row.device}>
            {formatValue(row.device, 'device')}
          </TypeIcon>
        )}
      </DataColumn>
      <DataColumn id="lastAt" label={t(labels.lastSeen)} width="140px">
        {(row: any) => <DateDistance date={new Date(row.createdAt)} />}
      </DataColumn>
    </DataTable>
  );
}
