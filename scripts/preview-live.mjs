import { readFileSync } from 'node:fs';
import { preview } from 'vite';
import { createPreviewHandler } from '../functions/preview.js';
import { prepareMatchup } from '../functions/matchup.js';
import { initializeApp } from '../functions/node_modules/firebase-admin/lib/esm/app/index.js';
import { getDatabase } from '../functions/node_modules/firebase-admin/lib/esm/database/index.js';
import { createAnalyticsHandler } from '../functions/analytics.js';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000';
const analytics = createAnalyticsHandler({
  database: getDatabase(
    initializeApp({
      projectId: 'demo-volleyball-scorekeeper',
      databaseURL:
        'https://demo-volleyball-scorekeeper-default-rtdb.firebaseio.com',
    }),
  ),
});
const base = '/volleyball-scorekeeper/';
const handler = createPreviewHandler({
  shell: readFileSync('dist-live/index.html', 'utf8'),
  origin: 'http://127.0.0.1:4174',
  readMetadata: async (id) => {
    const result = await fetch(
      `http://127.0.0.1:9000/matches/${id}.json?ns=demo-volleyball-scorekeeper-default-rtdb`,
    );
    if (!result.ok) throw new Error('Unavailable');
    const data = await result.json();
    return prepareMatchup({
      published: data?.published,
      home: data?.match?.home?.name,
      away: data?.match?.away?.name,
      homeLogo: data?.match?.home?.logo,
      awayLogo: data?.match?.away?.logo,
      homeColor: data?.match?.home?.color,
      awayColor: data?.match?.away?.color,
    });
  },
});
const server = await preview({
  configFile: false,
  base,
  build: { outDir: 'dist-live' },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
});
server.middlewares.use(async (req, res, next) => {
  if (req.url === base + 'api/analytics') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let event;
    try {
      event = JSON.parse(body);
    } catch {
      res.statusCode = 400;
      res.end();
      return;
    }
    return analytics(
      { method: req.method, body: event },
      {
        set(key, value) {
          res.setHeader(key, value);
          return this;
        },
        status(value) {
          res.statusCode = value;
          return this;
        },
        send(value) {
          res.end(value);
          return this;
        },
      },
    );
  }
  if (!req.url.startsWith(base + 'live/')) return next();
  await handler(
    { method: req.method, originalUrl: '/' + req.url.slice(base.length) },
    {
      set(key, value) {
        res.setHeader(key, value);
        return this;
      },
      type() {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return this;
      },
      status(value) {
        res.statusCode = value;
        return this;
      },
      send(html) {
        res.end(html.replace('<base href="/" />', `<base href="${base}" />`));
        return this;
      },
    },
  );
});
server.middlewares.stack.unshift(server.middlewares.stack.pop());
