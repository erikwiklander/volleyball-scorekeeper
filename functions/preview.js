function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}
export function renderPreview(shell, metadata, pageUrl, origin) {
  const valid =
    metadata?.published === true &&
    [metadata.home, metadata.away].every(
      (name) =>
        typeof name === 'string' && name.length > 0 && name.length <= 100,
    );
  const title = valid
    ? `${metadata.home} vs ${metadata.away} — Live score`
    : 'Live score — Scorekeeper';
  const description = valid
    ? `Follow ${metadata.home} vs ${metadata.away} on Scorekeeper.`
    : 'Open Scorekeeper to check whether this live score is available.';
  const tags = `
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="noindex" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Scorekeeper" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(pageUrl)}" />
    <meta property="og:image" content="${escapeHtml(origin)}/icon-512.png" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(origin)}/icon-512.png" />`;
  return shell
    .replace('<head>', '<head>\n    <base href="/" />')
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/, '')
    .replace('</head>', `${tags}\n</head>`);
}
// Bound database lookups as well as scaling. Cached names never include scores/logos.
export function cachedMetadata(
  read,
  { now = Date.now, ttl = 60_000, capacity = 256, lookupsPerMinute = 60 } = {},
) {
  const cache = new Map();
  let windowStart = now();
  let lookups = 0;
  return async (id) => {
    const time = now();
    const cached = cache.get(id);
    if (cached && cached.expires > time) return cached.value;
    cache.delete(id);
    if (time - windowStart >= 60_000) {
      windowStart = time;
      lookups = 0;
    }
    if (lookups >= lookupsPerMinute) {
      const error = new Error('Preview lookup limit reached');
      error.status = 429;
      throw error;
    }
    lookups++;
    const value = await read(id);
    if (cache.size >= capacity) cache.delete(cache.keys().next().value);
    cache.set(id, { value, expires: time + ttl });
    return value;
  };
}
export function createPreviewHandler({ readMetadata, shell, origin }) {
  origin = new URL(origin).origin;
  return async (request, response) => {
    response.set('Cache-Control', 'no-store');
    response.set('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.set('Allow', 'GET, HEAD');
      response.status(405).send('Method not allowed');
      return;
    }
    const path = new URL(request.originalUrl, origin).pathname;
    const route = path.match(/^\/live\/([a-zA-Z0-9_-]{1,128})\/?$/);
    if (!route) {
      response.status(404).send('Live score link not found');
      return;
    }
    let metadata;
    let status = 200;
    try {
      metadata = await readMetadata(route[1]);
      // Only names are cached; live scores still come directly from Firebase.
      response.set('Cache-Control', 'public, max-age=0, s-maxage=60');
    } catch (error) {
      status = error.status === 429 ? 429 : 503;
      response.set('Retry-After', '60');
    }
    response
      .type('html')
      .status(status)
      .send(renderPreview(shell, metadata, origin + path, origin));
  };
}
