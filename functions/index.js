import { readFileSync } from 'node:fs';
import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { cachedMetadata, createPreviewHandler } from './preview.js';
const databaseUrl = defineString('LIVE_DATABASE_URL');
const viewerOrigin = defineString('LIVE_VIEWER_ORIGIN');
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
        // Fetch only public metadata, avoiding the large embedded team logos.
        const values = await Promise.all(
          ['published', 'match/home/name', 'match/away/name'].map(
            async (field) => {
              const url = new URL(
                `matches/${publicId}/${field}.json`,
                databaseUrl.value().replace(/\/$/, '') + '/',
              );
              const result = await fetch(url, {
                signal: AbortSignal.timeout(3_000),
              });
              if (!result.ok) throw new Error('Live score unavailable');
              return result.json();
            },
          ),
        );
        return { published: values[0], home: values[1], away: values[2] };
      }),
    });
    return handler(request, response);
  },
);
