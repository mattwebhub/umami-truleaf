import { useQueryClient } from '@tanstack/react-query';
import type { ModerationBrowserActionResponse } from '@/lib/truleaf/service';
import { useApi } from '../useApi';

export interface TruleafModerationData {
  account: {
    displayValue: string;
    banned: boolean;
    canBan: boolean;
    canUnban: boolean;
    expiresAt?: string | null;
  } | null;
  networks: Array<{
    id: string;
    maskedAddress: string;
    addressFamily: number;
    firstSeenAt: string;
    lastSeenAt: string;
    expiresAt: string;
    banned: boolean;
    canBan: boolean;
    canUnban: boolean;
    sourceMatches: boolean;
    banExpiresAt?: string | null;
    vercel: 'applied' | 'pending' | 'failed' | 'not_applicable';
  }>;
}

export function useTruleafModerationQuery(websiteId: string, sessionId: string) {
  const path = `/websites/${websiteId}/sessions/${sessionId}/truleaf-moderation`;
  const { get, post, useQuery, useMutation } = useApi();
  const queryClient = useQueryClient();
  const queryKey = ['truleaf-moderation', { websiteId, sessionId }];
  const query = useQuery<TruleafModerationData>({
    queryKey,
    queryFn: () => get(path),
    retry: false,
  });
  const mutation = useMutation<
    ModerationBrowserActionResponse,
    Error,
    {
      requestId: string;
      action: 'ban' | 'unban';
      targetTypes: Array<'account' | 'ip'>;
      networkIds: string[];
      reason?: string;
      expiresAt?: string;
    }
  >({
    mutationFn: data => post(path, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return { ...query, mutation };
}
