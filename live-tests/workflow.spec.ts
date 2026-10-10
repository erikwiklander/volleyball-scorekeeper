import { test, expect } from '@playwright/test';
test('public viewer follows points, offline recovery, final results, stop and deletion', async ({
  page,
  context,
  browser,
  browserName,
}, testInfo) => {
  await page.goto('./');
  await expect(page.getByText('Offline ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '+ New game', exact: true }).click();
  await page.getByLabel('Home team', { exact: true }).fill('Eagles');
  await page.getByLabel('Away team', { exact: true }).fill('Falcons');
  await page.getByRole('button', { name: 'Create game', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Start live sharing' }),
  ).toBeDisabled();
  // Mobile browsers must prepare Firebase's popup helper before the tap.
  await expect(
    page.locator('iframe[src*="/emulator/auth/iframe"]'),
  ).toHaveCount(1);
  const popupPromise = page.waitForEvent('popup');
  await page
    .getByRole('button', { name: 'Sign in with Google', exact: true })
    .click();
  const popup = await popupPromise;
  await popup.waitForLoadState('load');
  await popup.getByRole('button', { name: 'Add new account' }).click();
  await popup.locator('#email-input').fill(`scorer-${browserName}@example.com`);
  await popup.locator('#display-name-input').fill('Test Scorer');
  await popup.locator('form button[type=submit]').click();
  await expect(
    page.getByText(`Signed in as scorer-${browserName}@example.com.`, {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start live sharing' }).click();
  await expect(
    page.getByText('The latest saved score is published.'),
  ).toBeVisible();
  const url = await page.getByLabel('Live score link').inputValue();
  expect(url).toMatch(/\/live\/[a-zA-Z0-9_-]+\?preview=2$/);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        (window as unknown as { shared: ShareData }).shared = data;
      },
    });
  });
  await page
    .getByRole('button', { name: 'Share live score', exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (window as unknown as { shared: ShareData }).shared,
    ),
  ).toEqual({
    title: 'Eagles vs Falcons — Live score',
    url,
  });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copied: string }).copied = text;
        },
      },
    });
  });
  await page
    .getByRole('button', { name: 'Share live score', exact: true })
    .click();
  expect(
    await page.evaluate(() => (window as unknown as { copied: string }).copied),
  ).toBe(url);
  const viewerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const preview = await page.request.get(url);
  expect(preview.status()).toBe(200);
  expect(await preview.text()).toContain(
    'property="og:title" content="Eagles vs Falcons — Live score"',
  );
  const viewer = await viewerContext.newPage();
  try {
    await viewer.goto(url);
    await expect(
      viewer.getByRole('heading', { name: 'Eagles vs Falcons' }),
    ).toBeVisible();
    await expect(viewer).toHaveTitle('Eagles vs Falcons — Live score');
    const audience = page.getByRole('region', { name: 'Game audience' });
    const metric = (label: string) =>
      audience
        .locator('.analytics-metrics div')
        .filter({ has: page.getByText(label, { exact: true }) })
        .locator('dd');
    await expect(metric('Total viewers')).toHaveText('1');
    await expect(metric('Viewed while live')).toHaveText('0');
    const legacy = new URL(url);
    const publicId = legacy.pathname.match(/\/live\/([^/]+)/)![1];
    legacy.pathname = '/volleyball-scorekeeper/';
    legacy.hash = `/live/${publicId}`;
    await viewer.goto(legacy.href);
    await expect(
      viewer.getByRole('heading', { name: 'Eagles vs Falcons' }),
    ).toBeVisible();
    legacy.hash = `/live/${publicId}/eagles-vs-falcons`;
    await viewer.goto(legacy.href);
    await expect(
      viewer.getByRole('heading', { name: 'Eagles vs Falcons' }),
    ).toBeVisible();
    await viewer.goto(url);
    await expect(
      viewer.getByText('STARTING SOON', { exact: true }),
    ).toBeVisible();
    const databases = await viewer.evaluate(async () =>
      (await indexedDB.databases()).map((db) => db.name),
    );
    expect(databases).not.toContain('firebaseLocalStorageDb');
    expect(databases).not.toContain('volleyball-scorekeeper');
    await page.getByRole('button', { name: 'Start Set 1' }).click();
    await expect(metric('Viewed while live')).toHaveText('1');
    await expect(metric('Watching now')).toHaveText('1');
    await expect(metric('Peak watching live')).toHaveText('1');
    await expect(metric('Total viewers')).toHaveText('1');
    const home = page.getByRole('button', { name: 'Add point for Eagles' });
    await home.click();
    const points = viewer.locator('.public-points');
    await expect(points).toHaveText(['1', '0']);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Sign in with Google', exact: true }),
    ).toBeVisible();
    await home.click();
    await expect(home.locator('.score')).toHaveText('2');
    await expect(points).toHaveText(['1', '0']);
    const returnPopupPromise = page.waitForEvent('popup');
    await page
      .getByRole('button', { name: 'Sign in with Google', exact: true })
      .click();
    const returnPopup = await returnPopupPromise;
    await returnPopup.waitForLoadState('load');
    await returnPopup
      .getByText(`scorer-${browserName}@example.com`, { exact: true })
      .click();
    await expect(points).toHaveText(['2', '0']);
    await page.getByRole('button', { name: 'Undo last point' }).click();
    await expect(points).toHaveText(['1', '0']);
    await context.setOffline(true);
    await home.click();
    await home.click();
    await page.getByRole('button', { name: 'Undo last point' }).click();
    await expect(home.locator('.score')).toHaveText('2');
    await expect(points).toHaveText(['1', '0']);
    page.on('dialog', (d) => d.accept());
    if (browserName === 'chromium') {
      await page.reload();
      await page.getByRole('button', { name: 'Resume match' }).click();
      await expect(home.locator('.score')).toHaveText('2');
    }
    await endSet();
    await context.setOffline(false);
    await expect(points).toHaveText(['2', '0']);
    await expect(viewer.locator('.public-set')).toContainText('Between sets');
    async function endSet() {
      await page.getByRole('button', { name: 'End set', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'End set', exact: true })
        .click();
    }
    await page.getByRole('button', { name: 'Start Set 2' }).click();
    await page.getByRole('button', { name: 'Add point for Falcons' }).click();
    await expect(points).toHaveText(['0', '1']);
    await endSet();
    await page
      .getByRole('button', { name: 'Complete match', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Complete match', exact: true })
      .click();
    await expect(viewer.getByText('FINAL', { exact: true })).toBeVisible();
    await expect(metric('Watching now')).toHaveText('0');
    await expect(metric('Viewed while live')).toHaveText('1');
    await expect(
      viewer.getByRole('region', { name: 'Game audience' }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('game-audience.png'),
      fullPage: true,
    });
    await expect(viewer.locator('.public-set')).toContainText('Sets 1–1');
    await expect(
      viewer.locator('.public-history tbody tr').first().locator('td'),
    ).toHaveText(['2', '0']);
    await viewer.screenshot({
      path: testInfo.outputPath('live-score.png'),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Stop sharing', exact: true })
      .click();
    await expect(
      viewer.getByRole('heading', { name: 'Score unavailable' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Start live sharing' }).click();
    await expect(viewer.getByText('FINAL', { exact: true })).toBeVisible();
    await context.setOffline(true);
    await page.getByText('Match management', { exact: true }).click();
    await page
      .getByRole('button', { name: 'Delete match', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete permanently' })
      .click();
    await context.setOffline(false);
    await expect(
      viewer.getByRole('heading', { name: 'Score unavailable' }),
    ).toBeVisible();
    await page.getByText('Site analytics', { exact: true }).click();
    await expect(
      page.getByText('Daily site traffic · UTC dates', { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('.analytics-history tbody tr').first().locator('td').nth(2),
    ).not.toHaveText('0');
    await page.screenshot({
      path: testInfo.outputPath('site-analytics.png'),
      fullPage: true,
    });
  } finally {
    await viewerContext.close();
  }
});

test('a stalled Google window offers a retry while local scoring stays usable', async ({
  page,
  context,
}) => {
  await context.route('**/emulator/auth/handler?**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Sign-in service delayed</h1>',
    }),
  );
  await page.goto('./');
  await page.getByRole('button', { name: '+ New game', exact: true }).click();
  await page.getByLabel('Home team', { exact: true }).fill('Local home');
  await page.getByLabel('Away team', { exact: true }).fill('Local away');
  await page.getByRole('button', { name: 'Create game', exact: true }).click();
  await page.getByRole('button', { name: 'Start Set 1' }).click();
  const login = page.getByRole('button', {
    name: 'Sign in with Google',
    exact: true,
  });
  await expect(login).toBeEnabled();
  await page.clock.install();
  const popupPromise = page.waitForEvent('popup');
  await login.click();
  const popup = await popupPromise;
  await expect(
    popup.getByRole('heading', { name: 'Sign-in service delayed' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Signing in…', exact: true }),
  ).toBeDisabled();
  await page.clock.fastForward(30_001);
  await expect(login).toBeEnabled();
  await expect(page.getByRole('alert')).toContainText(
    'Google sign-in is taking longer than expected',
  );
  const home = page.getByRole('button', { name: 'Add point for Local home' });
  await home.click();
  await expect(home.locator('.score')).toHaveText('1');
  await popup.close();
});
