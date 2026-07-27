import { parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
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
  const profiles =
    data &&
    auth?.user &&
    isTruleafIdentityProfileEnabled() &&
    isTruleafWebsite(websiteId) &&
    (await canViewAuthenticatedWebsite(auth, websiteId))
      ? await getVerifiedSessionIdentityProfiles(websiteId, [sessionId])
      : new Map();

  return json(data ? { ...data, identityProfile: profiles.get(sessionId) } : data);
}
