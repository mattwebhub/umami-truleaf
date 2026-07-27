import { parseRequest } from '@/lib/request';
import { notFound, unauthorized } from '@/lib/response';
import { isTruleafIdentityProfileEnabled, isTruleafWebsite } from '@/lib/truleaf/config';
import { fetchVerifiedAvatar, getVerifiedAvatarUrl } from '@/lib/verified-avatar';
import { canViewAuthenticatedWebsite } from '@/permissions';
import { getVerifiedSessionIdentityAvatar } from '@/queries/prisma';

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
    !isTruleafIdentityProfileEnabled() ||
    !isTruleafWebsite(websiteId) ||
    !auth?.user ||
    !(await canViewAuthenticatedWebsite(auth, websiteId))
  ) {
    return unauthorized();
  }

  const profile = await getVerifiedSessionIdentityAvatar(websiteId, sessionId);
  const url = profile?.avatarUrl ? getVerifiedAvatarUrl(profile.avatarUrl) : undefined;

  if (!url) {
    return notFound();
  }

  const avatar = await fetchVerifiedAvatar(url).catch(() => undefined);

  if (!avatar) {
    return notFound();
  }

  return new Response(avatar.body, {
    headers: {
      'cache-control': 'private, max-age=3600',
      'content-type': avatar.contentType,
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  });
}
