'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Column,
  Dialog,
  Heading,
  Label,
  Modal,
  Row,
  Slider,
  Text,
  TextField,
  useToast,
} from '@umami/react-zen';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import { Panel } from '@/components/common/Panel';
import { useApi } from '@/components/hooks';

type Rollout = {
  key: string;
  name: string;
  treatmentPercent: number;
  revision: string | null;
  updatedAt: string | null;
};

type Draft = {
  key: string;
  name: string;
  treatmentPercent: number;
  expectedRevision: string | null;
  isExisting: boolean;
};

const EXPERIMENT_KEY = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function ExperimentRollouts({ websiteId }: { websiteId: string }) {
  const path = `/websites/${websiteId}/experiments`;
  const queryKey = useMemo(() => ['experiment-rollouts', websiteId], [websiteId]);
  const queryClient = useQueryClient();
  const { get, post, put, useQuery, useMutation } = useApi();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const query = useQuery<{ rollouts: Rollout[]; needsBootstrap: boolean }>({
    queryKey,
    queryFn: () => get(path),
    retry: false,
  });
  const bootstrapTriggered = useRef(false);
  const bootstrap = useMutation({
    mutationFn: () => post(path),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  useEffect(() => {
    if (query.data?.needsBootstrap && !bootstrapTriggered.current) {
      bootstrapTriggered.current = true;
      bootstrap.mutate();
    }
  }, [query.data?.needsBootstrap, bootstrap.mutate]);
  const save = useMutation({
    mutationFn: (value: Draft) =>
      put(path, {
        key: value.key,
        name: value.name,
        treatmentPercent: value.treatmentPercent,
        expectedRevision: value.expectedRevision,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setDraft(null);
      toast('Experiment rollout saved');
    },
  });

  const valid = Boolean(
    draft &&
      EXPERIMENT_KEY.test(draft.key) &&
      draft.name.trim().length > 0 &&
      draft.name.trim().length <= 120 &&
      Number.isInteger(draft.treatmentPercent) &&
      draft.treatmentPercent >= 0 &&
      draft.treatmentPercent <= 100,
  );

  return (
    <Panel>
      <Column gap="4">
        <Row justifyContent="space-between" alignItems="center" gap="4">
          <Column gap="1">
            <Heading size="lg">A/B rollouts</Heading>
            <Text color="muted">
              Set the share of readers assigned to each treatment. Changes reach the site within
              about a minute.
            </Text>
          </Column>
          <Button
            variant="primary"
            onPress={() => {
              save.reset();
              setDraft({
                key: '',
                name: '',
                treatmentPercent: 50,
                expectedRevision: null,
                isExisting: false,
              });
            }}
          >
            Add experiment
          </Button>
        </Row>

        <LoadingPanel
          data={query.data}
          isLoading={query.isLoading}
          error={query.error}
          minHeight="80px"
        >
          {query.data?.rollouts.length ? (
            <Column gap="3">
              {query.data.rollouts.map(rollout => (
                <Row key={rollout.key} justifyContent="space-between" alignItems="center" gap="4">
                  <Column gap="1">
                    <Text weight="bold">{rollout.name}</Text>
                    <Text color="muted" size="sm">
                      {rollout.key}
                      {rollout.updatedAt
                        ? ` · updated ${new Date(rollout.updatedAt).toLocaleString()}`
                        : ' · initial allocation'}
                    </Text>
                  </Column>
                  <Row gap="3" alignItems="center">
                    <Text weight="bold">{rollout.treatmentPercent}% treatment</Text>
                    <Button
                      onPress={() => {
                        save.reset();
                        setDraft({
                          ...rollout,
                          expectedRevision: rollout.revision,
                          isExisting: true,
                        });
                      }}
                    >
                      Edit
                    </Button>
                  </Row>
                </Row>
              ))}
            </Column>
          ) : (
            <Text color="muted">
              No experiments configured yet. Add an experiment to publish its allocation.
            </Text>
          )}
        </LoadingPanel>
        {bootstrap.error && (
          <Row gap="2" alignItems="center">
            <Text color="red">Could not initialize the starter rollout.</Text>
            <Button onPress={() => bootstrap.mutate()} isDisabled={bootstrap.isPending}>
              Retry
            </Button>
          </Row>
        )}
      </Column>

      <Modal isOpen={Boolean(draft)} onOpenChange={open => !open && setDraft(null)} isDismissable>
        <Dialog title={draft?.isExisting ? 'Edit A/B rollout' : 'Add A/B rollout'}>
          {draft && (
            <Column gap="4">
              <Column gap="1">
                <Label>Experiment key</Label>
                <TextField
                  value={draft.key}
                  onChange={key => setDraft(current => current && { ...current, key })}
                  isReadOnly={draft.isExisting}
                  placeholder="insight-signup-v1"
                  maxLength={80}
                />
                <Text color="muted" size="sm">
                  Lowercase letters, numbers and hyphens. Keep this key stable after launch.
                </Text>
              </Column>
              <Column gap="1">
                <Label>Display name</Label>
                <TextField
                  value={draft.name}
                  onChange={name => setDraft(current => current && { ...current, name })}
                  placeholder="Insights one-click signup"
                  maxLength={120}
                />
              </Column>
              <Slider
                label="Treatment allocation"
                minValue={0}
                maxValue={100}
                step={1}
                value={draft.treatmentPercent}
                onChange={value =>
                  setDraft(
                    current =>
                      current && {
                        ...current,
                        treatmentPercent: Array.isArray(value) ? value[0] : value,
                      },
                  )
                }
                showValue
              />
              <Text color="muted" size="sm">
                {draft.treatmentPercent}% treatment · {100 - draft.treatmentPercent}% control
              </Text>
              {save.error && <Text color="red">{save.error.message}</Text>}
              <Row justifyContent="flex-end" gap="2">
                <Button onPress={() => setDraft(null)} isDisabled={save.isPending}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  isDisabled={!valid || save.isPending}
                  onPress={() => save.mutate(draft)}
                >
                  {save.isPending ? 'Saving…' : 'Save rollout'}
                </Button>
              </Row>
            </Column>
          )}
        </Dialog>
      </Modal>
    </Panel>
  );
}
