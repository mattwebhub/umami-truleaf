'use client';

import { Button, Column, Heading, Row, Text } from '@umami/react-zen';
import { useState } from 'react';
import Link from '@/components/common/Link';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import { useApi, useNavigation, useWebsite } from '@/components/hooks';

type SessionReview = {
  id: string;
  sessionId: string;
  severity: string;
  reason: string;
  updatedAt: string;
};

export function SessionReviewQueue({ websiteId }: { websiteId: string }) {
  const { get, post, useMutation, useQuery } = useApi();
  const { updateParams } = useNavigation();
  const website = useWebsite();
  const [page, setPage] = useState(0);
  const query = useQuery<{ data: SessionReview[]; page: number; hasMore: boolean }>({
    queryKey: ['session-reviews', { websiteId, status: 'open', page }],
    queryFn: () => get(`/websites/${websiteId}/session-reviews`, { status: 'open', page }),
    enabled: website.canUpdate,
  });
  const resolve = useMutation({
    mutationFn: (reviewId: string) =>
      post(`/websites/${websiteId}/session-reviews/${reviewId}`, {
        status: 'resolved',
      }),
    onSuccess: () => query.refetch(),
  });

  if (!website.canUpdate) return null;

  return (
    <LoadingPanel
      data={query.data}
      isLoading={query.isLoading}
      isFetching={query.isFetching}
      error={query.error}
      minHeight="240px"
    >
      <Column gap>
        {query.data?.data.length ? (
          query.data.data.map(review => (
            <Row
              key={review.id}
              justifyContent="space-between"
              alignItems="center"
              border="bottom"
              paddingY="3"
            >
              <Column gap="1">
                <Row gap="2" alignItems="center">
                  <Heading size="sm">{review.severity.toUpperCase()}</Heading>
                  <Link href={updateParams({ session: review.sessionId })}>
                    Session {review.sessionId.slice(0, 8)}
                  </Link>
                </Row>
                <Text>{review.reason}</Text>
                <Text color="muted" size="sm">
                  Updated {new Date(review.updatedAt).toLocaleString()}
                </Text>
              </Column>
              <Button
                variant="outline"
                isDisabled={resolve.isPending}
                onPress={() => resolve.mutate(review.id)}
              >
                Resolve
              </Button>
            </Row>
          ))
        ) : (
          <Text color="muted">No sessions are waiting for review.</Text>
        )}
        {(page > 0 || query.data?.hasMore) && (
          <Row gap="2" justifyContent="end">
            <Button
              variant="outline"
              isDisabled={page === 0 || query.isFetching}
              onPress={() => setPage(value => Math.max(0, value - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              isDisabled={!query.data?.hasMore || query.isFetching}
              onPress={() => setPage(value => value + 1)}
            >
              Next
            </Button>
          </Row>
        )}
      </Column>
    </LoadingPanel>
  );
}
