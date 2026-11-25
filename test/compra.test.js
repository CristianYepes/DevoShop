// Purchase flow against a fake mailbox (no real orders are sent). Each test names the bug
// it is meant to catch ("KILLS: ...").
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const received = [];
let buzonStatus = 200;
const seenIds = new Set();
const buzon = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const order = JSON.parse(body);
    received.push({ order, key: req.headers['x-clave'] });
    if (buzonStatus !== 200) { res.writeHead(buzonStatus); return res.end('{"error":"caído"}'); }
    if (seenIds.has(order.order_id)) { res.writeHead(422); return res.end('{"error":"order_id repetido"}'); }
    seenIds.add(order.order_id);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
});

let app;
let base;

before(async () => {
  await new Promise((r) => buzon.listen(0, '127.0.0.1', r));
  process.env.BUZON_URL = `http://127.0.0.1:${buzon.address().port}/api/pedido`;
  process.env.CLAVE_EQUIPO = 'clave-de-prueba';
  const { createApp } = await import('../src/server.js');
  app = createApp();
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.address().port}`;
});

after(async () => {
  await new Promise((r) => app.close(r));
  await new Promise((r) => buzon.close(r));
});

/** Tiny browser: keeps cookies between requests, does not follow redirects. */
function browser() {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  async function req(path, { form, method } = {}) {
    const res = await fetch(base + path, {
      method: method ?? (form ? 'POST' : 'GET'),
      redirect: 'manual',
      headers: { cookie: cookieHeader(), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  }
  return { req, jar };
}

const customer = { name: 'Lucía Fernández Ruiz', email: 'lucia@example.com', address: 'Calle de los Olivos 12, 28045 Madrid' };

test('full guest purchase sends a valid v1.0 order before confirming. KILLS: order missing or wrong total', async () => {
  const b = browser();
  let r = await b.req('/carrito/anadir', { form: { sku: 'sofa-nordico', cantidad: '1' } });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/carrito?anadido=sofa-nordico');
  await b.req('/carrito/anadir', { form: { sku: 'pack-4-cojines-decorativos', cantidad: '3' } });
  await b.req('/carrito/anadir', { form: { sku: 'lampara-de-pie-arco' } });

  const cart = await (await b.req('/carrito')).text();
  assert.match(cart, /Sofá Nórdico/);
  assert.match(cart, /1\.055,00\s€/); // 849 + 3 × 39 + 89
  assert.match(cart, /Finalizar compra como invitado/);

  r = await b.req('/checkout');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Pagar 1\.055,00\s€ \(pago simulado\)/);

  const before = received.length;
  r = await b.req('/checkout', { form: customer });
  assert.equal(r.status, 303);
  const location = r.headers.get('location');
  assert.match(location, /^\/pedido\/[0-9a-f-]{36}$/);
  assert.equal(received.length, before + 1, 'the order reaches the mailbox before the confirmation');

  const { order, key } = received.at(-1);
  assert.equal(key, 'clave-de-prueba');
  assert.equal(order.schema_version, '1.0');
  assert.match(order.order_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(order.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(order.currency, 'EUR');
  assert.deepEqual(order.customer, customer);
  assert.deepEqual(order.items, [
    { sku: 'sofa-nordico', name: 'Sofá Nórdico', quantity: 1, unit_price: 849 },
    { sku: 'pack-4-cojines-decorativos', name: 'Pack 4 cojines decorativos', quantity: 3, unit_price: 39 },
    { sku: 'lampara-de-pie-arco', name: 'Lámpara de pie Arco', quantity: 1, unit_price: 89 },
  ]);
  assert.equal(order.total, 1055);

  const conf = await (await b.req(location)).text();
  assert.match(conf, /<h1[^>]*>Pedido confirmado<\/h1>/);
  assert.match(conf, new RegExp(order.order_id));
  assert.doesNotMatch((await (await b.req('/carrito')).text()), /Sofá Nórdico/, 'cart is emptied after paying');
});

test('names and prices in the order match /catalogo.json. KILLS: spend counted as 0', async () => {
  const catalog = await (await fetch(`${base}/catalogo.json`)).json();
  const bySku = new Map(catalog.productos.map((p) => [p.sku, p]));
  for (const { order } of received) {
    for (const it of order.items) {
      assert.equal(it.name, bySku.get(it.sku).nombre);
      assert.equal(it.unit_price, bySku.get(it.sku).precio);
    }
  }
});

test('decimal prices total to the cent. KILLS: floating point total rejected by the mailbox', async () => {
  const b = browser();
  await b.req('/carrito/anadir', { form: { sku: 'sofa-lund', cantidad: '3' } }); // 1076,90 €
  await b.req('/carrito/anadir', { form: { sku: 'manta-para-sofa', cantidad: '7' } });
  await b.req('/checkout');
  await b.req('/checkout', { form: customer });
  const { order } = received.at(-1);
  assert.equal(order.total, 3433.7); // 3 × 1076,90 + 7 × 29
  const sum = order.items.reduce((s, i) => s + Math.round(i.unit_price * 100) * i.quantity, 0);
  assert.equal(Math.round(order.total * 100), sum);
});

test('double click on Pagar sends the same order_id. KILLS: two orders for one purchase', async () => {
  const b = browser();
  await b.req('/carrito/anadir', { form: { sku: 'sofa-alba' } });
  await b.req('/checkout');
  const jarCopy = new Map(b.jar);
  const first = await b.req('/checkout', { form: customer });
  b.jar.clear(); for (const [k, v] of jarCopy) b.jar.set(k, v); // second click with the old cookies
  const second = await b.req('/checkout', { form: customer });
  assert.equal(first.status, 303);
  assert.equal(second.status, 303, 'repeated order_id is treated as already stored');
  const ids = received.slice(-2).map((x) => x.order.order_id);
  assert.equal(ids[0], ids[1]);
});

test('mailbox down: no confirmation and a clear retry message. KILLS: fake confirmation', async () => {
  const b = browser();
  await b.req('/carrito/anadir', { form: { sku: 'cama-luna-150x190' } });
  await b.req('/checkout');
  buzonStatus = 502;
  try {
    const r = await b.req('/checkout', { form: customer });
    assert.notEqual(r.status, 303);
    const html = await r.text();
    assert.doesNotMatch(html, /Pedido confirmado/);
    assert.match(html, /No hemos podido registrar tu pedido/);
  } finally {
    buzonStatus = 200;
  }
  const retry = await b.req('/checkout', { form: customer });
  assert.equal(retry.status, 303);
});

test('form errors appear next to the field and keep what was typed. KILLS: confusing checkout errors', async () => {
  const b = browser();
  await b.req('/carrito/anadir', { form: { sku: 'sofa-alba' } });
  const r = await b.req('/checkout', { form: { name: 'Ana', email: 'no-es-email', address: '' } });
  assert.equal(r.status, 422);
  const html = await r.text();
  assert.match(html, /id="email-error"[^>]*>Escribe un email válido/);
  assert.match(html, /id="address-error"/);
  assert.match(html, /value="Ana"/);
});

test('packs add their real products; quantities can change and lines can be removed. KILLS: broken cart actions', async () => {
  const b = browser();
  await b.req('/carrito/anadir-pack', { form: { pack: 'salon-nordico' } });
  let html = await (await b.req('/carrito')).text();
  assert.match(html, /Sofá Nórdico/);
  assert.match(html, /Alfombra de salón 160x230/);
  await b.req('/carrito/cantidad', { form: { sku: 'sofa-nordico', cantidad: '0' } });
  html = await (await b.req('/carrito')).text();
  assert.doesNotMatch(html, /cart-line-name[^>]*>Sofá Nórdico/);
});

test('tampered cart cookie is ignored. KILLS: injecting products or prices through the cookie', async () => {
  const forged = Buffer.from(JSON.stringify({ l: [['sofa-aarhus', 1]] })).toString('base64url');
  const res = await fetch(`${base}/carrito`, { headers: { cookie: `hk_carrito=${forged}.firma-falsa` } });
  assert.match(await res.text(), /Tu carrito está vacío/);
});

test('product page recommends complements from the sales history. KILLS: no cross-sell for the agent', async () => {
  const html = await (await fetch(`${base}/producto/sofa-nordico`)).text();
  assert.match(html, /Se compra junto con este producto/);
  assert.match(html, /Añadir Lámpara de pie Arco, 89,00\s€/);
  assert.match(html, /Lo compra el \d+ % de quienes compran Sofá Nórdico/);
});

test('cart suggestions never push the total over 4.000 €. KILLS: spend counted as 0 for going over budget', async () => {
  const b = browser();
  await b.req('/carrito/anadir-pack', { form: { pack: 'salon-comedor' } });
  await b.req('/carrito/anadir', { form: { sku: 'escritorio-elevable-electrico-160-cm' } });
  const html = await (await b.req('/carrito')).text();
  const total = Number(/<strong>([\d.]+,\d\d)\s€<\/strong>/.exec(html)[1].replace('.', '').replace(',', '.'));
  for (const m of html.matchAll(/Añadir [^<]*, ([\d.]+,\d\d)\s€<\/button>/g)) {
    const price = Number(m[1].replace('.', '').replace(',', '.'));
    assert.ok(total + price <= 4000, `suggestion of ${price} € on a ${total} € cart`);
  }
});

test('/catalogo.json has the LEEME format. KILLS: catalog milestone failing on format', async () => {
  const { productos } = await (await fetch(`${base}/catalogo.json`)).json();
  assert.ok(productos.length > 40);
  for (const p of productos) {
    assert.deepEqual(Object.keys(p), ['sku', 'ids_origen', 'nombre', 'categoria', 'precio', 'plazas', 'ancho_cm', 'color', 'material']);
  }
});
