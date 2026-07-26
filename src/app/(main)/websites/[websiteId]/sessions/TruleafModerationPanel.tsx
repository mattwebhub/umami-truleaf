'use client';
import {
  Button,
  Checkbox,
  Column,
  Dialog,
  Form,
  FormButtons,
  FormField,
  FormSubmitButton,
  Modal,
  Row,
  Text,
  TextField,
  useToast,
} from '@umami/react-zen';
import { ShieldBan } from 'lucide-react';
import { useState } from 'react';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import { useTruleafModerationQuery } from '@/components/hooks/queries/useTruleafModerationQuery';
import { TRULEAF_MODERATION_TARGET_LIMIT } from '@/lib/truleaf/constants';
import type { ModerationActionResponse } from '@/lib/truleaf/service';

export function getModerationResultMessage(status: ModerationActionResponse['status']) {
  return {
    applied: 'Moderation applied',
    partial: 'Moderation partially applied; review target status',
    pending: 'Moderation queued; enforcement is pending',
    failed: 'Moderation failed; no successful enforcement was confirmed',
  }[status];
}

export function canModerateAccount(
  account: { canBan: boolean; canUnban: boolean } | null | undefined,
  action: 'ban' | 'unban',
) {
  return Boolean(action === 'ban' ? account?.canBan : account?.canUnban);
}

export interface NetworkModerationState {
  banned: boolean;
  canBan: boolean;
  canUnban: boolean;
  sourceMatches: boolean;
}

export function canModerateNetwork(network: NetworkModerationState, action: 'ban' | 'unban') {
  return action === 'ban'
    ? network.canBan && !network.banned
    : network.banned && network.sourceMatches && network.canUnban;
}

export function getNetworkModerationStateMessage(network: NetworkModerationState) {
  if (!network.banned) {
    return 'not banned';
  }

  if (!network.sourceMatches) {
    return 'already banned from another session; cannot unban here';
  }

  return network.canUnban
    ? 'banned by this session; unban available'
    : 'banned by this session; unban unavailable';
}

export function isAdditionalTargetDisabled(selectedTargetCount: number, isSelected: boolean) {
  return !isSelected && selectedTargetCount >= TRULEAF_MODERATION_TARGET_LIMIT;
}

export function TruleafModerationPanel({
  websiteId,
  sessionId,
}: {
  websiteId: string;
  sessionId: string;
}) {
  const { data, isLoading, error, mutation } = useTruleafModerationQuery(websiteId, sessionId);
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [accountSelected, setAccountSelected] = useState(false);
  const [selectedNetworkIds, setSelectedNetworkIds] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<'ban' | 'unban'>('ban');
  const accountAvailable = canModerateAccount(data?.account, action);
  const hasAnyModeration = Boolean(
    data &&
      (canModerateAccount(data.account, 'ban') ||
        canModerateAccount(data.account, 'unban') ||
        data.networks.some(
          network => canModerateNetwork(network, 'ban') || canModerateNetwork(network, 'unban'),
        )),
  );
  const selectedTargetCount = selectedNetworkIds.size + (accountSelected ? 1 : 0);
  const selectedNetworksAreEligible = [...selectedNetworkIds].every(networkId => {
    const network = data?.networks.find(candidate => candidate.id === networkId);
    return Boolean(network && canModerateNetwork(network, action));
  });
  const canSubmit =
    (accountSelected || selectedNetworkIds.size > 0) &&
    (!accountSelected || accountAvailable) &&
    selectedNetworksAreEligible;

  const changeAction = (nextAction: 'ban' | 'unban') => {
    if (nextAction === action) return;
    setAction(nextAction);
    // Capabilities differ by action. Require a fresh, explicit selection so a
    // stale Ban target cannot be submitted as an incompatible Unban target.
    setAccountSelected(false);
    setSelectedNetworkIds(new Set());
  };

  const handleSubmit = async (values: { reason?: string; expiresAt?: string }) => {
    const targetTypes: Array<'account' | 'ip'> = [];

    if (accountSelected) targetTypes.push('account');
    if (selectedNetworkIds.size) targetTypes.push('ip');

    await mutation.mutateAsync(
      {
        requestId: crypto.randomUUID(),
        action,
        targetTypes,
        networkIds: [...selectedNetworkIds],
        reason: values.reason,
        expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : undefined,
      },
      {
        onSuccess: result => {
          toast(getModerationResultMessage(result.status));
          if (result.status !== 'failed') {
            setShowDialog(false);
          }
        },
      },
    );
  };

  if (error && (error as any)?.status === 401) {
    return null;
  }

  return (
    <LoadingPanel data={data} isLoading={isLoading} error={error}>
      {data && (
        <Column gap="3">
          <Row justifyContent="space-between" alignItems="center">
            <Column gap="1">
              <Text weight="bold">Truleaf moderation</Text>
              <Text>
                {data.account
                  ? data.account.canBan || data.account.canUnban
                    ? `Verified account: ${data.account.displayValue}`
                    : 'Account candidate is not currently authorized for moderation'
                  : 'Anonymous session'}
              </Text>
              {data.networks.length ? (
                data.networks.map(network => (
                  <Text key={network.id}>
                    {network.maskedAddress}: {getNetworkModerationStateMessage(network)}
                    {network.banExpiresAt
                      ? ` until ${new Date(network.banExpiresAt).toLocaleString()}`
                      : ''}
                    {network.vercel !== 'not_applicable' ? ` · Vercel: ${network.vercel}` : ''}
                  </Text>
                ))
              ) : (
                <Text>No trusted network observation is available</Text>
              )}
            </Column>
            <Button
              variant="outline"
              isDisabled={!hasAnyModeration}
              onPress={() => setShowDialog(true)}
            >
              <ShieldBan size={16} />
              Moderate
            </Button>
          </Row>

          <Modal isOpen={showDialog} onOpenChange={setShowDialog} isDismissable>
            <Dialog title="Moderate Truleaf access" style={{ width: 520, padding: 32 }}>
              {({ close }) => (
                <Form onSubmit={handleSubmit} error={mutation.error?.message}>
                  <Column gap="3">
                    <Text>
                      IP blocks are best-effort. Shared, mobile, or rotating addresses can affect
                      other people and can be bypassed by changing networks.
                    </Text>
                    <Checkbox
                      isSelected={accountSelected}
                      isDisabled={
                        !accountAvailable ||
                        isAdditionalTargetDisabled(selectedTargetCount, accountSelected)
                      }
                      onChange={setAccountSelected}
                    >
                      {accountAvailable
                        ? `Account ${data.account?.displayValue}`
                        : `Account (${action} is not authorized by Truleaf)`}
                    </Checkbox>
                    {data.networks.length ? (
                      <Column gap="2">
                        <Text weight="bold">Observed networks (select explicitly)</Text>
                        <Text>
                          Selected {selectedTargetCount} of {TRULEAF_MODERATION_TARGET_LIMIT}{' '}
                          targets
                        </Text>
                        {data.networks.map(network => {
                          const isSelected = selectedNetworkIds.has(network.id);
                          const isEligible = canModerateNetwork(network, action);

                          return (
                            <Checkbox
                              key={network.id}
                              isSelected={isSelected}
                              isDisabled={
                                !isEligible ||
                                isAdditionalTargetDisabled(selectedTargetCount, isSelected)
                              }
                              onChange={selected => {
                                setSelectedNetworkIds(current => {
                                  const next = new Set(current);
                                  if (selected) next.add(network.id);
                                  else next.delete(network.id);
                                  return next;
                                });
                              }}
                            >
                              {network.maskedAddress} — {getNetworkModerationStateMessage(network)}{' '}
                              · last seen {new Date(network.lastSeenAt).toLocaleString()}
                            </Checkbox>
                          );
                        })}
                      </Column>
                    ) : (
                      <Text>Current network unavailable</Text>
                    )}
                    <Row gap="3">
                      <Button
                        variant={action === 'ban' ? 'primary' : 'outline'}
                        onPress={() => changeAction('ban')}
                      >
                        Ban
                      </Button>
                      <Button
                        variant={action === 'unban' ? 'primary' : 'outline'}
                        onPress={() => changeAction('unban')}
                      >
                        Unban
                      </Button>
                    </Row>
                    {action === 'ban' && (
                      <>
                        <FormField
                          name="reason"
                          label="Reason"
                          rules={{
                            required: 'A reason is required',
                            minLength: { value: 3, message: 'Use at least 3 characters' },
                          }}
                        >
                          <TextField asTextArea />
                        </FormField>
                        <FormField name="expiresAt" label="Expires at (optional)">
                          <TextField type="datetime-local" />
                        </FormField>
                      </>
                    )}
                    <FormButtons>
                      <Button
                        isDisabled={mutation.isPending}
                        onPress={() => {
                          setShowDialog(false);
                          close();
                        }}
                      >
                        Cancel
                      </Button>
                      <FormSubmitButton
                        variant={action === 'ban' ? 'danger' : 'primary'}
                        isDisabled={!canSubmit || mutation.isPending}
                      >
                        Confirm {action}
                      </FormSubmitButton>
                    </FormButtons>
                  </Column>
                </Form>
              )}
            </Dialog>
          </Modal>
        </Column>
      )}
    </LoadingPanel>
  );
}
