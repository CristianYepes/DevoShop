// Cart stored in an HMAC-signed cookie: works across Cloud Run instances with no database.
// It only holds [sku, quantity]; names and prices always come from the catalog.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getProduct } from './catalog.js';

export const MAX_LINEAS = 40;   // keeps the cookie well under 4 KB
export const MAX_CANTIDAD = 20;

const sign = (secret, data) => createHmac('sha256', secret).update(data).digest('base64url');

/** Returns [[sku, qty], ...]; an unsigned, tampered or malformed cookie is an empty cart. */
export function leerCarrito(secret, cookieValue) {
  if (!cookieValue) return [];
  const [data, mac] = cookieValue.split('.');
  if (!data || !mac) return [];
  const expected = Buffer.from(sign(secret, data));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return [];
  try {
    const { l } = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return Array.isArray(l) ? l.filter(([sku, q]) => getProduct(sku) && Number.isInteger(q) && q > 0).slice(0, MAX_LINEAS) : [];
  } catch {
    return [];
  }
}

export function cookieCarrito(secret, lineas) {
  const data = Buffer.from(JSON.stringify({ l: lineas })).toString('base64url');
  return `hk_carrito=${data}.${sign(secret, data)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400`;
}

export const cantidadValida = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_CANTIDAD) : 1;
};

/** Adds quantity to a sku (merging lines). Unknown skus are ignored. */
export function anadir(lineas, sku, cantidad) {
  if (!getProduct(sku) || cantidad < 1) return lineas;
  const i = lineas.findIndex(([s]) => s === sku);
  if (i >= 0) return lineas.map(([s, q], j) => [s, j === i ? Math.min(q + cantidad, MAX_CANTIDAD) : q]);
  return lineas.length >= MAX_LINEAS ? lineas : [...lineas, [sku, Math.min(cantidad, MAX_CANTIDAD)]];
}

/** Sets the quantity of a sku; 0 removes the line. */
export const fijarCantidad = (lineas, sku, cantidad) =>
  cantidad < 1 ? lineas.filter(([s]) => s !== sku) : lineas.map(([s, q]) => [s, s === sku ? cantidad : q]);

/** Cart lines with catalog data and the total, computed in integer cents. */
export function resumen(lineas) {
  const items = lineas.map(([sku, quantity]) => ({ product: getProduct(sku), quantity })).filter((l) => l.product);
  const totalCents = items.reduce((s, l) => s + l.quantity * Math.round(l.product.price * 100), 0);
  return { items, total: totalCents / 100, unidades: items.reduce((s, l) => s + l.quantity, 0) };
}
