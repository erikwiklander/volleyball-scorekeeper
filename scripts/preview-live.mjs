import { readFileSync } from 'node:fs';
import { preview } from 'vite';
import { createPreviewHandler } from '../functions/preview.js';
import { prepareMatchup } from '../functions/matchup.js';
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
