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
  const networkAvailable = Boolean(data?.networks?.length);
  const selectedTargetCount = selectedNetworkIds.size + (accountSelected ? 1 : 0);
  const canSubmit =
    (accountSelected && accountAvailable) || (selectedNetworkIds.size > 0 && networkAvailable);

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
              {data.status.targets.map((target, index) => (
                <Text key={target.targetId ?? `${target.type}-${index}`}>
                  {target.displayValue ?? target.type}: {target.banned ? 'banned' : 'not banned'}
                  {target.expiresAt ? ` until ${new Date(target.expiresAt).toLocaleString()}` : ''}
                  {target.vercel ? ` · Vercel: ${target.vercel}` : ''}
                </Text>
              ))}
              <Text>
                {data.networks.length
                  ? `Observed network: ${data.networks
                      .map(network => network.maskedAddress)
                      .join(', ')}`
                  : 'No trusted network observation is available'}
              </Text>
            </Column>
            <Button
              variant="outline"
              isDisabled={!accountAvailable && !networkAvailable}
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
                    {networkAvailable ? (
                      <Column gap="2">
                        <Text weight="bold">Observed networks (select explicitly)</Text>
                        <Text>
                          Selected {selectedTargetCount} of {TRULEAF_MODERATION_TARGET_LIMIT}{' '}
                          targets
                        </Text>
                        {data.networks.map(network => (
                          <Checkbox
                            key={network.id}
                            isSelected={selectedNetworkIds.has(network.id)}
                            isDisabled={isAdditionalTargetDisabled(
                              selectedTargetCount,
                              selectedNetworkIds.has(network.id),
                            )}
                            onChange={selected => {
                              setSelectedNetworkIds(current => {
                                const next = new Set(current);
                                if (selected) next.add(network.id);
                                else next.delete(network.id);
                                return next;
                              });
                            }}
                          >
                            {network.maskedAddress} — last seen{' '}
                            {new Date(network.lastSeenAt).toLocaleString()}
                          </Checkbox>
                        ))}
                      </Column>
                    ) : (
                      <Text>Current network unavailable</Text>
                    )}
                    <Row gap="3">
                      <Button
                        variant={action === 'ban' ? 'primary' : 'outline'}
                        onPress={() => setAction('ban')}
                      >
                        Ban
                      </Button>
                      <Button
                        variant={action === 'unban' ? 'primary' : 'outline'}
                        onPress={() => setAction('unban')}
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
