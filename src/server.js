// DevoShop HTTP server. Uses only Node's standard library: fewer dependencies means a
// faster cold start on Cloud Run and nothing to leak in "x-powered-by" style headers.
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  renderHome, renderError, renderCategory, renderProduct, renderSearch, renderOffers, renderPacks,
  renderCart, renderCheckout, renderConfirmation,
} from './pages.js';
import { getCategory, getProduct, getPack, productsInCategory, searchProducts, CATALOG_JSON } from './catalog.js';
import { readCart, cartCookie, addToCart, setQuantity, priceCart, readSigned, signedCookie } from './cart.js';
import { validateCustomer, buildOrder, sendOrder } from './orders.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_BODY_BYTES = 16 * 1024;

const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  // No inline scripts or styles anywhere: all JS/CSS lives in /static.
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'referrer-policy': 'strict-origin-when-cross-origin',
};

const STATIC_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type, ...extra });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}

const sendJson = (res, status, data) => send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');

/** Sets hk_sesion on the first visit only; an existing session is never overwritten. */
function sessionCookie(req) {
  if (/(?:^|;\s*)hk_sesion=[^;]+/.test(req.headers.cookie ?? '')) return {};
  const id = randomBytes(16).toString('hex');
  return { 'set-cookie': `hk_sesion=${id}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400` };
}

/** Serves files from public/ only. Any path that resolves outside it is a 404. */
async function serveStatic(res, urlPath) {
  const ext = path.extname(urlPath);
  const type = STATIC_TYPES[ext];
  if (!type) return false;
  const file = path.resolve(PUBLIC_DIR, '.' + urlPath.slice('/static'.length));
  if (!file.startsWith(PUBLIC_DIR)) return false;
  try {
    const data = await readFile(file);
    send(res, 200, data, type, { 'cache-control': 'public, max-age=3600' });
    return true;
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return false;
    throw err;
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('invalid json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** application/x-www-form-urlencoded body -> object of trimmed strings. */
async function readForm(req) {
  return Object.fromEntries([...new URLSearchParams(await readBody(req))].map(([k, v]) => [k, v.trim().slice(0, 300)]));
}

const redirect = (res, location, extra = {}) => send(res, 303, '', 'text/plain; charset=utf-8', { location, ...extra });
const toInt = (v, def) => (/^\d{1,3}$/.test(v ?? '') ? Number(v) : def);

// Pages that do not depend on the visitor are rendered once and served from memory
// (home, categories, products, offers, packs): this is what the load test hits.
const pageCache = new Map();
function cached(key, render) {
  let html = pageCache.get(key);
  if (!html) { html = render(); pageCache.set(key, html); }
  return html;
}

/** Last order, kept in a signed cookie so /pedido/:id can show it on any instance. */
const ORDER_COOKIE = 'hk_pedido';
function orderCookie(order) {
  return signedCookie(ORDER_COOKIE, {
    i: order.order_id, n: order.customer.name, a: order.customer.address,
    l: order.items.map((it) => [it.sku, it.quantity, Math.round(it.unit_price * 100)]),
  });
}
function readOrder(req) {
  const v = readSigned(req, ORDER_COOKIE);
  if (!v?.i || !Array.isArray(v.l)) return null;
  const items = v.l.map(([sku, quantity, cents]) => ({ sku, name: getProduct(sku)?.name ?? sku, quantity, unit_price: cents / 100 }));
  const totalCents = v.l.reduce((s, [, q, c]) => s + q * c, 0);
  return { order_id: v.i, customer: { name: v.n, address: v.a }, items, total: totalCents / 100 };
}

/** Cart, checkout and confirmation. Returns null when the path is not one of them. */
async function handleStore(req, res, urlPath) {
  const cart = readCart(req);
  const count = cart.lines.reduce((s, [, q]) => s + q, 0);

  if (req.method === 'POST') {
    const form = await readForm(req);
    if (urlPath === '/carrito/anadir') {
      const p = getProduct(form.sku);
      if (!p) return redirect(res, '/carrito');
      const next = addToCart(cart, p.sku, toInt(form.cantidad, 1) || 1);
      return redirect(res, `/carrito?anadido=${encodeURIComponent(p.sku)}`, { 'set-cookie': cartCookie(next) });
    }
    if (urlPath === '/carrito/anadir-pack') {
      const pack = getPack(form.pack);
      if (!pack) return redirect(res, '/packs');
      let next = cart;
      for (const l of pack.lines) next = addToCart(next, l.product.sku, l.quantity);
      return redirect(res, `/carrito?pack=${encodeURIComponent(pack.id)}`, { 'set-cookie': cartCookie(next) });
    }
    if (urlPath === '/carrito/cantidad') {
      const next = setQuantity(cart, form.sku, toInt(form.cantidad, 1));
      return redirect(res, '/carrito', { 'set-cookie': cartCookie(next) });
    }
    if (urlPath === '/checkout') {
      const priced = priceCart(cart);
      if (!priced.items.length) {
        const last = readOrder(req);
        return redirect(res, last ? `/pedido/${last.order_id}` : '/carrito');
      }
      const customer = { name: form.name ?? '', email: form.email ?? '', address: form.address ?? '' };
      const errors = validateCustomer(customer);
      if (Object.keys(errors).length) {
        return send(res, 422, renderCheckout(priced, { values: customer, errors, cartCount: count }));
      }
      // Same order_id for every submit of this checkout: a double click is stored once.
      const orderId = cart.orderId ?? randomUUID();
      const order = buildOrder(orderId, customer, priced);
      const result = await sendOrder(order);
      if (!result.ok) {
        return send(res, 503, renderCheckout(priced, { values: customer, failed: true, cartCount: count }),
          undefined, { 'set-cookie': cartCookie({ ...cart, orderId }) });
      }
      console.log(`pedido ${orderId}: enviado, ${order.items.length} líneas, total ${order.total}`);
      return redirect(res, `/pedido/${orderId}`, { 'set-cookie': [cartCookie({ lines: [] }), orderCookie(order)] });
    }
    return send(res, 405, renderError(405), undefined, { allow: 'GET, HEAD' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, renderError(405), undefined, { allow: 'GET, HEAD, POST' });
  }
  if (urlPath === '/carrito') {
    const params = new URL(req.url, 'http://x').searchParams;
    const pack = getPack(params.get('pack') ?? '');
    const added = pack ? pack.name : getProduct(params.get('anadido') ?? '')?.name;
    return send(res, 200, renderCart(priceCart(cart), { added, cartCount: count }), undefined, { 'cache-control': 'no-store', ...sessionCookie(req) });
  }
  if (urlPath === '/checkout') {
    const priced = priceCart(cart);
    if (!priced.items.length) return redirect(res, '/carrito');
    const withId = cart.orderId ? cart : { ...cart, orderId: randomUUID() };
    return send(res, 200, renderCheckout(priced, { cartCount: count }), undefined,
      { 'set-cookie': cartCookie(withId), 'cache-control': 'no-store' });
  }
  const ped = /^\/pedido\/([0-9a-f-]{36})$/.exec(urlPath);
  if (ped) {
    const order = readOrder(req);
    if (order?.order_id === ped[1]) {
      return send(res, 200, renderConfirmation(order, { cartCount: count }), undefined, { 'cache-control': 'no-store' });
    }
    return send(res, 404, renderError(404));
  }
  return null;
}

async function route(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, renderError(400));
  }

  if (urlPath === '/api/asistente') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Usa POST' });
    const body = await readJsonBody(req);
    if (typeof body?.pregunta !== 'string' || !body.pregunta.trim()) {
      return sendJson(res, 400, { error: 'Falta "pregunta"' });
    }
    // Placeholder until the assistant branch lands.
    return sendJson(res, 200, { respuesta: 'El asistente de DevoShop estará disponible en breve.' });
  }

  if (urlPath === '/carrito' || urlPath.startsWith('/carrito/') || urlPath === '/checkout' || urlPath.startsWith('/pedido/')) {
    const handled = await handleStore(req, res, urlPath);
    if (handled !== null) return handled;
    return send(res, 404, renderError(404));
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, renderError(405), undefined, { allow: 'GET, HEAD' });
  }

  if (urlPath === '/catalogo.json') return send(res, 200, CATALOG_JSON, 'application/json; charset=utf-8');
  if (urlPath.startsWith('/static/') && (await serveStatic(res, urlPath))) return;

  const cartCount = readCart(req).lines.reduce((s, [, q]) => s + q, 0);
  const page = (key, render) =>
    send(res, 200, cached(`${key}|${cartCount}`, () => render({ cartCount })), undefined, sessionCookie(req));

  if (urlPath === '/') return page('/', renderHome);
  if (urlPath === '/ofertas') return page(urlPath, renderOffers);
  if (urlPath === '/packs') return page(urlPath, renderPacks);

  const cat = /^\/categoria\/([a-z_]+)\/?$/.exec(urlPath);
  if (cat && getCategory(cat[1])) {
    return page(urlPath, (o) => renderCategory(getCategory(cat[1]), productsInCategory(cat[1]), o));
  }
  const prod = /^\/producto\/([a-z0-9-]+)\/?$/.exec(urlPath);
  if (prod && getProduct(prod[1])) {
    return page(urlPath, (o) => renderProduct(getProduct(prod[1]), o));
  }
  if (urlPath === '/buscar') {
    const q = (new URL(req.url, 'http://x').searchParams.get('q') ?? '').trim().slice(0, 100);
    return send(res, 200, renderSearch(q, searchProducts(q), { cartCount }), undefined, sessionCookie(req));
  }
  return send(res, 404, renderError(404));
}

export function createApp() {
  return createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      const status = err.status ?? 500;
      // Log the detail server-side (Cloud Run logs); the client only gets a generic page.
      if (status >= 500) console.error(`${req.method} ${req.url} failed:`, err);
      if (!res.headersSent) {
        if (req.url.startsWith('/api/')) sendJson(res, status, { error: 'Petición no válida' });
        else send(res, status, renderError(status));
      } else res.end();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  createApp().listen(port, () => console.log(`DevoShop listening on ${port}`));
}
