import { getQueryFilters, parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { filterParams, pagingParams, searchParams, withDateRange } from '@/lib/schema';
import { isTrustedServerSession } from '@/lib/server-events';
import { isTruleafIdentityProfileEnabled, isTruleafWebsite } from '@/lib/truleaf/config';
import { canViewAuthenticatedWebsite, canViewWebsiteSection } from '@/permissions';
import { getVerifiedSessionIdentityProfiles } from '@/queries/prisma';
import { getWebsiteSessions } from '@/queries/sql';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const schema = withDateRange({
    ...filterParams,
    ...pagingParams,
    ...searchParams,
  });

  const { auth, query, error } = await parseRequest(request, schema);

  if (error) {
    return error();
  }

  const { websiteId } = await params;

  if (!(await canViewWebsiteSection(auth, websiteId, 'sessions'))) {
    return unauthorized();
  }

  const filters = await getQueryFilters(query, websiteId);

  const data = await getWebsiteSessions(websiteId, filters);
  const profiles =
    auth?.user &&
    isTruleafIdentityProfileEnabled() &&
    isTruleafWebsite(websiteId) &&
    (await canViewAuthenticatedWebsite(auth, websiteId))
      ? await getVerifiedSessionIdentityProfiles(
          websiteId,
          data.data.map(({ id }) => id),
        )
      : new Map();

  return json({
    ...data,
    data: data.data.map(session => {
      const { distinctId, ...visibleSession } = session;
      const serverSession = isTrustedServerSession({
        websiteId,
        sessionId: session.id,
        distinctId,
      });

      return {
        ...visibleSession,
        ...(serverSession ? { serverSession: true } : {}),
        identityProfile: profiles.get(session.id),
      };
    }),
  });
}
