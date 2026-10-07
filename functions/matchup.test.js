import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { prepareMatchup } from './matchup.js';
import { renderPreview, createPreviewHandler } from './preview.js';
const metadata = {
  published: true,
  home: 'Eagles',
  away: 'Falcons',
  homeColor: '#1f72c3',
  awayColor: '#d25738',
};
const shell =
  '<html><head><title>Scorekeeper</title></head><body></body></html>';
const origin = 'https://scorekeeper.example';
const logo = async (background, format = 'png') =>
  'data:image/' +
  format +
  ';base64,' +
  (
    await sharp({
      create: { width: 100, height: 100, channels: 4, background },
    })
      .toFormat(format)
      .toBuffer()
  ).toString('base64');
test('both readable logos produce a wide PNG matchup and rich metadata', async () => {
  const value = await prepareMatchup({
    ...metadata,
    homeLogo: await logo('#1f72c3'),
    awayLogo: await logo('#d25738', 'webp'),
  });
  assert.ok(Buffer.isBuffer(value.image));
  const info = await sharp(value.image).metadata();
  assert.equal(info.width, 1200);
  assert.equal(info.height, 630);
  assert.equal(info.format, 'png');
  assert.match(value.imageVersion, /^[a-f0-9]{16}$/);
  const html = renderPreview(
    shell,
    value,
    origin + '/live/abc?preview=2',
    origin,
  );
  assert.ok(html.includes(`/live/abc/matchup.png?v=${value.imageVersion}`));
  assert.ok(html.includes('content="summary_large_image"'));
  assert.ok(html.includes('property="og:image:width" content="1200"'));
});
test('one logo, no logos, invalid data, oversized images and stopped sharing use compact cards', async () => {
  const valid = await logo('#1f72c3');
  const large =
    'data:image/png;base64,' +
    (
      await sharp({
        create: {
          width: 1000,
          height: 1000,
          channels: 3,
          background: '#ffffff',
        },
      })
        .png()
        .toBuffer()
    ).toString('base64');
  for (const extra of [
    {},
    { homeLogo: valid },
    { homeLogo: '', awayLogo: valid },
    { homeLogo: 'https://example.com/logo.png', awayLogo: valid },
    { homeLogo: 'data:image/png;base64,aW52YWxpZA==', awayLogo: valid },
    { homeLogo: large, awayLogo: valid },
    { homeLogo: valid, awayLogo: valid, published: false },
  ]) {
    const value = await prepareMatchup({ ...metadata, ...extra });
    assert.equal(value.image, undefined);
    const html = renderPreview(shell, value, origin + '/live/abc', origin);
    assert.ok(!html.includes('property="og:image"'));
    assert.ok(!html.includes('name="twitter:image"'));
    assert.ok(!html.includes('icon-512.png'));
    assert.ok(html.includes('content="summary"'));
  }
});
test('long and escaped names and untrusted colors still render without SVG injection', async () => {
  const valid = await logo('#1f72c3');
  const value = await prepareMatchup({
    ...metadata,
    home: 'A very long team name '.repeat(4),
    away: '<Blue & Gold>',
    homeColor: '\"/><script>bad</script>',
    homeLogo: valid,
    awayLogo: valid,
  });
  assert.ok(Buffer.isBuffer(value.image));
});
function response() {
  return {
    headers: {},
    code: 200,
    set(key, value) {
      this.headers[key] = value;
      return this;
    },
    type(value) {
      this.contentType = value;
      return this;
    },
    status(value) {
      this.code = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
  };
}
test('image endpoint serves only published matchup PNGs and preserves preview refresh URLs', async () => {
  const valid = await logo('#1f72c3');
  const value = await prepareMatchup({
    ...metadata,
    homeLogo: valid,
    awayLogo: valid,
  });
  const handler = createPreviewHandler({
    shell,
    origin,
    readMetadata: async () => value,
  });
  const res = response();
  await handler(
    {
      method: 'GET',
      originalUrl: '/live/abc/matchup.png?v=' + value.imageVersion,
    },
    res,
  );
  assert.equal(res.code, 200);
  assert.equal(res.contentType, 'png');
  assert.deepEqual(res.body, value.image);
  const html = response();
  await handler({ method: 'GET', originalUrl: '/live/abc?preview=2' }, html);
  assert.ok(
    html.body.includes(
      'property="og:url" content="https://scorekeeper.example/live/abc?preview=2"',
    ),
  );
  for (const data of [metadata, { ...value, published: false }]) {
    const unavailable = createPreviewHandler({
      shell,
      origin,
      readMetadata: async () => data,
    });
    const missing = response();
    await unavailable(
      { method: 'GET', originalUrl: '/live/abc/matchup.png' },
      missing,
    );
    assert.equal(missing.code, 404);
  }
});
