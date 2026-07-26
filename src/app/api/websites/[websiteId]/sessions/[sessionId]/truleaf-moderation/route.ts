import { z } from 'zod';
import { parseRequest } from '@/lib/request';
import { badRequest, json, notFound, serverError, unauthorized } from '@/lib/response';
import {
  isTruleafModerationEnabled,
  isTruleafModerationOperator,
  isTruleafWebsite,
} from '@/lib/truleaf/config';
import { TRULEAF_MODERATION_TARGET_LIMIT } from '@/lib/truleaf/constants';
import {
  type ModerationSource,
  type ModerationStatusResponse,
  type ModerationTarget,
  moderationActionSchema,
  moderationBrowserActionSchema,
  moderationStatusSchema,
  requestTruleafModeration,
} from '@/lib/truleaf/service';
import { canUpdateWebsite } from '@/permissions';
import {
  deleteTruleafSessionAccountBanReference,
  getTruleafSessionAccountBanReference,
  getTruleafSessionIdentityProof,
  getTruleafSessionNetworks,
  recordTruleafSessionAccountBanReference,
} from '@/queries/prisma';
import { getWebsiteSession } from '@/queries/sql';

const actionSchema = z
  .object({
    requestId: z.uuid(),
    action: z.enum(['ban', 'unban']),
    targetTypes: z
      .array(z.enum(['account', 'ip']))
      .min(1)
      .max(2),
    networkIds: z.array(z.uuid()).max(10).default([]),
    reason: z.string().trim().min(3).max(500).optional(),
    expiresAt: z.iso.datetime().optional(),
  })
  .superRefine((value, context) => {
    if (value.action === 'ban' && !value.reason) {
      context.addIssue({
        code: 'custom',
        message: 'A reason is required when banning a target',
        path: ['reason'],
      });
    }

    if (value.expiresAt && new Date(value.expiresAt) <= new Date()) {
      context.addIssue({
        code: 'custom',
        message: 'Expiry must be in the future',
        path: ['expiresAt'],
      });
    }

    if (value.targetTypes.includes('ip') && !value.networkIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Select at least one observed network',
        path: ['networkIds'],
      });
    }

    const selectedTargetCount =
      new Set(value.networkIds).size + (value.targetTypes.includes('account') ? 1 : 0);

    if (selectedTargetCount > TRULEAF_MODERATION_TARGET_LIMIT) {
      context.addIssue({
        code: 'custom',
        message: `Select at most ${TRULEAF_MODERATION_TARGET_LIMIT} targets`,
        path: ['networkIds'],
      });
    }
  });

interface RouteContext {
  params: Promise<{ websiteId: string; sessionId: string }>;
}

async function resolveContext(request: Request, context: RouteContext) {
  const { auth, error } = await parseRequest(request);

  if (error) {
    return { error: error() };
  }

  const { websiteId, sessionId } = await context.params;

  if (
    !isTruleafModerationEnabled() ||
    !isTruleafWebsite(websiteId) ||
    !auth?.user ||
    !isTruleafModerationOperator(auth.user.id) ||
    !(await canUpdateWebsite(auth, websiteId))
  ) {
    return { error: unauthorized() };
  }

  const session = await getWebsiteSession(websiteId, sessionId);

  if (!session) {
    return { error: notFound({ message: 'Session not found' }) };
  }

  const [networks, identityProof, accountBanReference] = await Promise.all([
    getTruleafSessionNetworks(websiteId, sessionId),
    getTruleafSessionIdentityProof(websiteId, sessionId),
    session.distinctId
      ? getTruleafSessionAccountBanReference(websiteId, sessionId, session.distinctId)
      : undefined,
  ]);
  const source: ModerationSource = { system: 'umami', websiteId, sessionId };

  return { auth, session, networks, identityProof, accountBanReference, source };
}

function resolveTargets(
  session: { distinctId?: string | null },
  networks: Array<{ id: string; address: string }>,
  targetTypes: Array<'account' | 'ip'>,
  networkIds: string[] = [],
  identityProof?: string,
  accountBanReference?: string,
  action?: 'ban' | 'unban',
) {
  const targets: ModerationTarget[] = [];

  if (targetTypes.includes('account') && session.distinctId) {
    if (action === 'ban') {
      if (identityProof) {
        targets.push({ type: 'account', value: session.distinctId, proof: identityProof });
      }
    } else if (action === 'unban') {
      if (accountBanReference) {
        targets.push({
          type: 'account',
          value: session.distinctId,
          banId: accountBanReference,
        });
      } else if (identityProof) {
        targets.push({ type: 'account', value: session.distinctId, proof: identityProof });
      }
    } else {
      if (identityProof) {
        targets.push({ type: 'account', value: session.distinctId, proof: identityProof });
      } else if (accountBanReference) {
        targets.push({
          type: 'account',
          value: session.distinctId,
          banId: accountBanReference,
        });
      }
    }
  }

  if (targetTypes.includes('ip')) {
    const selected = new Set(networkIds);
    targets.push(
      ...networks
        .filter(({ id }) => selected.has(id))
        .map(({ address }) => ({ type: 'ip' as const, value: address })),
    );
  }

  return targets;
}

function getAccountStatus(status: ModerationStatusResponse) {
  return status.targets.find(target => target.type === 'account');
}

function getAccountDisplayValue(status: ModerationStatusResponse) {
  return getAccountStatus(status)?.displayValue;
}

function getNetworkStatuses(status: ModerationStatusResponse) {
  return status.targets.filter(target => target.type === 'ip');
}

async function getTargetStatus(
  targets: ModerationTarget[],
  source: ModerationSource,
): Promise<ModerationStatusResponse> {
  const chunks: ModerationTarget[][] = [];

  for (let index = 0; index < targets.length; index += TRULEAF_MODERATION_TARGET_LIMIT) {
    chunks.push(targets.slice(index, index + TRULEAF_MODERATION_TARGET_LIMIT));
  }

  const statuses = await Promise.all(
    chunks.map(chunk =>
      requestTruleafModeration({
        path: '/api/v1/internal/moderation/status',
        body: {
          targets: chunk,
          source,
        },
        schema: moderationStatusSchema,
      }),
    ),
  );

  return { targets: statuses.flatMap(status => status.targets) };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const resolved = await resolveContext(request, context);

    if (resolved.error) {
      return resolved.error;
    }

    const { session, networks, identityProof, accountBanReference, source } = resolved;
    const targets = resolveTargets(
      session,
      networks,
      ['account', 'ip'],
      networks.map(({ id }) => id),
      identityProof,
      accountBanReference,
    );
    const status = targets.length ? await getTargetStatus(targets, source) : { targets: [] };
    const accountStatus = getAccountStatus(status);
    const networkStatuses = getNetworkStatuses(status);
    const accountCanUnban =
      accountStatus?.banned === true &&
      accountStatus.canUnban === true &&
      Boolean(accountStatus.banId);

    if (accountBanReference && accountStatus?.banned === false) {
      // A successful status response for this account is authoritative. Only
      // remove the local capability when no active ban exists at all; an active
      // cross-source ban returns banned=true without our source-bound banId and
      // must not be affected.
      await deleteTruleafSessionAccountBanReference(
        source.websiteId,
        source.sessionId,
        session.distinctId,
        accountBanReference,
      );
    } else if (
      session.distinctId &&
      accountCanUnban &&
      accountStatus?.banId &&
      accountStatus.banId !== accountBanReference
    ) {
      await recordTruleafSessionAccountBanReference(
        source.websiteId,
        source.sessionId,
        session.distinctId,
        accountStatus.banId,
        accountStatus.expiresAt ? new Date(accountStatus.expiresAt) : null,
      );
    }

    return json({
      account: session.distinctId
        ? {
            displayValue: getAccountDisplayValue(status) ?? 'Unverified account candidate',
            banned: accountStatus?.banned === true,
            canBan: accountStatus?.canBan === true,
            canUnban: accountCanUnban,
            expiresAt: accountStatus?.expiresAt,
          }
        : null,
      networks: networks.map(
        ({ id, maskedAddress, addressFamily, firstSeenAt, lastSeenAt, expiresAt }, index) => {
          const targetStatus = networkStatuses[index];
          const banned = targetStatus?.banned === true;
          const sourceMatches = targetStatus?.sourceMatches === true;

          return {
            id,
            maskedAddress,
            addressFamily,
            firstSeenAt,
            lastSeenAt,
            expiresAt,
            banned,
            canBan: Boolean(targetStatus) && !banned,
            canUnban:
              banned &&
              sourceMatches &&
              targetStatus?.canUnban === true &&
              Boolean(targetStatus?.banId),
            sourceMatches,
            banExpiresAt: targetStatus?.expiresAt,
            vercel: targetStatus?.vercel ?? 'not_applicable',
          };
        },
      ),
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const parsed = await parseRequest(request, actionSchema);

    if (parsed.error) {
      return parsed.error();
    }

    const resolved = await resolveContext(request, context);

    if (resolved.error) {
      return resolved.error;
    }

    const { auth, session, networks, identityProof, accountBanReference, source } = resolved;
    const { requestId, action, targetTypes, networkIds, reason, expiresAt } = parsed.body;
    const targets = resolveTargets(
      session,
      networks,
      targetTypes,
      networkIds,
      identityProof,
      accountBanReference,
      action,
    );

    if (!targets.length) {
      return badRequest({ message: 'None of the selected target types are available' });
    }

    if (targets.length > TRULEAF_MODERATION_TARGET_LIMIT) {
      return badRequest({
        message: `Select at most ${TRULEAF_MODERATION_TARGET_LIMIT} targets`,
      });
    }

    const status = await getTargetStatus(targets, source);
    const authorizedTargets: ModerationTarget[] = [];

    for (const [index, target] of targets.entries()) {
      const targetStatus = status.targets[index];

      if (!targetStatus || targetStatus.type !== target.type) {
        return unauthorized({
          message: 'Truleaf did not authorize the selected moderation target',
        });
      }

      if (target.type === 'account') {
        const permitted =
          action === 'ban' ? targetStatus.canBan === true : targetStatus.canUnban === true;
        const banId = targetStatus.banId;

        if (!permitted || (action === 'unban' && !banId)) {
          return unauthorized({
            message: `Truleaf has not authorized this account ${action} action`,
          });
        }

        authorizedTargets.push(
          action === 'unban'
            ? {
                type: 'account',
                value: target.value,
                banId,
              }
            : target,
        );
        continue;
      }

      if (action === 'ban') {
        if (targetStatus.banned) {
          return badRequest({
            message: 'An active ban already exists for a selected network',
          });
        }
        authorizedTargets.push(target);
        continue;
      }

      if (
        !targetStatus.banned ||
        targetStatus.sourceMatches !== true ||
        targetStatus.canUnban !== true ||
        !targetStatus.banId
      ) {
        return unauthorized({
          message: 'The selected network ban did not originate from this Umami session',
        });
      }

      authorizedTargets.push({
        type: 'ip',
        value: target.value,
        banId: targetStatus.banId,
      });
    }

    const result = await requestTruleafModeration({
      path: '/api/v1/internal/moderation/actions',
      body: {
        requestId,
        action,
        targets: authorizedTargets,
        reason,
        expiresAt,
        source,
        actor: { umamiUserId: auth.user.id },
      },
      schema: moderationActionSchema,
    });

    const accountResult = result.targets.find(target => target.type === 'account');

    if (
      session.distinctId &&
      targetTypes.includes('account') &&
      accountResult?.status === 'applied'
    ) {
      if (action === 'ban') {
        await recordTruleafSessionAccountBanReference(
          source.websiteId,
          source.sessionId,
          session.distinctId,
          result.operationId,
          expiresAt ? new Date(expiresAt) : null,
        );
      } else {
        if (accountBanReference) {
          await deleteTruleafSessionAccountBanReference(
            source.websiteId,
            source.sessionId,
            session.distinctId,
            accountBanReference,
          );
        }
      }
    }

    return json(moderationBrowserActionSchema.parse(result));
  } catch (error) {
    return serverError(error);
  }
}
