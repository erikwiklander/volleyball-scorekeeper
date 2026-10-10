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
    await popup.locator('#display-name-input').fill('Team Sync Tester');
    await popup.locator('form button[type=submit]').click();
  }
  await expect(
    page.getByText(`Library · ${email}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Teams are synced.', { exact: true }),
  ).toBeVisible();
}
async function addTeam(
  page: Page,
  name: string,
  sport = 'volleyball',
  logo = false,
) {
  await page.getByRole('button', { name: '+ Add team', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Team name', { exact: true }).fill(name);
  await dialog
    .getByRole('combobox', { name: 'Sport', exact: true })
    .selectOption(sport);
  await dialog.getByLabel('Team color', { exact: true }).fill('#225588');
  if (
    !(await dialog.getByLabel('Team short name', { exact: true }).isVisible())
  )
    await dialog
      .getByText('Short name, logo & secondary color', { exact: true })
      .click();
  await dialog.getByLabel('Team short name', { exact: true }).fill('SYNC');
  await dialog.getByLabel('Use secondary color').check();
  if (logo) {
    await dialog.getByLabel('Team logo', { exact: true }).setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: await readFile('public/icon-192.png'),
    });
    await expect(dialog.getByAltText(`${name} logo`)).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'Save team', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
const teamCard = (page: Page, name: string) =>
  page
    .locator('.team-list .list-card')
    .filter({ has: page.getByText(name, { exact: true }) });
async function rename(page: Page, old: string, name: string) {
  await teamCard(page, old).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Team name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Save team', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test('teams migrate, sync between devices, survive offline reload, propagate deletion and stay account-private', async ({
  page,
  context,
  browser,
  browserName,
}, testInfo) => {
  await page.goto('./');
  await expect(page.getByText('Offline ready', { exact: true })).toBeVisible();
  await addTeam(page, 'Cloud Eagles', 'volleyball', true);
  await addTeam(page, 'Cloud Football', 'football');
  const email = `team-sync-${browserName}@example.com`;
  await signIn(page, email);
  const secondContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const second = await secondContext.newPage();
  try {
    await second.goto('http://127.0.0.1:4174/volleyball-scorekeeper/');
    await signIn(second, email, true);
    await expect(teamCard(second, 'Cloud Eagles')).toBeVisible();
    await expect(teamCard(second, 'Cloud Football')).toContainText('Football');
    await expect(teamCard(second, 'Cloud Eagles').locator('img')).toHaveCount(
      1,
    );
    await teamCard(second, 'Cloud Eagles').click();
    await expect(
      second.getByRole('dialog').getByLabel('Team color', { exact: true }),
    ).toHaveValue('#225588');
    await expect(
      second
        .getByRole('dialog')
        .getByLabel('Team secondary color', { exact: true }),
    ).toHaveValue('#ffffff');
    await second
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await rename(second, 'Cloud Eagles', 'Renamed Eagles');
    await expect(teamCard(page, 'Renamed Eagles')).toBeVisible();
    await context.setOffline(true);
    await rename(page, 'Renamed Eagles', 'Offline Eagles');
    await expect(
      page.getByText('Teams are saved here. Sync resumes when connected.', {
        exact: true,
      }),
    ).toBeVisible();
    if (browserName === 'chromium') {
      await page.reload();
      await expect(teamCard(page, 'Offline Eagles')).toBeVisible();
    }
    await context.setOffline(false);
    await expect(teamCard(second, 'Offline Eagles')).toBeVisible();
    await expect(
      page.getByText('Teams are synced.', { exact: true }),
    ).toBeVisible();
    await context.setOffline(true);
    await rename(page, 'Offline Eagles', 'My offline Eagles');
    await rename(second, 'Offline Eagles', 'Cloud latest Eagles');
    await expect(
      second.getByText('Teams are synced.', { exact: true }),
    ).toBeVisible();
    await context.setOffline(false);
    await expect(teamCard(page, 'Cloud latest Eagles')).toBeVisible();
    await expect(
      teamCard(second, 'My offline Eagles (saved copy)'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Dismiss sync notice' }),
    ).toBeVisible();
    await context.setOffline(true);
    await teamCard(second, 'Cloud Football').click();
    await second
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete team', exact: true })
      .click();
    await second
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete permanently', exact: true })
      .click();
    await expect(teamCard(second, 'Cloud Football')).toHaveCount(0);
    await context.setOffline(false);
    await expect(teamCard(page, 'Cloud Football')).toHaveCount(0);
    await second
      .getByRole('button', { name: 'Sign out of sync', exact: true })
      .click();
    await signIn(second, `other-${email}`);
    await expect(second.locator('.team-list .list-card')).toHaveCount(0);
    await addTeam(second, 'Other account team');
    await expect(
      second.getByText('Teams are synced.', { exact: true }),
    ).toBeVisible();
    await expect(teamCard(page, 'Other account team')).toHaveCount(0);
    await second
      .getByRole('button', { name: 'Sign out of sync', exact: true })
      .click();
    await signIn(second, email, true);
    await expect(teamCard(second, 'Cloud latest Eagles')).toBeVisible();
    await expect(teamCard(second, 'Other account team')).toHaveCount(0);
    await expect(teamCard(second, 'Cloud Football')).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('team-sync.png'),
      fullPage: true,
    });
  } finally {
    await secondContext.close();
  }
});
