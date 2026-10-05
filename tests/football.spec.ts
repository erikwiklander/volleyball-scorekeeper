import { test, expect } from '@playwright/test';
test('football quarters, Pop Warner scoring, undo and offline recovery', async ({
  page,
  context,
  browserName,
}, testInfo) => {
  await page.goto('./');
  await expect(page.getByText('Offline ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '+ New game', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Sport', exact: true })
    .selectOption('football');
  await page.getByLabel('Home team', { exact: true }).fill('Tigers');
  await page.getByLabel('Away team', { exact: true }).fill('Bears');
  await page.getByRole('button', { name: 'Create game', exact: true }).click();
  await page
    .getByRole('button', { name: 'Start Quarter 1', exact: true })
    .click();
  const home = page.getByRole('group', { name: 'Tigers scoring' });
  const away = page.getByRole('group', { name: 'Bears scoring' });
  const totals = page.locator('.football-team .score');
  await home.getByRole('button', { name: 'Touchdown +6', exact: true }).click();
  await home
    .getByRole('button', { name: 'Extra-point kick +2', exact: true })
    .click();
  await away.getByRole('button', { name: 'Touchdown +6', exact: true }).click();
  await away
    .getByRole('button', { name: 'Run / pass conversion +1', exact: true })
    .click();
  await expect(totals).toHaveText(['8', '7']);
  const left = await page.locator('.football-team').first().boundingBox();
  const right = await page.locator('.football-team').last().boundingBox();
  expect(left!.y).toBe(right!.y);
  expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x);
  const lastScore = await home
    .getByRole('button', { name: 'Safety +2', exact: true })
    .boundingBox();
  const undo = await page
    .getByRole('button', { name: 'Undo last score' })
    .boundingBox();
  expect(lastScore!.y + lastScore!.height).toBeLessThanOrEqual(undo!.y);
  await page.screenshot({
    path: testInfo.outputPath('football-mobile.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.setOffline(true);
  await home
    .getByRole('button', { name: 'Field goal +3', exact: true })
    .click();
  await page.getByRole('button', { name: 'Undo last score' }).click();
  await expect(totals).toHaveText(['8', '7']);
  page.on('dialog', (d) => d.accept());
  if (browserName !== 'webkit') {
    await page.reload();
    await page.getByRole('button', { name: 'Resume match' }).click();
    await expect(totals).toHaveText(['8', '7']);
  }
  for (let quarter = 1; quarter <= 4; quarter++) {
    await page
      .getByRole('button', { name: `End quarter ${quarter}`, exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'End quarter', exact: true })
      .click();
    if (quarter === 2)
      await expect(
        page.getByRole('heading', { name: 'Halftime', exact: true }),
      ).toBeVisible();
    if (quarter < 4)
      await page
        .getByRole('button', {
          name: `Start Quarter ${quarter + 1}`,
          exact: true,
        })
        .click();
  }
  await page.getByRole('button', { name: 'Start OT 1', exact: true }).click();
  await away.getByRole('button', { name: 'Safety +2', exact: true }).click();
  await expect(totals).toHaveText(['8', '9']);
  await page.getByRole('button', { name: 'End ot 1', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'End quarter', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Complete game', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Complete match', exact: true })
    .click();
  await expect(page.getByText('Final score', { exact: true })).toBeVisible();
  await expect(totals).toHaveText(['8', '9']);
  await context.setOffline(false);
  await page.reload();
  await page.getByRole('button', { name: 'Volleyball', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Tigers vs Bears/ }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Football', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Tigers vs Bears.*Final · 8–9/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: '+ New game', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Sport', exact: true }),
  ).toHaveValue('football');
  await page
    .getByRole('combobox', { name: 'Home team selection', exact: true })
    .selectOption({ label: 'Tigers' });
  await page
    .getByRole('combobox', { name: 'Sport', exact: true })
    .selectOption('volleyball');
  await expect(
    page
      .getByRole('combobox', { name: 'Home team selection', exact: true })
      .locator('option'),
  ).toHaveText(['+ Add new team']);
});
