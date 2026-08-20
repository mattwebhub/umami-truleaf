import { expect, test } from '@playwright/test';
import { uuid } from '../../src/lib/crypto';
import { hashPassword } from '../../src/lib/password';
import prisma from '../../src/lib/prisma';
import { backfillLegacyServerSessions } from '../../src/lib/server-events-backfill';
import { loginPage } from './helpers';

const truleafWebsiteId = 'e79ef216-70ab-48df-addc-596b6e9e65a8';
const standardWebsiteId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const anonymousSessionId = '12121212-1212-4212-8212-121212121212';
const anonymousEventId = '34343434-3434-4434-8434-343434343434';
const serverDistinctId = '507f191e810c19729de860ea';
const legacyServerSessionId = uuid(truleafWebsiteId, serverDistinctId);
const serverSessionId = uuid(truleafWebsiteId, 'server', serverDistinctId);
const serverEventId = '89898989-8989-4989-8989-898989898989';
const legacyBrowserEventId = '78787878-7878-4787-8787-787878787878';
const profileId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const linkId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const distinctId = '507f1f77bcf86cd799439011';

test.describe('Truleaf verified identity and scoped branding', () => {
  test.skip(process.env.TRULEAF_BRAND_E2E !== '1', 'Requires the isolated Truleaf E2E fixture');

  test.beforeAll(async () => {
    const admin =
      (await prisma.client.user.findUnique({ where: { username: 'admin' } })) ??
      (await prisma.client.user.create({
        data: {
          id: '41e2b680-648e-4b09-bcd7-3e2b10c06264',
          username: 'admin',
          password: hashPassword('umami'),
          role: 'admin',
        },
      }));
    const createdAt = new Date(Date.now() - 2 * 60 * 60_000);

    for (const website of [
      { id: truleafWebsiteId, name: 'truleaf.org', domain: 'truleaf.org' },
      { id: standardWebsiteId, name: 'Standard Website', domain: 'example.test' },
    ]) {
      await prisma.client.website.upsert({
        where: { id: website.id },
        create: { ...website, userId: admin.id, createdBy: admin.id },
        update: { name: website.name, domain: website.domain, userId: admin.id },
      });
    }

    await prisma.client.session.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        websiteId: truleafWebsiteId,
        distinctId,
        browser: 'Chrome',
        os: 'Mac OS',
        device: 'desktop',
        country: 'PT',
        city: 'Lisbon',
        createdAt,
      },
      update: { websiteId: truleafWebsiteId, distinctId, createdAt },
    });
    await prisma.client.websiteEvent.upsert({
      where: { id: eventId },
      create: {
        id: eventId,
        websiteId: truleafWebsiteId,
        sessionId,
        visitId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        hostname: 'truleaf.org',
        urlPath: '/insights',
        eventType: 1,
        createdAt,
      },
      update: { createdAt },
    });
    await prisma.client.session.upsert({
      where: { id: anonymousSessionId },
      create: {
        id: anonymousSessionId,
        websiteId: truleafWebsiteId,
        browser: 'Firefox',
        os: 'Linux',
        device: 'desktop',
        country: 'PT',
        city: 'Porto',
        createdAt: new Date(createdAt.getTime() + 60_000),
      },
      update: { websiteId: truleafWebsiteId, distinctId: null, createdAt },
    });
    await prisma.client.websiteEvent.upsert({
      where: { id: anonymousEventId },
      create: {
        id: anonymousEventId,
        websiteId: truleafWebsiteId,
        sessionId: anonymousSessionId,
        visitId: '56565656-5656-4656-8656-565656565656',
        hostname: 'truleaf.org',
        urlPath: '/',
        eventType: 1,
        createdAt: new Date(createdAt.getTime() + 60_000),
      },
      update: { createdAt },
    });
    await prisma.client.session.upsert({
      where: { id: legacyServerSessionId },
      create: {
        id: legacyServerSessionId,
        websiteId: truleafWebsiteId,
        distinctId: serverDistinctId,
        browser: 'server',
        os: 'server',
        device: 'server',
        createdAt: new Date(createdAt.getTime() + 120_000),
      },
      update: { websiteId: truleafWebsiteId, createdAt },
    });
    await prisma.client.websiteEvent.upsert({
      where: { id: legacyBrowserEventId },
      create: {
        id: legacyBrowserEventId,
        websiteId: truleafWebsiteId,
        sessionId: legacyServerSessionId,
        visitId: '67676767-6767-4676-8676-676767676767',
        hostname: 'truleaf.org',
        urlPath: '/dashboard',
        eventType: 1,
        createdAt: new Date(createdAt.getTime() + 110_000),
      },
      update: { createdAt },
    });
    await prisma.client.websiteEvent.upsert({
      where: { id: serverEventId },
      create: {
        id: serverEventId,
        websiteId: truleafWebsiteId,
        sessionId: legacyServerSessionId,
        visitId: '90909090-9090-4090-8090-909090909090',
        hostname: 'server',
        urlPath: '/server/project',
        eventName: 'server.project-created',
        eventType: 2,
        createdAt: new Date(createdAt.getTime() + 120_000),
      },
      update: { createdAt },
    });
    await prisma.client.serverEventFact.upsert({
      where: { id: serverEventId },
      create: {
        id: serverEventId,
        websiteId: truleafWebsiteId,
        keyId: 'e2e-backend',
        idempotencyKey: 'e2e:project-created',
        eventName: 'server.project-created',
        distinctId: serverDistinctId,
        urlPath: '/server/project',
        occurredAt: new Date(createdAt.getTime() + 120_000),
        projectedAt: new Date(createdAt.getTime() + 120_000),
      },
      update: {
        projectedAt: new Date(createdAt.getTime() + 120_000),
      },
    });
    await expect(backfillLegacyServerSessions({ apply: true })).resolves.toEqual(
      expect.objectContaining({
        identitiesMigrated: 1,
        eventsMoved: 1,
        legacySessionsSanitized: 1,
      }),
    );
    await expect(
      prisma.client.websiteEvent.findUnique({
        where: { id: serverEventId },
        select: { sessionId: true },
      }),
    ).resolves.toEqual({ sessionId: serverSessionId });
    await prisma.client.verifiedIdentityProfile.upsert({
      where: {
        websiteId_distinctId: {
          websiteId: truleafWebsiteId,
          distinctId,
        },
      },
      create: {
        id: profileId,
        websiteId: truleafWebsiteId,
        distinctId,
        displayName: 'Matheus Paranhos',
        username: 'matheus',
        avatarUrl: 'https://lh3.googleusercontent.com/avatar.png',
        role: 'user',
        plan: 'premium',
        profileVersion: new Date().toISOString(),
        verifiedUntil: new Date(Date.now() + 30 * 24 * 60 * 60_000),
      },
      update: {
        displayName: 'Matheus Paranhos',
        verifiedUntil: new Date(Date.now() + 30 * 24 * 60 * 60_000),
      },
    });
    await prisma.client.verifiedSessionIdentity.upsert({
      where: {
        websiteId_sessionId: {
          websiteId: truleafWebsiteId,
          sessionId,
        },
      },
      create: {
        id: linkId,
        websiteId: truleafWebsiteId,
        sessionId,
        distinctId,
      },
      update: { distinctId },
    });
  });

  test.afterAll(async () => {
    await prisma.client.verifiedSessionIdentity.deleteMany({
      where: { websiteId: { in: [truleafWebsiteId, standardWebsiteId] } },
    });
    await prisma.client.verifiedIdentityProfile.deleteMany({
      where: { websiteId: { in: [truleafWebsiteId, standardWebsiteId] } },
    });
    await prisma.client.websiteEvent.deleteMany({
      where: { websiteId: { in: [truleafWebsiteId, standardWebsiteId] } },
    });
    await prisma.client.serverEventFact.deleteMany({
      where: { websiteId: { in: [truleafWebsiteId, standardWebsiteId] } },
    });
    await prisma.client.session.deleteMany({
      where: { websiteId: { in: [truleafWebsiteId, standardWebsiteId] } },
    });
    await prisma.client.website.deleteMany({
      where: { id: { in: [truleafWebsiteId, standardWebsiteId] } },
    });
    await prisma.client.$disconnect();
  });

  test('shows a verified account, brands only Truleaf, and resets on navigation', async ({
    page,
    request,
  }) => {
    await loginPage(page, request);
    await page.route('**/identity-avatar', route =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    );

    await page.goto(`/websites/${truleafWebsiteId}/sessions`);

    await expect(page.locator('[data-website-brand="truleaf"]')).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('data-website-brand', 'truleaf');
    await expect(page.getByLabel('Truleaf Analytics').filter({ visible: true })).toBeVisible();
    await expect(page.getByText('Matheus Paranhos').first()).toBeVisible();
    await expect(page.getByAltText('Matheus Paranhos')).toBeVisible();
    await expect(page.getByText('Unknown', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Truleaf backend').first()).toBeVisible();
    await expect(page.getByText('Server-side event').first()).toBeVisible();
    await expect(page.getByText('umami', { exact: true })).toHaveCount(0);

    await page.getByText('Matheus Paranhos').first().click();
    await expect(page.getByText('@matheus · user · premium')).toBeVisible();
    await expect(page.getByText('Session', { exact: true }).last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chat in Truleaf' })).toBeVisible();

    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.dataset.theme = 'light';
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const styles = getComputedStyle(document.documentElement);
          return {
            canvas: styles.getPropertyValue('--surface-raised').trim(),
            card: styles.getPropertyValue('--surface-base').trim(),
            renderedCanvas: getComputedStyle(document.body).backgroundColor,
            text: styles.getPropertyValue('--text-primary').trim(),
          };
        }),
      )
      .toEqual({
        canvas: '#fdf6ed',
        card: '#fff',
        renderedCanvas: 'rgb(253, 246, 237)',
        text: '#2d2926',
      });

    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const styles = getComputedStyle(document.documentElement);
          return {
            canvas: styles.getPropertyValue('--surface-raised').trim(),
            card: styles.getPropertyValue('--surface-base').trim(),
            renderedCanvas: getComputedStyle(document.body).backgroundColor,
            text: styles.getPropertyValue('--text-primary').trim(),
          };
        }),
      )
      .toEqual({
        canvas: '#0a0a0a',
        card: '#171717',
        renderedCanvas: 'rgb(10, 10, 10)',
        text: '#fafafa',
      });

    await page.goto(`/websites/${standardWebsiteId}`);

    await expect(page.locator('[data-website-brand="truleaf"]')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-website-brand');
    await expect(page.getByLabel('Umami').filter({ visible: true })).toBeVisible();
    await expect(page.getByText('umami', { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText('Truleaf.org')).toHaveCount(0);
  });
});
