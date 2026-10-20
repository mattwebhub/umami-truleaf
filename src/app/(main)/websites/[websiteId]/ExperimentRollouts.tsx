'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Column,
  Dialog,
  Grid,
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
import { useApi, useDateParameters } from '@/components/hooks';

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

type Result = {
  variant: string;
  revision: string;
  lastExposureAt: string;
  exposures: number;
  signups: number;
  verifiedSignups: number;
  logins: number;
  dismissals: number;
  authSelected: number;
  engaged: number;
  gateShown: number;
};

const rate = (count: number, total: number) =>
  total ? `${((count / total) * 100).toFixed(1)}%` : '—';

const EXPERIMENT_KEY = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function ExperimentRollouts({ websiteId }: { websiteId: string }) {
  const path = `/websites/${websiteId}/experiments`;
  const queryKey = useMemo(() => ['experiment-rollouts', websiteId], [websiteId]);
  const queryClient = useQueryClient();
  const { get, post, put, useQuery, useMutation } = useApi();
  const { startAt, endAt, timezone, unit } = useDateParameters();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<string | null>(null);
  const query = useQuery<{ rollouts: Rollout[]; needsBootstrap: boolean }>({
    queryKey,
    queryFn: () => get(path),
    retry: false,
  });
  const experimentKey = selectedKey ?? query.data?.rollouts[0]?.key;
  const resultsQuery = useQuery<{ results: Result[]; observationHours: number }>({
    queryKey: ['experiment-results', websiteId, experimentKey, startAt, endAt, timezone, unit],
    queryFn: () =>
      get(`/websites/${websiteId}/experiments/results`, {
        experiment: experimentKey,
        startAt,
        endAt,
        timezone,
        unit,
      }),
    enabled: Boolean(experimentKey),
  });
  const selectedRollout = query.data?.rollouts.find(row => row.key === experimentKey);
  const revisions = [...new Set(resultsQuery.data?.results.map(row => row.revision) ?? [])];
  const revision =
    selectedRevision && revisions.includes(selectedRevision)
      ? selectedRevision
      : (selectedRollout?.revision ?? revisions[0]);
  const resultRows = resultsQuery.data?.results.filter(row => row.revision === revision) ?? [];
  const control = resultRows.find(row => row.variant === 'control');
  const treatment = resultRows.find(row => row.variant !== 'control');
  const variants =
    experimentKey === 'insight-signup-v1'
      ? ['control', 'one-click-modal']
      : [...new Set(resultRows.map(row => row.variant))];
  const signupLift =
    control?.exposures && treatment?.exposures
      ? (treatment.signups / treatment.exposures - control.signups / control.exposures) * 100
      : null;
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

        {query.data?.rollouts.length ? (
          <Column gap="3">
            <Row gap="2" alignItems="center">
              <Text weight="bold">Results</Text>
              {query.data.rollouts.map(rollout => (
                <Button
                  key={rollout.key}
                  variant={rollout.key === experimentKey ? 'primary' : undefined}
                  onPress={() => {
                    setSelectedKey(rollout.key);
                    setSelectedRevision(null);
                  }}
                >
                  {rollout.name}
                </Button>
              ))}
            </Row>
            <Text color="muted" size="sm">
              Matched anonymous exposures in the selected date range, observed for a full 24 hours.
              Recent exposures are held back until their outcome window closes. Older events without
              an opportunity ID are excluded. Conversions in another browser tab are not attributed.
            </Text>
            {(selectedRollout?.treatmentPercent ?? 0) > 80 && (
              <Text color="muted" size="sm">
                At {selectedRollout?.treatmentPercent}% treatment, the control sample builds slowly.
              </Text>
            )}
            <LoadingPanel
              data={resultsQuery.data}
              isLoading={resultsQuery.isLoading}
              error={resultsQuery.error}
              minHeight="80px"
            >
              {revisions.length ? (
                <Column gap="3">
                  {(revisions.length > 1 || !revision || !revisions.includes(revision)) && (
                    <Row gap="2" alignItems="center">
                      <Text color="muted" size="sm">
                        Rollout revision
                      </Text>
                      {selectedRollout?.revision && (
                        <Button
                          variant={revision === selectedRollout.revision ? 'primary' : undefined}
                          onPress={() => setSelectedRevision(null)}
                        >
                          Current · {selectedRollout.revision.slice(0, 8)}
                        </Button>
                      )}
                      {revisions
                        .filter(value => value !== selectedRollout?.revision)
                        .map(value => (
                          <Button
                            key={value}
                            variant={revision === value ? 'primary' : undefined}
                            onPress={() => setSelectedRevision(value)}
                          >
                            {value.slice(0, 8)}
                          </Button>
                        ))}
                    </Row>
                  )}
                  {resultRows.length ? (
                    <Grid columns="repeat(auto-fit, minmax(240px, 1fr))" gap="3">
                      {variants.map(variant => {
                        const row = resultRows.find(item => item.variant === variant);
                        const total = row?.exposures ?? 0;
                        const signups = row?.signups ?? 0;
                        return (
                          <Panel key={variant}>
                            <Column gap="2">
                              <Heading size="lg">
                                {variant === 'control'
                                  ? experimentKey === 'insight-signup-v1'
                                    ? 'Control · 40% gate'
                                    : 'Control'
                                  : variant === 'one-click-modal'
                                    ? 'One-click modal'
                                    : variant}
                              </Heading>
                              <Text>{total.toLocaleString()} mature exposures</Text>
                              <Text weight="bold">
                                {signups.toLocaleString()} signups · {rate(signups, total)}
                              </Text>
                              <Text color="muted" size="sm">
                                {(row?.verifiedSignups ?? 0).toLocaleString()} verified within 24h ·{' '}
                                {rate(row?.verifiedSignups ?? 0, signups)} of signups
                              </Text>
                              <Text color="muted" size="sm">
                                {(total - signups).toLocaleString()} without signup in 24h ·{' '}
                                {rate(total - signups, total)}
                              </Text>
                              <Text color="muted" size="sm">
                                {(row?.engaged ?? 0).toLocaleString()} read for 10s ·{' '}
                                {rate(row?.engaged ?? 0, total)}
                              </Text>
                              <Text color="muted" size="sm">
                                {(row?.logins ?? 0).toLocaleString()} logins ·{' '}
                                {rate(row?.logins ?? 0, total)}
                              </Text>
                              <Text color="muted" size="sm">
                                {(row?.gateShown ?? 0).toLocaleString()} gate shown ·{' '}
                                {(row?.dismissals ?? 0).toLocaleString()} dismissed ·{' '}
                                {(row?.authSelected ?? 0).toLocaleString()} selected auth
                              </Text>
                            </Column>
                          </Panel>
                        );
                      })}
                    </Grid>
                  ) : (
                    <Text color="muted">No completed 24-hour exposures for this revision yet.</Text>
                  )}
                  {signupLift !== null && (
                    <Text weight="bold">
                      Observed signup difference: {signupLift >= 0 ? '+' : ''}
                      {signupLift.toFixed(1)}
                      percentage points for the modal. This is not a significance test.
                    </Text>
                  )}
                  <Text color="muted" size="sm">
                    Created accounts are browser-attributed; verification is a trusted backend fact
                    linked to that account and may undercount during analytics outages. Dismissal
                    can overlap with signup. Compare rates only within the same revision.
                  </Text>
                </Column>
              ) : (
                <Text color="muted">
                  No completed 24-hour exposure windows in this date range yet.
                </Text>
              )}
            </LoadingPanel>
          </Column>
        ) : null}
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
