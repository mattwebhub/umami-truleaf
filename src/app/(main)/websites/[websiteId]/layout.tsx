import type { Metadata } from 'next';
import { WebsiteLayout } from '@/app/(main)/websites/[websiteId]/WebsiteLayout';
import { getWebsiteBrand } from '@/lib/website-branding/config';
import { getWebsite } from '@/queries/prisma';

export default async function ({
  children,
  modal,
  params,
}: {
  children: any;
  modal: React.ReactNode;
  params: Promise<{ websiteId: string }>;
}) {
  const { websiteId } = await params;
  const website = await getWebsite(websiteId);

  if (!website || website?.deletedAt) {
    return null;
  }

  return (
    <WebsiteLayout websiteId={websiteId}>
      {children}
      {modal}
    </WebsiteLayout>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ websiteId: string }>;
}): Promise<Metadata> {
  const { websiteId } = await params;

  return getWebsiteBrand(websiteId) === 'truleaf'
    ? {
        title: {
          template: '%s | Truleaf Analytics',
          default: 'Truleaf Analytics',
        },
        icons: {
          icon: '/truleaf-icon.svg',
          shortcut: '/truleaf-icon.svg',
        },
      }
    : {
        title: {
          template: '%s | Umami',
          default: 'Websites | Umami',
        },
      };
}
