import { expect, test } from '@playwright/test';
test('delete a saved team with confirmation, preserve its game and prevent stale editor resurrection', async ({
  page,
  context,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: '+ New game', exact: true }).click();
  await page.getByLabel('Home team', { exact: true }).fill('Test team');
  await page.getByLabel('Away team', { exact: true }).fill('Keep me');
  await page.getByRole('button', { name: 'Create game', exact: true }).click();
  await page.getByRole('button', { name: 'Start Set 1' }).click();
  await page.getByRole('button', { name: 'Add point for Test team' }).click();
  await page.getByRole('button', { name: 'Save & leave scoring' }).click();
  const team = page
    .locator('.team-library')
    .getByRole('button', { name: 'Test team Edit team', exact: true });
  await team.click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('button', { name: 'Delete team', exact: true })
    .click();
  await expect(
    dialog.getByRole('heading', { name: 'Delete Test team?' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Edit team' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(team).toBeVisible();
  const second = await context.newPage();
  await second.goto('./');
  await second
    .locator('.team-library')
    .getByRole('button', { name: 'Test team Edit team', exact: true })
    .click();
  await team.click();
  await dialog
    .getByRole('button', { name: 'Delete team', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Delete permanently', exact: true })
    .click();
  await expect(team).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Your teams 1', exact: true }),
  ).toBeVisible();
  await second.getByRole('button', { name: 'Save team', exact: true }).click();
  await expect(second.getByRole('dialog')).toContainText(
    'This team has been deleted in another tab',
  );
  await second.close();
  await page.reload();
  await expect(team).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume match' }).click();
  await expect(
    page
      .getByRole('button', { name: 'Add point for Test team' })
      .locator('.score'),
  ).toHaveText('1');
});
