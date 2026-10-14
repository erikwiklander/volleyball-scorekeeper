import { onValueWritten } from 'firebase-functions/v2/database';
import { defineSecret, defineString } from 'firebase-functions/params';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import {
  createRecapProcessor,
  generateRecap,
  mirrorPublicRecap,
} from './recap.js';
const key = defineSecret('OPENAI_API_KEY');
const databaseUrl = defineString('LIVE_DATABASE_URL');
let processRecap;
export const gameRecap = onValueWritten(
  {
    ref: '/users/{uid}/games/{gameId}',
    region: 'us-central1',
    memory: '256MiB',
    cpu: 'gcf_gen1',
    concurrency: 1,
    minInstances: 0,
    maxInstances: 1,
    timeoutSeconds: 60,
    retry: false,
    secrets: [key],
  },
  async (event) => {
    if (event.data.after.val()?.deleted || !event.data.after.val()?.payload)
      return;
    processRecap ??= createRecapProcessor({
      database: getDatabase(
        getApps()[0] ?? initializeApp({ databaseURL: databaseUrl.value() }),
      ),
      generate: (facts) => generateRecap(facts, key.value()),
    });
    await processRecap(event.params);
  },
);

export const sharedGameRecap = onValueWritten(
  {
    ref: '/matches/{publicId}',
    region: 'us-central1',
    memory: '256MiB',
    cpu: 'gcf_gen1',
    concurrency: 1,
    minInstances: 0,
    maxInstances: 1,
    timeoutSeconds: 30,
    retry: false,
  },
  async (event) => {
    // Skip every ordinary live point; only availability or final results matter.
    if (
      event.data.before.val()?.match?.status !== 'completed' &&
      event.data.after.val()?.match?.status !== 'completed'
    )
      return;
    const database = getDatabase(
      getApps()[0] ?? initializeApp({ databaseURL: databaseUrl.value() }),
    );
    await mirrorPublicRecap(database, event.params.publicId);
  },
);
