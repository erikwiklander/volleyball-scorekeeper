import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderPreview,
  cachedMetadata,
  createPreviewHandler,
} from './preview.js';
const shell =
  '<html><head><title>Scorekeeper</title><meta name="description" content="Generic" /><script src="./assets/app.js"></script></head><body></body></html>';
const origin = 'https://scorekeeper.example';
const metadata = { published: true, home: 'Eagles', away: 'Falcons' };
test('preview titles are present without JavaScript and the asset base comes first', () => {
  const html = renderPreview(shell, metadata, origin + '/live/abc', origin);
  assert.ok(html.includes('<title>Eagles vs Falcons — Live score</title>'));
  assert.ok(
    html.includes(
      'property="og:title" content="Eagles vs Falcons — Live score"',
    ),
  );
  assert.ok(
    html.includes(
      'name="twitter:title" content="Eagles vs Falcons — Live score"',
    ),
  );
  assert.ok(html.indexOf('<base') < html.indexOf('<script'));
  assert.equal((html.match(/name="description"/g) || []).length, 1);
});
test('team names are safely escaped in both titles and attributes', () => {
  const html = renderPreview(
    shell,
    { published: true, home: '\"><script>alert(1)</script>&', away: "O'Brien" },
    origin + '/live/abc',
    origin,
  );
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(
    html.includes('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;'),
  );
  assert.ok(html.includes('O&#39;Brien'));
});
test('unpublished, missing and malformed metadata does not expose team names', () => {
  for (const value of [
    null,
    {},
    { ...metadata, published: false },
    { ...metadata, home: 42 },
    { ...metadata, home: 'a'.repeat(101) },
  ]) {
    const html = renderPreview(shell, value, origin + '/live/abc', origin);
    assert.ok(html.includes('<title>Live score — Scorekeeper</title>'));
    assert.ok(!html.includes('Falcons'));
  }
});
test('metadata is cached per public ID and refreshed after expiry', async () => {
  let time = 0,
    calls = 0;
  const read = cachedMetadata(
    async () => ({ ...metadata, home: String(++calls) }),
    { now: () => time },
  );
  assert.equal((await read('abc')).home, '1');
  time = 59_999;
  assert.equal((await read('abc')).home, '1');
  time = 60_000;
  assert.equal((await read('abc')).home, '2');
});
test('unpublished and missing matches are cached too', async () => {
  let calls = 0;
  const read = cachedMetadata(async () => {
    calls++;
    return null;
  });
  await read('abc');
  await read('abc');
  assert.equal(calls, 1);
});
test('the cache has bounded capacity', async () => {
  let calls = 0;
  const read = cachedMetadata(
    async () => {
      calls++;
      return metadata;
    },
    { capacity: 2 },
  );
  await read('a');
  await read('b');
  await read('c');
  await read('a');
  assert.equal(calls, 4);
});
test('lookup throttling allows cached links and resets each minute', async () => {
  let time = 0;
  const read = cachedMetadata(async () => metadata, {
    now: () => time,
    lookupsPerMinute: 2,
  });
  await read('a');
  await read('b');
  await assert.rejects(read('c'), { status: 429 });
  assert.deepEqual(await read('a'), metadata);
  time = 60_000;
  assert.deepEqual(await read('c'), metadata);
});
test('failed reads consume lookup quota and are not cached', async () => {
  let calls = 0;
  const read = cachedMetadata(
    async () => {
      calls++;
      throw new Error('Unavailable');
    },
    { lookupsPerMinute: 2 },
  );
  await assert.rejects(read('a'), /Unavailable/);
  await assert.rejects(read('a'), /Unavailable/);
  await assert.rejects(read('a'), { status: 429 });
  assert.equal(calls, 2);
});
function response() {
  return {
    headers: {},
    code: 200,
    body: '',
    set(key, value) {
      this.headers[key] = value;
      return this;
    },
    status(value) {
      this.code = value;
      return this;
    },
    type(value) {
      this.contentType = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
  };
}
test('canonical metadata ignores forged query names and enables short CDN caching', async () => {
  const ids = [];
  const handler = createPreviewHandler({
    shell,
    origin,
    readMetadata: async (id) => {
      ids.push(id);
      return metadata;
    },
  });
  const res = response();
  await handler({ method: 'GET', originalUrl: '/live/abc?home=Forged' }, res);
  assert.deepEqual(ids, ['abc']);
  assert.equal(res.code, 200);
  assert.equal(res.headers['Cache-Control'], 'public, max-age=0, s-maxage=60');
  assert.ok(res.body.includes('Eagles vs Falcons'));
  assert.ok(!res.body.includes('Forged'));
});
test('invalid routes and non-read methods do not touch the database', async () => {
  let calls = 0;
  const handler = createPreviewHandler({
    shell,
    origin,
    readMetadata: async () => {
      calls++;
      return metadata;
    },
  });
  for (const path of [
    '/live/',
    '/live/abc/extra',
    '/live/a.json',
    '/live/' + 'a'.repeat(129),
  ]) {
    const res = response();
    await handler({ method: 'GET', originalUrl: path }, res);
    assert.equal(res.code, 404);
  }
  const res = response();
  await handler({ method: 'POST', originalUrl: '/live/abc' }, res);
  assert.equal(res.code, 405);
  assert.equal(calls, 0);
});
test('errors and throttled requests return uncached generic viewer HTML', async () => {
  for (const status of [503, 429]) {
    const handler = createPreviewHandler({
      shell,
      origin,
      readMetadata: async () => {
        const error = new Error('Unavailable');
        error.status = status;
        throw error;
      },
    });
    const res = response();
    await handler({ method: 'GET', originalUrl: '/live/abc' }, res);
    assert.equal(res.code, status);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.headers['Retry-After'], '60');
    assert.ok(res.body.includes('<title>Live score — Scorekeeper</title>'));
    assert.ok(res.body.includes('./assets/app.js'));
  }
});
