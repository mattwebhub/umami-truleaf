import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';
import { getProductCockpitConfig } from '@/lib/product-cockpit/config';
import { parseRequest } from '@/lib/request';
import { badRequest, json, unauthorized } from '@/lib/response';
import { canUpdateWebsite } from '@/permissions';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, error } = await parseRequest(request);
  if (error) return error();

  const { websiteId } = await params;
  if (!(await canUpdateWebsite(auth, websiteId))) return unauthorized();

  const config = getProductCockpitConfig(websiteId);
  if (!config?.bootstrap) {
    return badRequest({ message: 'Product cockpit bootstrap is not configured' });
  }

  const { segments, cohorts, reports } = config.bootstrap;
  const segmentOperations = [
    ...segments.map(segment => ({
      id: uuid('product-cockpit', websiteId, 'segment', segment.managedKey),
      type: 'segment',
      name: segment.name,
      parameters: {
        filters: segment.filters,
        ...(segment.match ? { match: segment.match } : {}),
      },
    })),
    ...cohorts.map(cohort => ({
      id: uuid('product-cockpit', websiteId, 'cohort', cohort.managedKey),
      type: 'cohort',
      name: cohort.name,
      parameters: {
        filters: cohort.filters,
        dateRange: cohort.dateRange,
        action: cohort.action,
        ...(cohort.match ? { match: cohort.match } : {}),
      },
    })),
  ];

  await prisma.client.$transaction([
    ...segmentOperations.map(item =>
      prisma.client.segment.upsert({
        where: { id: item.id },
        create: {
          ...item,
          websiteId,
        },
        update: {
          type: item.type,
          name: item.name,
          parameters: item.parameters,
        },
      }),
    ),
    ...reports.map(report =>
      prisma.client.report.upsert({
        where: {
          id: uuid('product-cockpit', websiteId, 'report', report.managedKey),
        },
        create: {
          id: uuid('product-cockpit', websiteId, 'report', report.managedKey),
          userId: auth.user.id,
          websiteId,
          type: report.type,
          name: report.name,
          description: report.description,
          parameters: report.parameters as Prisma.InputJsonObject,
        },
        update: {
          type: report.type,
          name: report.name,
          description: report.description,
          parameters: report.parameters as Prisma.InputJsonObject,
        },
      }),
    ),
  ]);

  return json({
    ok: true,
    segments: segments.length,
    cohorts: cohorts.length,
    reports: reports.length,
  });
}

import type { Prisma } from '@/generated/prisma/client';
