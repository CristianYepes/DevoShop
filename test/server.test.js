// Tests for the store base: security headers, session cookie, leak-free errors and
// web quality on the home page. Each test names the bug it is meant to catch ("KILLS: ...").
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let server;
let base;

before(async () => {
  server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const get = (path, init) => fetch(base + path, { redirect: 'manual', ...init });

function assertSecurityHeaders(res, label) {
  const hsts = res.headers.get('strict-transport-security') ?? '';
  const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
  assert.ok(maxAge >= 31536000, `${label}: HSTS max-age must be >= 1 year, got "${hsts}"`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff', `${label}: nosniff`);

  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'self'/, `${label}: CSP must restrict default-src`);
  assert.match(csp, /script-src 'self'/, `${label}: CSP must restrict script-src`);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/, `${label}: CSP without unsafe-* or wildcards`);

  assert.equal(res.headers.get('x-powered-by'), null, `${label}: no x-powered-by`);
  assert.doesNotMatch(res.headers.get('server') ?? '', /\d|node|express/i, `${label}: no server version`);
}

test('home: 200 and HTML. KILLS: home page not served at /', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
});

test('security headers on home, 404 and API errors. KILLS: headers only on some routes', async () => {
  assertSecurityHeaders(await get('/'), 'home');
  assertSecurityHeaders(await get('/does-not-exist'), '404');
  assertSecurityHeaders(
    await get('/api/asistente', { method: 'POST', body: '{bad json', headers: { 'content-type': 'application/json' } }),
    'api error',
  );
});

test('hk_sesion cookie on first visit. KILLS: missing, empty or insecure cookie', async () => {
  const res = await get('/');
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('hk_sesion='));
  assert.ok(cookie, 'hk_sesion must be set on first visit');
  const value = cookie.split(';')[0].slice('hk_sesion='.length);
  assert.ok(value.length >= 16, 'cookie needs a non-trivial value');
  assert.match(cookie, /;\s*Secure/i);
  assert.match(cookie, /;\s*HttpOnly/i);
  assert.match(cookie, /;\s*SameSite=(Lax|Strict)/i);
});

test('hk_sesion values are unique per visitor. KILLS: constant session id', async () => {
  const ids = new Set();
  for (let i = 0; i < 5; i++) {
    const c = (await get('/')).headers.getSetCookie().find((x) => x.startsWith('hk_sesion='));
    ids.add(c.split(';')[0]);
  }
  assert.equal(ids.size, 5);
});

test('existing session is kept. KILLS: cookie overwritten on every request', async () => {
  const res = await get('/', { headers: { cookie: 'hk_sesion=abcdefabcdefabcdefabcdef' } });
  const reset = res.headers.getSetCookie().find((c) => c.startsWith('hk_sesion='));
  assert.equal(reset, undefined);
});

test('internal files are not reachable. KILLS: source, config or backup leaks', async () => {
  const paths = [
    '/.env', '/.git/config', '/.git/HEAD', '/package.json', '/src/server.js', '/server.js',
    '/Dockerfile', '/README.md', '/backup.zip', '/db.sqlite', '/orders.json', '/pedidos.json',
    '/clientes.csv', '/../package.json', '/%2e%2e/package.json', '/public/../src/server.js',
    '/.DS_Store', '/node_modules/', '/test/server.test.js', '/docs/guia-hackathon-devo.md',
    // Encoded slashes survive client-side URL normalization and reach the server as "../".
    '/static/..%2f..%2fsrc%2fserver.js', '/static/..%2Fpages.js', '/static/%2e%2e%2f%2e%2e%2fsrc%2fpages.js',
    '/static/..%2fpackage.json', '/static/..%2fsrc%2fserver.js', '/static/%2e%2e%2fsrc%2fpages.js', '/static/..%5c..%5csrc%5cserver.js',
  ];
  for (const p of paths) {
    const res = await get(p);
    assert.equal(res.status, 404, `${p} must be 404, got ${res.status}`);
    const body = await res.text();
    assert.doesNotMatch(body, /CLAVE|"scripts"|import |FROM node/, `${p} leaked content`);
  }
});

test('error pages show no traces or internal paths. KILLS: stack trace leak', async () => {
  for (const res of [
    await get('/does-not-exist'),
    await get('/api/asistente', { method: 'POST', body: '{bad json', headers: { 'content-type': 'application/json' } }),
    await get('/%E0%A4%A'), // malformed percent-encoding
  ]) {
    const body = await res.text();
    assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
    assert.doesNotMatch(body, /at .+\(|\/Users\/|\/app\/|node:internal|Error:|\.js:\d+/);
  }
});

test('offers and packs. KILLS: pack total not equal to the sum of its catalog lines', async () => {
  const { getPacks } = await import('../src/catalog.js');
  for (const pack of getPacks()) {
    const cents = pack.lines.reduce((s, l) => s + l.quantity * Math.round(l.product.price * 100), 0);
    assert.equal(Math.round(pack.total * 100), cents, pack.id);
    assert.ok(pack.lines.length === pack.items.length, `${pack.id} references an unknown sku`);
  }
  // No invented "before" prices anywhere (the data has none): best sellers instead of fake offers.
  const best = await (await get('/mas-vendidos')).text();
  assert.doesNotMatch(best, /<del>/);
  assert.match(best, /href="\/producto\//);
  for (const pack of getPacks()) assert.ok(pack.total < 4000, `${pack.id} exceeds the agent budget`);
  assert.match(await (await get('/packs')).text(), /Añadir el pack al carrito/);
});

for (const page of ['/ofertas', '/packs', '/', '/categoria/sofas', '/producto/demo-sofa-3p', '/buscar?q=sofa', '/buscar?q=zzz', '/no-existe']) {
  test(`web quality on ${page}. KILLS: failing any of the quality checks`, async () => {
    assertWebQuality(await (await get(page)).text());
  });
}

test('store pages respond and unknown ones 404. KILLS: broken category, product or search routes', async () => {
  assert.equal((await get('/categoria/sofa')).status, 200);
  assert.equal((await get('/producto/sofa-nordico')).status, 200);
  assert.equal((await get('/buscar?q=l%C3%A1mpara')).status, 200);
  assert.equal((await get('/categoria/no-existe')).status, 404);
  assert.equal((await get('/producto/no-existe')).status, 404);
});

test('product page shows name, price and add-to-cart. KILLS: agent cannot buy from the product page', async () => {
  const html = await (await get('/producto/sofa-nordico')).text();
  assert.match(html, /Sofá Nórdico/);
  assert.match(html, /849,00\s€/);
  assert.match(html, /<button[^>]*type="submit"[^>]*>Añadir al carrito, 849,00\s€<\/button>/);
});

test('search finds products ignoring accents. KILLS: "lampara" not matching "Lámpara"', async () => {
  const html = await (await get('/buscar?q=lampara')).text();
  assert.match(html, /Lámpara de pie Arco/);
});

test('search query is escaped. KILLS: reflected XSS through the search box', async () => {
  const html = await (await get('/buscar?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E')).text();
  assert.doesNotMatch(html, /<script>alert/);
});

function assertWebQuality(html) {
  assert.match(html, /<html[^>]+lang="es"/, 'lang declared');
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  assert.ok(title.trim().length >= 20, `title >= 20 chars, got "${title}"`);
  const desc = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '';
  assert.ok(desc.length >= 20, 'meta description >= 20 chars');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1"/);
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, 'exactly one h1');
  for (const img of html.match(/<img\b[^>]*>/g) ?? []) assert.match(img, /\balt="[^"]+"/, `img without alt: ${img}`);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline scripts (CSP)');
  assert.doesNotMatch(html, /\sstyle="/, 'no inline style attributes');
  // Every input/select/textarea (except hidden) needs a <label for="id">.
  for (const field of html.match(/<(input|select|textarea)\b[^>]*>/g) ?? []) {
    if (/type="hidden"/.test(field)) continue;
    const id = /\bid="([^"]+)"/.exec(field)?.[1];
    assert.ok(id && html.includes(`<label for="${id}"`), `field without label: ${field}`);
  }
}

test('static assets served with correct type. KILLS: CSS/JS blocked by nosniff', async () => {
  const css = await get('/static/styles.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
});

test('HEAD and unknown methods are handled. KILLS: 500 on unexpected methods', async () => {
  assert.equal((await get('/', { method: 'HEAD' })).status, 200);
  const res = await get('/', { method: 'DELETE' });
  assert.equal(res.status, 405);
});
