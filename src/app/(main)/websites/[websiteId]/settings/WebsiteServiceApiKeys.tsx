'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Checkbox,
  Column,
  Dialog,
  Label,
  ListItem,
  Modal,
  Row,
  Select,
  Text,
  TextField,
  useToast,
} from '@umami/react-zen';
import { useMemo, useState } from 'react';
import { DateDistance } from '@/components/common/DateDistance';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import { useApi, useWebsite } from '@/components/hooks';

type Scope =
  | 'analytics:summary:read'
  | 'analytics:product:read'
  | 'analytics:content:read'
  | 'analytics:quality:read'
  | 'moderation:read';

type ServiceApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: Scope[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type ServiceApiKeyList = {
  keys: ServiceApiKey[];
  availableScopes: Scope[];
};

const SCOPE_LABELS: Record<Scope, string> = {
  'analytics:summary:read': 'Traffic summary and breakdowns',
  'analytics:product:read': 'Product health, funnels, goals, and retention',
  'analytics:content:read': 'Content performance',
  'analytics:quality:read': 'Experience quality and Core Web Vitals',
  'moderation:read': 'Current moderation review queue',
};

function getStatus(key: ServiceApiKey) {
  if (key.revokedAt) return 'Revoked';
  if (key.expiresAt && new Date(key.expiresAt) <= new Date()) return 'Expired';
  return 'Active';
}

export function WebsiteServiceApiKeys({ websiteId }: { websiteId: string }) {
  const path = `/websites/${websiteId}/service-api-keys`;
  const website = useWebsite();
  const queryClient = useQueryClient();
  const { get, post, del, useQuery, useMutation } = useApi();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [name, setName] = useState('Local MCP');
  const [expiry, setExpiry] = useState('365');
  const [selectedScopes, setSelectedScopes] = useState<Set<Scope>>(
    new Set([
      'analytics:summary:read',
      'analytics:product:read',
      'analytics:content:read',
      'analytics:quality:read',
    ]),
  );
  const [revokeKey, setRevokeKey] = useState<ServiceApiKey | null>(null);
  const queryKey = useMemo(() => ['service-api-keys', websiteId], [websiteId]);
  const query = useQuery<ServiceApiKeyList>({
    queryKey,
    queryFn: () => get(path),
    enabled: Boolean(website?.canUpdate),
    retry: false,
  });
  const createMutation = useMutation({
    mutationFn: () => {
      const expiresAt =
        expiry === 'never'
          ? null
          : new Date(Date.now() + Number(expiry) * 24 * 60 * 60 * 1000).toISOString();
      return post(path, {
        name: name.trim(),
        scopes: [...selectedScopes],
        expiresAt,
      });
    },
    onSuccess: async data => {
      setCreatedToken(data.token);
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => del(`${path}/${keyId}`),
    onSuccess: async () => {
      setRevokeKey(null);
      toast('Service key revoked');
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  if (!website?.canUpdate) return null;

  const closeCreate = () => {
    setCreateOpen(false);
    setCreatedToken(null);
    createMutation.reset();
  };
  const toggleScope = (scope: Scope, selected: boolean) => {
    setSelectedScopes(current => {
      const next = new Set(current);
      if (selected) next.add(scope);
      else next.delete(scope);
      return next;
    });
  };

  return (
    <Column gap="4">
      <Row justifyContent="space-between" alignItems="center">
        <Column gap="1">
          <Label>Agent API keys</Label>
          <Text color="muted">
            Website-scoped, revocable credentials for local MCP servers and other read-only agents.
          </Text>
        </Column>
        <Button variant="primary" onPress={() => setCreateOpen(true)}>
          Create key
        </Button>
      </Row>

      <LoadingPanel
        data={query.data}
        isLoading={query.isLoading}
        error={query.error}
        minHeight="100px"
      >
        {query.data?.keys.length ? (
          <Column gap="3">
            {query.data.keys.map(key => (
              <Row key={key.id} justifyContent="space-between" alignItems="center" gap="4">
                <Column gap="1" overflow="hidden">
                  <Row gap="2" alignItems="center">
                    <Text weight="bold">{key.name}</Text>
                    <Text color={getStatus(key) === 'Active' ? 'green' : 'muted'}>
                      {getStatus(key)}
                    </Text>
                  </Row>
                  <Text color="muted">
                    {key.keyPrefix}… · {key.scopes.length} scopes · created{' '}
                    <DateDistance date={new Date(key.createdAt)} />
                  </Text>
                  <Text color="muted">
                    {key.lastUsedAt
                      ? `Last used ${new Date(key.lastUsedAt).toLocaleString()}`
                      : 'Never used'}
                    {key.expiresAt
                      ? ` · expires ${new Date(key.expiresAt).toLocaleDateString()}`
                      : ''}
                  </Text>
                </Column>
                {!key.revokedAt && getStatus(key) === 'Active' && (
                  <Button variant="danger" onPress={() => setRevokeKey(key)}>
                    Revoke
                  </Button>
                )}
              </Row>
            ))}
          </Column>
        ) : (
          <Text color="muted">No service keys yet.</Text>
        )}
      </LoadingPanel>

      <Modal isOpen={createOpen} onOpenChange={open => !open && closeCreate()} isDismissable>
        <Dialog title={createdToken ? 'Copy service key' : 'Create agent API key'}>
          {createdToken ? (
            <Column gap="4">
              <Text>
                This secret is shown once. Store it in a user-readable-only file outside the
                repository.
              </Text>
              <TextField value={createdToken} isReadOnly allowCopy />
              <Row justifyContent="flex-end">
                <Button variant="primary" onPress={closeCreate}>
                  Done
                </Button>
              </Row>
            </Column>
          ) : (
            <Column gap="4">
              <Column gap="1">
                <Label>Name</Label>
                <TextField value={name} onChange={setName} autoFocus maxLength={100} />
              </Column>
              <Column gap="1">
                <Label>Expires</Label>
                <Select value={expiry} onChange={setExpiry}>
                  <ListItem id="30">30 days</ListItem>
                  <ListItem id="90">90 days</ListItem>
                  <ListItem id="365">1 year</ListItem>
                  <ListItem id="never">Never</ListItem>
                </Select>
              </Column>
              <Column gap="2">
                <Label>Scopes</Label>
                {(query.data?.availableScopes ?? []).map(scope => (
                  <Checkbox
                    key={scope}
                    isSelected={selectedScopes.has(scope)}
                    onChange={selected => toggleScope(scope, selected)}
                  >
                    {SCOPE_LABELS[scope]}
                  </Checkbox>
                ))}
              </Column>
              {createMutation.error && <Text color="red">{createMutation.error.message}</Text>}
              <Row justifyContent="flex-end" gap="2">
                <Button onPress={closeCreate} isDisabled={createMutation.isPending}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onPress={() => createMutation.mutate()}
                  isDisabled={createMutation.isPending || !name.trim() || selectedScopes.size === 0}
                >
                  Create key
                </Button>
              </Row>
            </Column>
          )}
        </Dialog>
      </Modal>

      <Modal isOpen={Boolean(revokeKey)} onOpenChange={open => !open && setRevokeKey(null)}>
        <Dialog title="Revoke service key">
          <Column gap="4">
            <Text>
              Revoke “{revokeKey?.name}”? Any MCP server or agent using it will immediately lose
              access. This cannot be undone.
            </Text>
            {revokeMutation.error && <Text color="red">{revokeMutation.error.message}</Text>}
            <Row justifyContent="flex-end" gap="2">
              <Button onPress={() => setRevokeKey(null)} isDisabled={revokeMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onPress={() => revokeKey && revokeMutation.mutate(revokeKey.id)}
                isDisabled={revokeMutation.isPending}
              >
                Revoke key
              </Button>
            </Row>
          </Column>
        </Dialog>
      </Modal>
    </Column>
  );
}
