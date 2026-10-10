import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test.use({ actionTimeout: 15_000 });
async function signIn(page: Page, email: string, existing = false) {
  const button = page.getByRole('button', {
    name: 'Sign in to sync your library',
    exact: true,
  });
  await expect(button).toBeEnabled();
  const popupPromise = page.waitForEvent('popup');
  await button.click();
  const popup = await popupPromise;
  await popup.waitForLoadState('load');
  if (existing) await popup.getByText(email, { exact: true }).click();
  else {
    await popup.getByRole('button', { name: 'Add new account' }).click();
    await popup.locator('#email-input').fill(email);
    await popup.locator('#display-name-input').fill('History Sync Tester');
    await popup.locator('form button[type=submit]').click();
  }
  await expect(
    page.getByText('Games and tournaments are synced.', { exact: true }),
  ).toBeVisible();
}
async function goHome(page: Page) {
  await page
    .getByRole('button', {
      name: /Save & leave scoring|← Sync Cup|← Updated Cup|← All games/,
    })
    .click();
  if (
    await page
      .getByRole('button', { name: '← All tournaments', exact: true })
      .isVisible()
  )
    await page
      .getByRole('button', { name: '← All tournaments', exact: true })
      .click();
}
async function openCupGame(page: Page, cup = 'Sync Cup') {
  const summary = page.getByText(/Tournaments \(optional\)/);
  if (
    !(await page
      .locator('.tournament-card')
      .filter({ hasText: cup })
      .isVisible())
  )
    await summary.click();
  await page.locator('.tournament-card').filter({ hasText: cup }).click();
  await page
    .locator('.match-list .list-card')
    .filter({ hasText: 'Sync Eagles' })
    .click();
}
test('full history syncs automatically; transfer keeps the live URL and protects offline points, deletions and accounts', async ({
  page,
  context,
  browser,
  browserName,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto('./');
  page.on('dialog', (d) => d.accept());
  await expect(page.getByText('Offline ready', { exact: true })).toBeVisible();
  await page.getByText(/Tournaments \(optional\)/).click();
  await page
    .getByRole('button', { name: '+ New tournament', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByLabel('Tournament name', { exact: true })
    .fill('Sync Cup');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save tournament', exact: true })
    .click();
  await page.getByRole('button', { name: '+ New match', exact: true }).click();
  await page.getByLabel('Home team', { exact: true }).fill('Sync Eagles');
  await page.getByLabel('Away team', { exact: true }).fill('Sync Falcons');
  await page.getByRole('button', { name: 'Create match', exact: true }).click();
  await page.getByRole('button', { name: 'Start Set 1', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add point for Sync Eagles', exact: true })
    .click();
  await goHome(page);
  const email = `history-${browserName}@example.com`;
  await signIn(page, email);
  const secondContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    viewerContext = await browser.newContext();
  const second = await secondContext.newPage(),
    viewer = await viewerContext.newPage();
  second.on('dialog', (d) => d.accept());
  try {
    await second.goto('http://127.0.0.1:4174/volleyball-scorekeeper/');
    await signIn(second, email, true);
    await openCupGame(second);
    const secondHome = second.getByRole('button', {
      name: 'Add point for Sync Eagles',
      exact: true,
    });
    await expect(secondHome.locator('.score')).toHaveText('1');
    await expect(secondHome).toBeDisabled();
    await expect(
      second.getByRole('button', { name: 'Take over scoring', exact: true }),
    ).toBeEnabled();
    await openCupGame(page);
    await expect(
      page.getByRole('button', { name: 'Take over scoring', exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Start live sharing', exact: true })
      .click();
    await expect(
      page.getByText('The latest saved score is published.', { exact: true }),
    ).toBeVisible();
    const url = await page.getByLabel('Live score link').inputValue();
    await viewer.goto(url);
    await expect(viewer.locator('.public-points')).toHaveText(['1', '0']);
    await expect(second.getByLabel('Live score link')).toHaveValue(url);
    await context.setOffline(true);
    await page
      .getByRole('button', { name: 'Add point for Sync Eagles', exact: true })
      .click();
    await expect(
      page
        .getByRole('button', { name: 'Add point for Sync Eagles', exact: true })
        .locator('.score'),
    ).toHaveText('2');
    if (browserName === 'chromium') {
      await page.reload();
      await page
        .getByRole('button', { name: 'Resume match', exact: true })
        .click();
      await expect(
        page
          .getByRole('button', {
            name: 'Add point for Sync Eagles',
            exact: true,
          })
          .locator('.score'),
      ).toHaveText('2');
    }
    await context.setOffline(false);
    await expect(secondHome.locator('.score')).toHaveText('2');
    await expect(viewer.locator('.public-points')).toHaveText(['2', '0']);
    // A transfer is exceptional: the normal device continues without an extra button.
    await context.setOffline(true);
    await page
      .getByRole('button', { name: 'Add point for Sync Eagles', exact: true })
      .click();
    await second
      .getByRole('button', { name: 'Take over scoring', exact: true })
      .click();
    await expect(secondHome).toBeEnabled();
    await second
      .getByRole('button', { name: 'Add point for Sync Falcons', exact: true })
      .click();
    await expect(viewer.locator('.public-points')).toHaveText(['2', '1']);
    await context.setOffline(false);
    await expect(
      page.getByRole('button', {
        name: 'Add point for Sync Eagles',
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      page
        .getByRole('button', { name: 'Add point for Sync Eagles', exact: true })
        .locator('.score'),
    ).toHaveText('2');
    await expect(viewer.locator('.public-points')).toHaveText(['2', '1']);
    await expect(second.getByLabel('Live score link')).toHaveValue(url);
    await second
      .getByRole('button', { name: 'View events', exact: true })
      .click();
    await expect(second.locator('.event-list li')).toHaveCount(5);
    await second.screenshot({
      path: testInfo.outputPath('history-sync-scorer.png'),
      fullPage: true,
    });
    await goHome(page);
    await expect(
      page
        .locator('.match-list .list-card')
        .filter({ hasText: 'Sync Eagles (saved copy)' }),
    ).toContainText('3–0');
    await page
      .locator('.match-list .list-card')
      .filter({ hasText: 'Sync Eagles (saved copy)' })
      .click();
    const downloadPromise = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Export game backup', exact: true })
      .click();
    const downloaded = await downloadPromise;
    const backup = JSON.parse(
      await readFile((await downloaded.path())!, 'utf8'),
    );
    expect(
      backup.events.filter(
        (e: { action: string }) => e.action === 'HOME_POINT',
      ),
    ).toHaveLength(3);
    await goHome(page);
    await page
      .getByRole('button', { name: 'Sign out of sync', exact: true })
      .click();
    await signIn(page, `other-${email}`);
    await expect(page.locator('.tournament-card')).toHaveCount(0);
    await expect(page.locator('.match-list .list-card')).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Sign out of sync', exact: true })
      .click();
    await signIn(page, email, true);
    await expect(
      page.locator('.match-list .list-card').filter({ hasText: 'saved copy' }),
    ).toBeVisible();
    await second.getByRole('button', { name: 'End set', exact: true }).click();
    await second
      .getByRole('dialog')
      .getByRole('button', { name: 'End set', exact: true })
      .click();
    await second
      .getByRole('button', { name: 'Complete match', exact: true })
      .click();
    await second
      .getByRole('dialog')
      .getByRole('button', { name: 'Complete match', exact: true })
      .click();
    await expect(viewer.getByText('FINAL', { exact: true })).toBeVisible();
    await openCupGame(page);
    await expect(
      page.getByText('MATCH COMPLETE', { exact: true }),
    ).toBeVisible();
    const restoredContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    try {
      const restored = await restoredContext.newPage();
      await restored.goto('http://127.0.0.1:4174/volleyball-scorekeeper/');
      await signIn(restored, email, true);
      await openCupGame(restored);
      await expect(
        restored.getByText('MATCH COMPLETE', { exact: true }),
      ).toBeVisible();
      await expect(restored.getByLabel('Live score link')).toHaveValue(url);
      await restored
        .getByRole('button', { name: 'View events', exact: true })
        .click();
      await expect(restored.locator('.event-list li')).toHaveCount(7);
    } finally {
      await restoredContext.close();
    }
    await second.getByText('Match management', { exact: true }).click();
    await second
      .getByRole('button', { name: 'Delete match', exact: true })
      .click();
    await second
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete permanently', exact: true })
      .click();
    await expect(
      page.getByText('This record is no longer available.', { exact: true }),
    ).toBeVisible();
    await expect(
      viewer.getByRole('heading', { name: 'Score unavailable', exact: true }),
    ).toBeVisible();
    await second.getByText('Tournament management', { exact: true }).click();
    await second
      .getByRole('button', { name: 'Delete tournament', exact: true })
      .click();
    await second.getByRole('dialog').getByLabel(/Type/).fill('Sync Cup');
    await second
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete permanently', exact: true })
      .click();
    await expect(second.locator('.tournament-card')).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Back to home', exact: true })
      .click();
    await expect(page.locator('.tournament-card')).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('history-sync-library.png'),
      fullPage: true,
    });
  } finally {
    await secondContext.close();
    await viewerContext.close();
  }
});
