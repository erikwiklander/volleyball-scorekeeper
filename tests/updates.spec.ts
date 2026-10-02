import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { test, expect } from '@playwright/test';

// Serve a real production worker, then change its bytes to simulate deployment.
// Browser routing mocks do not exercise the service-worker update lifecycle.
test('updates wait for a safe reload and retain scores across two open tabs', async ({
  page,
  context,
}) => {
  let deployment = 1;
  const root = resolve('dist');
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    const relative =
      url.pathname.replace(/^\/volleyball-scorekeeper\//, '') || 'index.html';
    const file = resolve(root, relative);
    if (!file.startsWith(root + '/')) {
      response.writeHead(404).end();
      return;
    }
    try {
      const bytes = await readFile(file);
      const types: Record<string, string> = {
        '.js': 'text/javascript',
        '.html': 'text/html',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.webmanifest': 'application/manifest+json',
      };
      response.writeHead(200, {
        'Content-Type': types[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(
        relative === 'sw.js'
          ? `${bytes.toString()}\n// Deployment ${deployment}\n`
          : bytes,
      );
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/volleyball-scorekeeper/`;
  try {
    await page.goto(url);
    await expect(
      page.getByText('Offline ready', { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: '+ New game' }).click();
    await page.getByLabel('Home team', { exact: true }).fill('Roots');
    await page.getByLabel('Away team', { exact: true }).fill('Austin');
    await page
      .getByRole('button', { name: 'Create game', exact: true })
      .click();
    await page.getByRole('button', { name: 'Start Set 1' }).click();
    const home = page.getByRole('button', { name: 'Add point for Roots' });
    await home.click();
    await expect(home.locator('.score')).toHaveText('1');
    const second = await context.newPage();
    await second.goto(url);
    await second.getByRole('button', { name: 'Resume match' }).click();
    const secondHome = second.getByRole('button', {
      name: 'Add point for Roots',
    });
    await expect(secondHome.locator('.score')).toHaveText('1');
    let secondNavigations = 0;
    second.on('framenavigated', (frame) => {
      if (frame === second.mainFrame()) secondNavigations++;
    });
    deployment = 2;
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(
      page.getByRole('button', { name: 'Update & reload' }),
    ).toBeDisabled();
    await expect(page.getByLabel('App updates')).toContainText(
      'An update is ready',
    );
    await home.click();
    await expect(home.locator('.score')).toHaveText('2');
    await page.getByRole('button', { name: 'Save & leave scoring' }).click();
    await page.getByRole('button', { name: 'Update & reload' }).click();
    await expect(
      page.getByRole('button', { name: 'Resume match' }),
    ).toBeVisible();
    expect(secondNavigations).toBe(0);
    await secondHome.click();
    await expect(secondHome.locator('.score')).toHaveText('3');
    await page.getByRole('button', { name: 'Resume match' }).click();
    await expect(home.locator('.score')).toHaveText('3');
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(page.getByLabel('App updates')).toContainText(
      'You’re offline',
    );
    await home.click();
    await expect(home.locator('.score')).toHaveText('4');
    await second.close();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
