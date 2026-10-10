import { readFileSync } from 'node:fs';
import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { cachedMetadata, createPreviewHandler } from './preview.js';
import { prepareMatchup } from './matchup.js';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { createAnalyticsHandler } from './analytics.js';
const databaseUrl = defineString('LIVE_DATABASE_URL');
const viewerOrigin = defineString('LIVE_VIEWER_ORIGIN');
const scorerOrigin = defineString('LIVE_SCORER_ORIGIN', {
  default: 'https://erikwiklander.github.io',
});
let analyticsHandler;
export const analyticsEvent = onRequest(
  {
    region: 'us-central1',
    memory: '256MiB',
    cpu: 'gcf_gen1',
    concurrency: 1,
    timeoutSeconds: 15,
    minInstances: 0,
    maxInstances: 1,
    invoker: 'public',
    cors: true,
  },
  (request, response) => {
    if (
      ![new URL(viewerOrigin.value()).origin, scorerOrigin.value()].includes(
        request.get('origin'),
      )
    )
      return response.status(403).send('Origin not allowed');
    analyticsHandler ??= createAnalyticsHandler({
      database: getDatabase(
        getApps()[0] ?? initializeApp({ databaseURL: databaseUrl.value() }),
      ),
    });
    return analyticsHandler(request, response);
  },
);
let handler;
export const livePreview = onRequest(
  {
    region: 'us-central1',
    memory: '256MiB',
    cpu: 'gcf_gen1',
    concurrency: 1,
    timeoutSeconds: 10,
    minInstances: 0,
    maxInstances: 1,
    invoker: 'public',
  },
  (request, response) => {
    handler ??= createPreviewHandler({
      shell: readFileSync(new URL('./viewer.html', import.meta.url), 'utf8'),
      origin: viewerOrigin.value(),
      readMetadata: cachedMetadata(async (publicId) => {
        // Fetch published team appearance once per cache refresh; scores are separate.
        const values = await Promise.all(
          ['published', 'match/home', 'match/away'].map(async (field) => {
            const url = new URL(
              `matches/${publicId}/${field}.json`,
              databaseUrl.value().replace(/\/$/, '') + '/',
            );
            const result = await fetch(url, {
              signal: AbortSignal.timeout(3_000),
            });
            if (!result.ok) throw new Error('Live score unavailable');
            return result.json();
          }),
        );
        return prepareMatchup({
          published: values[0],
          home: values[1]?.name,
          away: values[2]?.name,
          homeLogo: values[1]?.logo,
          awayLogo: values[2]?.logo,
          homeColor: values[1]?.color,
          awayColor: values[2]?.color,
        });
      }),
    });
    return handler(request, response);
  },
);
