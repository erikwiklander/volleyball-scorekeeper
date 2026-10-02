import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
test('complete courtside workflow survives reload and works offline', async ({
  page,
  context,
  browserName,
}, testInfo) => {
  await page.goto('./');
  await expect(page.getByText('Offline ready', { exact: true })).toBeVisible();
  await page.getByText('Tournaments (optional)', { exact: false }).click();
  await page.getByRole('button', { name: '+ New tournament' }).click();
  await page.getByLabel('Tournament name').fill('Grizzly Classic');
  await page.getByLabel('Default team name').fill('Vandegrift');
  await page.getByRole('button', { name: 'Save tournament' }).click();
  await page.getByRole('button', { name: '+ New match' }).click();
  await expect(page.getByLabel('Home team', { exact: true })).toHaveValue(
    'Vandegrift',
  );
  await page.getByLabel('Away team', { exact: true }).fill('Manor');
  await page.getByLabel('Home team color', { exact: true }).fill('#ffcc00');
  await page.getByLabel('Away team color', { exact: true }).fill('#003399');
  await page.getByRole('button', { name: 'Create match' }).click();
  await page.getByRole('button', { name: 'Start Set 1' }).click();
  const home = page.getByRole('button', { name: 'Add point for Vandegrift' });
  const away = page.getByRole('button', { name: 'Add point for Manor' });
  await expect(home).toHaveCSS('background-color', 'rgb(255, 204, 0)');
  await expect(home).toHaveCSS('color', 'rgb(0, 0, 0)');
  await expect(away).toHaveCSS('background-color', 'rgb(0, 51, 153)');
  await home.click();
  await expect(home.locator('.score')).toHaveText('1');
  await away.click();
  await expect(away.locator('.score')).toHaveText('1');
  await page.getByRole('button', { name: 'Undo last point' }).click();
  await expect(away.locator('.score')).toHaveText('0');
  await page.evaluate(() => {
    const dialog = document.querySelector('.sync-flash')!;
    const phases: string[] = [];
    const observer = new MutationObserver(() => {
      phases.push(dialog.className);
    });
    observer.observe(dialog, { attributes: true, attributeFilter: ['class'] });
    Object.assign(window, { syncPhases: phases });
  });
  await page.getByRole('button', { name: 'Video sync marker' }).click();
  const syncCard = page.getByRole('dialog', {
    name: 'Video synchronization marker',
  });
  await expect(syncCard).toBeVisible();
  await expect(syncCard).toContainText('SYNC 1');
  await expect(syncCard).toContainText('Vandegrift');
  await expect(syncCard).toContainText('Manor');
  const firstSyncTime = await syncCard.locator('time').getAttribute('datetime');
  await expect(syncCard).toContainText('Marker saved');
  await expect(syncCard).toContainText('SET 1');
  const phases = await page.evaluate(
    () => (window as unknown as { syncPhases: string[] }).syncPhases,
  );
  expect(phases).toEqual([
    'sync-flash sync-black',
    'sync-flash sync-white',
    'sync-flash sync-blackAfter',
    'sync-flash sync-info',
  ]);
  await page.screenshot({ path: testInfo.outputPath('sync-mobile.png') });
  await expect(syncCard).not.toBeVisible({ timeout: 5000 });
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Resume match' }).click();
  await expect(home.locator('.score')).toHaveText('1');
  await expect(home).toHaveCSS('background-color', 'rgb(255, 204, 0)');
  await page.getByRole('button', { name: 'Video sync marker' }).click();
  await expect(syncCard).toContainText('SYNC 2');
  await syncCard.getByRole('button', { name: 'Back to match' }).click();
  const awayBounds = await away.boundingBox();
  const undoBounds = await page
    .getByRole('button', { name: 'Undo last point' })
    .boundingBox();
  expect(awayBounds!.y + awayBounds!.height).toBeLessThanOrEqual(undoBounds!.y);
  await page.screenshot({
    path: testInfo.outputPath('scoring-mobile.png'),
    fullPage: true,
  });
  await context.setOffline(true);
  // WebKit offline navigation is blocked by Playwright issue #42775.
  // Both engines test reload recovery online and the remaining actions offline.
  if (browserName !== 'webkit') {
    await page.reload();
    await page.getByRole('button', { name: 'Resume match' }).click();
  }
  await home.click();
  await expect(home.locator('.score')).toHaveText('2');
  await page.getByRole('button', { name: 'End set', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'End set', exact: true })
    .click();
  await page.getByRole('button', { name: 'Start Set 2' }).click();
  await expect(home.locator('.score')).toHaveText('0');
  await away.click();
  await expect(away.locator('.score')).toHaveText('1');
  await page.getByRole('button', { name: 'End set', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'End set', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Complete match', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Complete match', exact: true })
    .click();
  await expect(page.getByText('MATCH COMPLETE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View events' }).click();
  await expect(page.locator('.event-list')).toContainText('undo');
  await expect(page.locator('.event-list')).toContainText('sync marker');
  const csvPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export match CSV' }).click();
  const csv = await csvPromise;
  expect(csv.suggestedFilename()).toBe('Vandegrift-vs-Manor.csv');
  const stream = await csv.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();
  expect(text).toContain('UNDO');
  expect(text).toContain('SYNC_MARKER');
  expect(text).toContain(firstSyncTime);
  expect(text).toContain('sync_number');
  expect(text).toContain('#ffcc00');
  expect(text).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  await page.getByRole('button', { name: '← Grizzly Classic' }).click();
  await expect(page.getByText('Final · 1–1 sets')).toBeVisible();
  const backupPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export tournament JSON' }).click();
  const backup = await backupPromise;
  await page.getByRole('button', { name: '+ New match' }).click();
  await page.getByLabel('Away team', { exact: true }).fill('Westlake');
  await page.getByRole('button', { name: 'Create match' }).click();
  await page.getByRole('button', { name: 'Start Set 1' }).click();
  await page.getByRole('button', { name: 'Save & leave scoring' }).click();
  await page.getByRole('button', { name: 'All tournaments' }).click();
  // WebKit's offline emulation also rejects local File.text() reads.
  if (browserName === 'webkit') await context.setOffline(false);
  const backupPath = (await backup.path())!;
  expect(JSON.parse(await readFile(backupPath, 'utf8')).schemaVersion).toBe(2);
  await page.getByLabel('Import backup').setInputFiles({
    name: 'tournament.json',
    mimeType: 'application/json',
    buffer: await readFile(backupPath),
  });
  await expect(page.getByRole('status')).toHaveText(
    'Backup imported as a new tournament.',
  );
  await page.getByRole('button', { name: 'All tournaments' }).click();
  await expect(page.locator('.tournament-card')).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('home-mobile.png'),
    fullPage: true,
  });
});

test('edit metadata and require an exact-name confirmation before cascade deletion', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByText('Tournaments (optional)', { exact: false }).click();
  await page.getByRole('button', { name: '+ New tournament' }).click();
  await page.getByLabel('Tournament name').fill('Practice');
  await page.getByRole('button', { name: 'Save tournament' }).click();
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByLabel('Tournament name').fill('Practice finals');
  await page.getByLabel('Location').fill('Austin');
  await page.getByRole('button', { name: 'Save tournament' }).click();
  await expect(
    page.getByRole('heading', { name: 'Practice finals', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '+ New match' }).click();
  await page.getByLabel('Home team', { exact: true }).fill('A');
  await page.getByLabel('Away team', { exact: true }).fill('B');
  await page.getByLabel('Home team color', { exact: true }).fill('#ff0000');
  await page.getByLabel('Away team color', { exact: true }).fill('#0000ff');
  await page.getByRole('button', { name: 'Swap home / away' }).click();
  await expect(page.getByLabel('Home team color', { exact: true })).toHaveValue(
    '#0000ff',
  );
  await expect(page.getByLabel('Away team color', { exact: true })).toHaveValue(
    '#ff0000',
  );
  await expect(page.getByLabel('Home team', { exact: true })).toHaveValue('B');
  await page.getByRole('button', { name: 'Create match' }).click();
  await page.getByRole('button', { name: 'Start Set 1' }).click();
  await page.getByRole('button', { name: 'Add point for B' }).click();
  await expect(
    page.getByRole('button', { name: 'Undo last point' }),
  ).toBeInViewport();
  await page.getByRole('button', { name: 'Save & leave scoring' }).click();
  await page.getByText('Tournament management', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Delete tournament', exact: true })
    .click();
  await page.getByLabel('Type the tournament name to confirm').fill('wrong');
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page
    .getByLabel('Type the tournament name to confirm')
    .fill('Practice finals');
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(
    page.getByRole('heading', { name: 'A fresh court.' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Resume match' })).toHaveCount(
    0,
  );
  const counts = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('volleyball-scorekeeper');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const values = await Promise.all(
      ['tournaments', 'matches', 'sets', 'events'].map(
        (store) =>
          new Promise<number>((resolve, reject) => {
            const r = db.transaction(store).objectStore(store).count();
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          }),
      ),
    );
    db.close();
    return values;
  });
  expect(counts).toEqual([0, 0, 0, 0]);
});

test('one-off game needs no tournament and supports recovery, completion and backup', async ({
  page,
  context,
  browserName,
}, testInfo) => {
  await page.goto('./');
  await expect(page.getByText('Offline ready', { exact: true })).toBeVisible();
  if (browserName === 'chromium') await context.setOffline(true);
  await page.getByRole('button', { name: '+ New game', exact: true }).click();
  await expect(page.getByLabel('Tournament name')).toHaveCount(0);
  await page.getByLabel('Home team', { exact: true }).fill('Eagles');
  await page.getByLabel('Away team', { exact: true }).fill('Falcons');
  await page.getByRole('button', { name: 'Create game', exact: true }).click();
  await page.getByRole('button', { name: 'Start Set 1' }).click();
  await page.getByRole('button', { name: 'Add point for Eagles' }).click();
  await expect(
    page
      .getByRole('button', { name: 'Add point for Eagles' })
      .locator('.score'),
  ).toHaveText('1');
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Resume match' }).click();
  await expect(
    page
      .getByRole('button', { name: 'Add point for Eagles' })
      .locator('.score'),
  ).toHaveText('1');
  await page.getByRole('button', { name: 'End set', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'End set', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Complete match', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Complete match', exact: true })
    .click();
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export match CSV' }).click();
  expect(await readFile((await (await csvDownload).path())!, 'utf8')).toContain(
    'Eagles',
  );
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export game backup' }).click();
  const bytes = await readFile((await (await backupDownload).path())!);
  expect(JSON.parse(bytes.toString()).tournament).toBeUndefined();
  await page.getByRole('button', { name: 'All games' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your games 1' }),
  ).toBeVisible();
  await expect(page.getByText('Tournaments (optional) · 0')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('one-off-home.png'),
    fullPage: true,
  });
  await page.getByLabel('Import backup').setInputFiles({
    name: 'game.json',
    mimeType: 'application/json',
    buffer: bytes,
  });
  await expect(page.getByRole('status')).toHaveText(
    'Backup imported as a new game.',
  );
  await expect(page.getByText('MATCH COMPLETE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All games' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your games 2' }),
  ).toBeVisible();
});

test('saved teams, offline logos and match overrides survive edits, reload and backup', async ({
  page,
  context,
  browserName,
}, testInfo) => {
  await page.goto('./');
  await expect(page.getByText('Offline ready', { exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: '+ Add team', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Team name', { exact: true }).fill('Roots 15 Green');
  await dialog.getByLabel('Team color', { exact: true }).fill('#008000');
  await dialog.getByText('Short name, logo & secondary color').click();
  await dialog.getByLabel('Team short name').fill('ROOTS');
  await dialog.getByLabel('Use secondary color').check();
  await dialog.getByLabel('Team secondary color').fill('#ffffff');
  // WebKit offline emulation blocks local file reads, including blob images.
  if (browserName === 'webkit') await context.setOffline(false);
  await dialog.getByLabel('Team logo', { exact: true }).setInputFiles({
    name: 'roots.png',
    mimeType: 'image/png',
    buffer: await readFile('public/icon-192.png'),
  });
  await expect(dialog.getByAltText('Roots 15 Green logo')).toBeVisible();
  await context.setOffline(true);
  await dialog.getByRole('button', { name: 'Save team', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your teams 1' }),
  ).toBeVisible();
  await page.getByText('Tournaments (optional)', { exact: false }).click();
  await page.getByRole('button', { name: '+ New tournament' }).click();
  await page.getByLabel('Tournament name').fill('Team library cup');
  await page
    .getByLabel('Default saved team')
    .selectOption({ label: 'Roots 15 Green' });
  await page.getByRole('button', { name: 'Save tournament' }).click();
  await page.getByRole('button', { name: '+ New match' }).click();
  await expect(page.getByLabel('Home team', { exact: true })).toHaveValue(
    'Roots 15 Green',
  );
  await page.getByLabel('Home team color', { exact: true }).fill('#0000ff');
  await page.getByLabel('Away team', { exact: true }).fill('Austin Juniors');
  await page.getByRole('button', { name: 'Swap home / away' }).click();
  await expect(page.getByLabel('Away team', { exact: true })).toHaveValue(
    'Roots 15 Green',
  );
  await expect(page.getByLabel('Away team color', { exact: true })).toHaveValue(
    '#0000ff',
  );
  await page.getByRole('button', { name: 'Swap home / away' }).click();
  await page.getByRole('button', { name: 'Create match' }).click();
  await expect(
    page.getByRole('button', { name: 'Video sync marker' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Start Set 1' }).click();
  const home = page.getByRole('button', {
    name: 'Add point for Roots 15 Green',
  });
  await expect(home).toHaveCSS('background-color', 'rgb(0, 0, 255)');
  await expect(home.locator('img')).toBeVisible();
  await home.click();
  await page.getByRole('button', { name: 'Save & leave scoring' }).click();
  await page.getByRole('button', { name: 'All tournaments' }).click();
  await page
    .locator('.team-list')
    .getByRole('button', { name: 'Roots 15 Green ROOTS' })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Team name', { exact: true }).fill('Roots renamed');
  await dialog.getByLabel('Team color', { exact: true }).fill('#ff0000');
  await dialog.getByRole('button', { name: 'Save team', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.team-list')).toContainText('Roots renamed');
  page.on('dialog', (d) => d.accept());
  if (browserName === 'webkit') await context.setOffline(false);
  await page.reload();
  await page.getByRole('button', { name: 'Resume match' }).click();
  await expect(home.locator('.score')).toHaveText('1');
  await expect(home).toHaveCSS('background-color', 'rgb(0, 0, 255)');
  await expect(home.locator('img')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('team-logo-scoring.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Save & leave scoring' }).click();
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export tournament JSON' }).click();
  const bytes = await readFile((await (await backupDownload).path())!);
  const backup = JSON.parse(bytes.toString());
  expect(backup.teams).toHaveLength(2);
  expect(backup.matches[0].home.displayName).toBe('Roots 15 Green');
  expect(backup.matches[0].home.logo).toMatch(/^data:image\/png;base64,/);
  expect(
    backup.teams.find((team: { name: string }) => team.name === 'Roots renamed')
      .primaryColor,
  ).toBe('#ff0000');
  await page.getByRole('button', { name: 'All tournaments' }).click();
  await page.getByLabel('Import backup').setInputFiles({
    name: 'teams.json',
    mimeType: 'application/json',
    buffer: bytes,
  });
  await expect(page.getByRole('status')).toHaveText(
    'Backup imported as a new tournament.',
  );
  await page
    .getByRole('button', { name: /Roots 15 Green vs Austin Juniors/ })
    .click();
  await expect(home.locator('img')).toBeVisible();
  await expect(home.locator('.score')).toHaveText('1');
});
