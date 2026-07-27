import { parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { isTrustedServerSession } from '@/lib/server-events';
import { isTruleafIdentityProfileEnabled, isTruleafWebsite } from '@/lib/truleaf/config';
import { canViewAuthenticatedWebsite, canViewWebsiteSection } from '@/permissions';
import { getVerifiedSessionIdentityProfiles } from '@/queries/prisma';
import { getWebsiteSession } from '@/queries/sql';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; sessionId: string }> },
) {
  const { auth, error } = await parseRequest(request);

  if (error) {
    return error();
  }

  const { websiteId, sessionId } = await params;

  if (
    !(await canViewWebsiteSection(auth, websiteId, ['sessions', 'events', 'realtime', 'revenue']))
  ) {
    return unauthorized();
  }

  const data = await getWebsiteSession(websiteId, sessionId);
  const canViewPrivateIdentity = Boolean(
    data && auth?.user && (await canViewAuthenticatedWebsite(auth, websiteId)),
  );
  const profiles =
    data &&
    canViewPrivateIdentity &&
    isTruleafIdentityProfileEnabled() &&
    isTruleafWebsite(websiteId)
      ? await getVerifiedSessionIdentityProfiles(websiteId, [sessionId])
      : new Map();

  const serverSession =
    data &&
    isTrustedServerSession({
      websiteId,
      sessionId,
      distinctId: data.distinctId,
    });

  const { distinctId, ...visibleData } = data ?? {};

  return json(
    data
      ? {
          ...visibleData,
          ...(canViewPrivateIdentity ? { distinctId } : {}),
          ...(serverSession ? { serverSession: true } : {}),
          identityProfile: profiles.get(sessionId),
        }
      : data,
  );
}
