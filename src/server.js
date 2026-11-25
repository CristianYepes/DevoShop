// DevoShop HTTP server. Uses only Node's standard library: fewer dependencies means a
// faster cold start on Cloud Run and nothing to leak in "x-powered-by" style headers.
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHmac, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  renderHome, renderError, renderCategory, renderProduct, renderSearch, renderOffers, renderPacks, renderBestSellers,
  renderCart, renderCheckout, renderConfirmation, renderEmptyCheckout, renderOrderError,
} from './pages.js';
import { getCategory, getProduct, getPack, productsInCategory, searchProducts, catalogoJson } from './catalog.js';
import { leerCarrito, cookieCarrito, anadir, fijarCantidad, cantidadValida, resumen } from './carrito.js';
import { validarCliente, construirPedido, enviarPedido, esUuidV4, BUZON_URL_DEFECTO } from './pedido.js';
import { responder } from './asistente.js';

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

/**
 * Reads the request body as text, up to MAX_BODY_BYTES. A bigger body is drained (not
 * buffered) and rejected with 413, so the client gets a clean error page instead of a
 * reset connection.
 */
function readBodyText(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) reject(Object.assign(new Error('body too large'), { status: 413 }));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const text = await readBodyText(req);
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('invalid json'), { status: 400 });
  }
}

async function readFormBody(req) {
  return Object.fromEntries(new URLSearchParams(await readBodyText(req)));
}

const pageCache = new Map();
function cached(key, render) {
  let html = pageCache.get(key);
  if (html === undefined) { html = render(); pageCache.set(key, html); }
  return html;
}

const getCookie = (req, name) => new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie ?? '')?.[1];
const redirect = (res, location, cookies = []) => {
  res.writeHead(303, { ...SECURITY_HEADERS, location, 'set-cookie': cookies, 'content-type': 'text/plain; charset=utf-8' });
  res.end();
};

async function route(req, res, cfg) {
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
    const assistantBase = process.env.ASISTENTE_URL?.trim();
    if (!assistantBase) {
      return sendJson(res, 200, { respuesta: responder(body.pregunta.slice(0, 2000)) });
    }
    const target = `${assistantBase.replace(/\/+$/, '')}/api/asistente`;
    let upstream;
    try {
      upstream = await fetch(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pregunta: body.pregunta }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      console.error('assistant upstream error:', err?.message ?? err);
      return sendJson(res, 502, { error: 'No se pudo contactar con el asistente' });
    }
    if (!upstream.ok) {
      console.error(`assistant upstream returned HTTP ${upstream.status}`);
      return sendJson(res, 502, { error: 'El asistente no pudo responder en este momento' });
    }
    const data = await upstream.json().catch(() => null);
    if (typeof data?.respuesta !== 'string') {
      console.error('assistant upstream returned invalid JSON payload');
      return sendJson(res, 502, { error: 'Respuesta no válida del asistente' });
    }
    return sendJson(res, 200, { respuesta: data.respuesta });
  }

  if (req.method === 'POST' && urlPath.startsWith('/carrito/')) {
    const form = await readFormBody(req);
    let lineas = leerCarrito(cfg.secreto, getCookie(req, 'hk_carrito'));
    if (urlPath === '/carrito/anadir') lineas = anadir(lineas, form.sku, Math.max(cantidadValida(form.cantidad ?? 1), 1));
    else if (urlPath === '/carrito/cantidad') lineas = fijarCantidad(lineas, form.sku, cantidadValida(form.cantidad));
    else if (urlPath === '/carrito/anadir-pack') {
      for (const l of getPack(form.pack)?.lines ?? []) lineas = anadir(lineas, l.product.sku, l.quantity);
    } else return send(res, 404, renderError(404));
    const added = urlPath === '/carrito/anadir' && getProduct(form.sku) ? `?anadido=${encodeURIComponent(form.sku)}`
      : urlPath === '/carrito/anadir-pack' && getPack(form.pack) ? `?pack=${encodeURIComponent(form.pack)}` : '';
    return redirect(res, `/carrito${added}`, [cookieCarrito(cfg.secreto, lineas)]);
  }

  if (urlPath === '/checkout' && req.method === 'POST') {
    const form = await readFormBody(req);
    const lineas = leerCarrito(cfg.secreto, getCookie(req, 'hk_carrito'));
    if (!lineas.length) return redirect(res, '/carrito');
    const orderId = esUuidV4(form.order_id) ? form.order_id : randomUUID();
    const { errores, cliente } = validarCliente(form);
    if (Object.keys(errores).length) {
      return send(res, 400, renderCheckout(resumen(lineas), orderId, form, errores));
    }
    const pedido = construirPedido(lineas, cliente, orderId);
    const envio = await enviarPedido(pedido, { url: cfg.buzonUrl, clave: cfg.claveEquipo, reintentoMs: cfg.reintentoMs });
    if (!envio.ok) return send(res, 502, renderOrderError(resumen(lineas), orderId, form));
    // Confirmed by the mailbox: empty the cart and keep a signed copy of the order to show it.
    const recibo = Buffer.from(JSON.stringify({ id: orderId, items: pedido.items, total: pedido.total, name: cliente.name })).toString('base64url');
    return redirect(res, `/pedido/${orderId}`, [
      cookieCarrito(cfg.secreto, []),
      `hk_pedido=${recibo}.${signRecibo(cfg.secreto, recibo)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400`,
    ]);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, renderError(405), undefined, { allow: 'GET, HEAD' });
  }

  if (urlPath === '/catalogo.json') return send(res, 200, catalogoJson(), 'application/json; charset=utf-8');
  if (urlPath.startsWith('/static/') && (await serveStatic(res, urlPath))) return;

  const lineasGet = leerCarrito(cfg.secreto, getCookie(req, 'hk_carrito'));
  const cartCount = lineasGet.reduce((s, [, q]) => s + q, 0);
  // Visitor-independent pages are rendered once per cart count and served from memory:
  // these are the pages the load test (Black Friday) and the response-time test hit.
  const page = (key, render) =>
    send(res, 200, cached(`${key}|${cartCount}`, () => render({ cartCount })), undefined, sessionCookie(req));

  if (urlPath === '/') return page('/', renderHome);
  if (urlPath === '/carrito') {
    const params = new URL(req.url, 'http://x').searchParams;
    const added = getPack(params.get('pack') ?? '')?.name ?? getProduct(params.get('anadido') ?? '')?.name;
    return send(res, 200, renderCart(resumen(lineasGet), { cartCount, added }), undefined, { 'cache-control': 'no-store', ...sessionCookie(req) });
  }
  if (urlPath === '/checkout') {
    if (!lineasGet.length) return send(res, 200, renderEmptyCheckout());
    return send(res, 200, renderCheckout(resumen(lineasGet), randomUUID(), {}, {}, '', { cartCount }), undefined, { 'cache-control': 'no-store' });
  }
  const conf = /^\/pedido\/([0-9a-f-]{36})$/.exec(urlPath);
  if (conf) {
    const recibo = leerRecibo(cfg.secreto, getCookie(req, 'hk_pedido'));
    if (recibo?.id === conf[1]) return send(res, 200, renderConfirmation(recibo));
    return send(res, 404, renderError(404));
  }
  if (urlPath === '/mas-vendidos') return page(urlPath, renderBestSellers);
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

function signRecibo(secret, data) {
  return createHmac('sha256', secret).update(`recibo:${data}`).digest('base64url');
}

function leerRecibo(secret, value) {
  const [data, mac] = String(value ?? '').split('.');
  if (!data || mac !== signRecibo(secret, data)) return null;
  try { return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); } catch { return null; }
}

/**
 * Options (all optional, read from the environment otherwise):
 * buzonUrl (BUZON_URL), claveEquipo (CLAVE_EQUIPO), secreto (CARRITO_SECRETO), reintentoMs.
 */
export function createApp(opts = {}) {
  const cfg = {
    buzonUrl: opts.buzonUrl ?? process.env.BUZON_URL ?? BUZON_URL_DEFECTO,
    claveEquipo: opts.claveEquipo ?? process.env.CLAVE_EQUIPO,
    secreto: opts.secreto ?? process.env.CARRITO_SECRETO
      // Derived from the team key so every Cloud Run instance signs carts the same way.
      ?? (process.env.CLAVE_EQUIPO && createHash('sha256').update(`devoshop-carrito|${process.env.CLAVE_EQUIPO}`).digest('hex')),
    reintentoMs: opts.reintentoMs ?? 1500,
  };
  if (!cfg.secreto) {
    // Without a shared secret each instance signs carts differently: fine locally, not on several instances.
    cfg.secreto = randomBytes(32).toString('hex');
    console.warn('CARRITO_SECRETO no configurado: se usa uno aleatorio (los carritos no sobreviven a un reinicio ni a otra instancia).');
  }
  if (!cfg.claveEquipo) console.warn('CLAVE_EQUIPO no configurada: los pedidos no se podrán enviar al buzón.');
  return createServer(async (req, res) => {
    try {
      await route(req, res, cfg);
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
