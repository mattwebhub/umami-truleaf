import { z } from 'zod';
import { getProductCockpitData } from '@/lib/product-cockpit/service';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { filterParams, withDateRange } from '@/lib/schema';
import { canUpdateWebsite, canViewAuthenticatedWebsite } from '@/permissions';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const schema = withDateRange({
    ...filterParams,
    timezone: z.string().optional(),
    unit: z.string().optional(),
  });
  const { auth, query, error } = await parseRequest(request, schema);
  if (error) return error();

  const { websiteId } = await params;
  if (!(await canViewAuthenticatedWebsite(auth, websiteId))) return unauthorized();

  const current = await getQueryFilters(query, websiteId);
  const includeModeration = await canUpdateWebsite(auth, websiteId);
  const data = await getProductCockpitData({ websiteId, current, includeModeration });

  return json(data);
}
