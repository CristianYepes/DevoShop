// Cart in a signed cookie (HMAC-SHA256). Works with any number of Cloud Run instances and
// no database. The cookie only stores SKUs and quantities: names and prices always come
// from the catalog, so a tampered cookie cannot change a price (and fails the signature).
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getProduct } from './catalog.js';

// Same key on every instance: derived from the team key (or an explicit secret).
const SECRET = process.env.CARRITO_SECRET
  || (process.env.CLAVE_EQUIPO && createHash('sha256').update(`devoshop-carrito|${process.env.CLAVE_EQUIPO}`).digest())
  || randomBytes(32);

export const MAX_LINES = 40;
export const MAX_QTY = 20;
const COOKIE = 'hk_carrito';

const sign = (data) => createHmac('sha256', SECRET).update(data).digest('base64url');

function readCookie(req, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie ?? '');
  return m ? m[1] : null;
}

/** Signed JSON value from a cookie, or null if missing or tampered with. */
export function readSigned(req, name) {
  const raw = readCookie(req, name);
  if (!raw) return null;
  const [data, mac] = raw.split('.');
  if (!data || !mac) return null;
  const expected = Buffer.from(sign(data));
  const got = Buffer.from(mac);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try { return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); } catch { return null; }
}

export function signedCookie(name, value, maxAge = 86400) {
  const data = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${name}=${data}.${sign(data)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

/**
 * Cart state: { lines: [[sku, qty]], orderId?: string }. Lines whose SKU is no longer in the
 * catalog are dropped. orderId is fixed when checkout opens, so a double submit sends the
 * same order_id twice and the mailbox keeps only one.
 */
export function readCart(req) {
  const v = readSigned(req, COOKIE);
  const lines = Array.isArray(v?.l) ? v.l.filter(([sku, q]) => getProduct(sku) && Number.isInteger(q) && q > 0) : [];
  return { lines, orderId: typeof v?.o === 'string' ? v.o : null };
}

export const cartCookie = (cart) => signedCookie(COOKIE, { l: cart.lines, ...(cart.orderId ? { o: cart.orderId } : {}) });

export function addToCart(cart, sku, qty) {
  const lines = cart.lines.map(([s, q]) => [s, q]);
  const line = lines.find(([s]) => s === sku);
  if (line) line[1] = Math.min(MAX_QTY, line[1] + qty);
  else if (lines.length < MAX_LINES) lines.push([sku, Math.min(MAX_QTY, qty)]);
  return { lines, orderId: null };
}

export function setQuantity(cart, sku, qty) {
  const lines = cart.lines
    .map(([s, q]) => [s, s === sku ? Math.min(MAX_QTY, qty) : q])
    .filter(([, q]) => q > 0);
  return { lines, orderId: null };
}

/** Lines with catalog data and the total, computed in integer cents. */
export function priceCart(cart) {
  const items = cart.lines.map(([sku, quantity]) => {
    const product = getProduct(sku);
    return { product, quantity, subtotalCents: quantity * product.cents };
  });
  const totalCents = items.reduce((s, i) => s + i.subtotalCents, 0);
  return { items, totalCents, total: totalCents / 100, count: items.reduce((s, i) => s + i.quantity, 0) };
}
