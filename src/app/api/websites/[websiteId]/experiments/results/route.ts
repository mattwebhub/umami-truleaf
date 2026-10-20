import { z } from 'zod';
import { getExperimentResults } from '@/lib/experiments/results';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { withDateRange } from '@/lib/schema';
import { canViewAuthenticatedWebsite } from '@/permissions';

const schema = withDateRange({
  experiment: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  timezone: z.string().optional(),
  unit: z.string().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, query, error } = await parseRequest(request, schema);
  if (error) return error();
  const { websiteId } = await params;
  if (!(await canViewAuthenticatedWebsite(auth, websiteId))) return unauthorized();
  const filters = await getQueryFilters(query, websiteId);
  const results = await getExperimentResults({
    websiteId,
    experiment: query.experiment,
    startDate: filters.startDate,
    endDate: filters.endDate,
  });
  return json({
    results,
    observationHours: 24,
    matureBefore: filters.endDate.getTime() - 86_400_000,
  });
}
