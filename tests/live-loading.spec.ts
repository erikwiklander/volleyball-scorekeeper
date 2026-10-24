import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
// @ts-expect-error The production preview handler is plain JavaScript.
import { createPreviewHandler } from '../functions/preview.js';

for (const scenario of [
  'old nested assets',
  'old root assets',
  'new cached shell',
]) {
  test(`shared links load from a service-worker cache: ${scenario}`, async ({
    page,
  }) => {
    const root = resolve('dist');
    const shell = await readFile(resolve(root, 'index.html'), 'utf8');
    let cached = shell;
    if (scenario !== 'new cached shell') {
      cached = cached
        .replace(/<script>[\s\S]*?<\/script>/, '')
        .replace(
          /\.\/assets\/index-[\w-]+\.(js|css)/g,
          './assets/index-previous.$1',
        );
      if (scenario === 'old root assets')
        cached = cached.replace('<head>', '<head><base href="/">');
    }
    const recovered: string[] = [];
    const server = createServer(async (request, response) => {
      const path = new URL(request.url!, 'http://localhost').pathname;
      response.setHeader('Cache-Control', 'no-store');
      if (path === '/seed') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<html><body>Seed old cache</body></html>');
        return;
      }
      if (path === '/legacy-shell.html') {
        response.setHeader('Content-Type', 'text/html');
        response.end(cached);
        return;
      }
      if (path === '/legacy-sw.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(`
          self.addEventListener('install', event => event.waitUntil(
            caches.open('legacy-viewer').then(cache => cache.add('/legacy-shell.html'))
          ));
          self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
          self.addEventListener('fetch', event => {
            if (event.request.mode === 'navigate') event.respondWith(caches.match('/legacy-shell.html'));
          });
        `);
        return;
      }
      const file = resolve(root, '.' + path);
      if (file.startsWith(root + '/')) {
        try {
          const bytes = await readFile(file);
          response.setHeader(
            'Content-Type',
            (
              {
                '.js': 'text/javascript',
                '.css': 'text/css',
                '.svg': 'image/svg+xml',
                '.png': 'image/png',
                '.webmanifest': 'application/manifest+json',
              } as Record<string, string>
            )[extname(file)] || 'application/octet-stream',
          );
          response.end(bytes);
          return;
        } catch {
          /* Missing old entry files fall through to the Hosting rewrite. */
        }
      }
      recovered.push(path);
      await handler(
        { method: request.method, originalUrl: request.url },
        {
          set(key: string, value: string) {
            response.setHeader(key, value);
            return this;
          },
          type(type: string) {
            response.setHeader(
              'Content-Type',
              (
                {
                  js: 'text/javascript',
                  css: 'text/css',
                  html: 'text/html',
                } as Record<string, string>
              )[type],
            );
            return this;
          },
          status(code: number) {
            response.statusCode = code;
            return this;
          },
          send(body: string) {
            response.end(body);
            return this;
          },
        },
      );
    });
    let handler: ReturnType<typeof createPreviewHandler>;
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    handler = createPreviewHandler({
      shell,
      origin,
      readMetadata: async () => null,
    });
    try {
      await page.goto(origin + '/seed');
      await page.evaluate(async () => {
        localStorage.setItem('saved-game-marker', 'kept');
        await navigator.serviceWorker.register('/legacy-sw.js');
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller)
          await new Promise<void>((resolve) =>
            navigator.serviceWorker.addEventListener(
              'controllerchange',
              () => resolve(),
              { once: true },
            ),
          );
      });
      const url = origin + '/live/cached-match?preview=2';
      await page.goto(url);
      await expect(page.locator('.brand-title')).toHaveText('Live scoreboard.');
      await expect(page.locator('.build-version')).toContainText('v1.9.1');
      expect(await page.evaluate(() => document.baseURI)).toBe(origin + '/');
      await expect(page.locator('.public-scoreboard')).toHaveCSS(
        'max-width',
        '780px',
      );
      expect(page.url()).toBe(url);
      expect(
        await page.evaluate(() => localStorage.getItem('saved-game-marker')),
      ).toBe('kept');
      if (scenario !== 'new cached shell')
        expect(recovered).toContain(
          (scenario === 'old root assets' ? '' : '/live') +
            '/assets/index-previous.js',
        );
      // Chromium can speculatively request relative assets before the inline
      // base script runs. Those requests also use the compatibility handler;
      // the actual page must still render with the correct base and styles.
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
