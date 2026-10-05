import { test, expect } from '@playwright/test';
test('football viewer recovers scorer and viewer connections with cumulative quarter totals', async ({
  page,
  context,
  browser,
  browserName,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: '+ New game', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Sport', exact: true })
    .selectOption('football');
  await page.getByLabel('Home team', { exact: true }).fill('Tigers');
  await page.getByLabel('Away team', { exact: true }).fill('Bears');
  await page.getByRole('button', { name: 'Create game', exact: true }).click();
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
  await popup
    .locator('#email-input')
    .fill(`football-${browserName}@example.com`);
  await popup.locator('#display-name-input').fill('Football Scorer');
  await popup.locator('form button[type=submit]').click();
  await expect(
    page.getByRole('button', { name: 'Start live sharing' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Start live sharing' }).click();
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  try {
    await viewer.goto(await page.getByLabel('Live score link').inputValue());
    const totals = viewer.locator('.public-points');
    await expect(totals).toHaveText(['0', '0']);
    await page
      .getByRole('button', { name: 'Start Quarter 1', exact: true })
      .click();
    const home = page.getByRole('group', { name: 'Tigers scoring' });
    const away = page.getByRole('group', { name: 'Bears scoring' });
    await home
      .getByRole('button', { name: 'Touchdown +6', exact: true })
      .click();
    await expect(totals).toHaveText(['6', '0']);
    await context.setOffline(true);
    await home
      .getByRole('button', { name: 'Extra-point kick +2', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'End quarter 1', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'End quarter', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Start Quarter 2', exact: true })
      .click();
    await away
      .getByRole('button', { name: 'Touchdown +6', exact: true })
      .click();
    await away
      .getByRole('button', { name: 'Run / pass conversion +1', exact: true })
      .click();
    await expect(totals).toHaveText(['6', '0']);
    await context.setOffline(false);
    await expect(totals).toHaveText(['8', '7']);
    await viewerContext.setOffline(true);
    await home
      .getByRole('button', { name: 'Field goal +3', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'End quarter 2', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'End quarter', exact: true })
      .click();
    await viewerContext.setOffline(false);
    await expect(totals).toHaveText(['11', '7']);
    await expect(viewer.locator('.public-set')).toHaveText('Halftime');
    await expect(
      viewer.locator('.public-history tbody tr').first().locator('td'),
    ).toHaveText(['8', '3']);
    await page
      .getByRole('button', { name: 'Complete game', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Complete match', exact: true })
      .click();
    await expect(viewer.getByText('FINAL', { exact: true })).toBeVisible();
    await expect(totals).toHaveText(['11', '7']);
  } finally {
    await viewerContext.close();
  }
});
