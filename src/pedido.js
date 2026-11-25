// Builds the v1.0 order from the cart (catalog names and prices only) and sends it to the
// hackathon mailbox from the server, before the confirmation page is shown.
import { resumen } from './carrito.js';

export const BUZON_URL_DEFECTO = 'https://hk-buzon-168798369712.europe-southwest1.run.app/api/pedido';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const esUuidV4 = (s) => UUID_V4.test(String(s));

/** Validates the guest form; returns { errores, cliente }. */
export function validarCliente(form) {
  const cliente = {
    name: String(form.nombre ?? '').trim().slice(0, 200),
    email: String(form.email ?? '').trim().slice(0, 200),
    address: String(form.direccion ?? '').trim().slice(0, 300),
  };
  const errores = {};
  if (!cliente.name) errores.nombre = 'Escribe tu nombre y apellidos.';
  if (!EMAIL.test(cliente.email)) errores.email = 'Escribe un email válido, por ejemplo nombre@dominio.com.';
  if (!cliente.address) errores.direccion = 'Escribe la dirección de envío.';
  return { errores, cliente };
}

export function construirPedido(lineas, cliente, orderId, ahora = new Date()) {
  const { items, total } = resumen(lineas);
  return {
    schema_version: '1.0',
    order_id: orderId,
    created_at: ahora.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    customer: cliente,
    items: items.map((l) => ({ sku: l.product.sku, name: l.product.name, quantity: l.quantity, unit_price: l.product.price })),
    currency: 'EUR',
    total,
  };
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POSTs the order. Retries 429/502/network errors (3 attempts). A 422 "repetido" means an
 * earlier attempt with the same order_id already got through, so it counts as accepted.
 * Returns { ok, status, detalle }.
 */
export async function enviarPedido(pedido, { url, clave, reintentoMs = 1500 }) {
  if (!clave) return { ok: false, status: 0, detalle: 'CLAVE_EQUIPO no configurada' };
  const body = JSON.stringify(pedido);
  if (Buffer.byteLength(body, 'utf8') > 64 * 1024) {
    return { ok: false, status: 413, detalle: 'El pedido supera los 64 KB' };
  }
  let ultimo = { ok: false, status: 0, detalle: 'sin respuesta' };
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'x-clave': clave, 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(4000),
      });
      const detalle = await r.text();
      if (r.status === 200) {
        let respuesta;
        try {
          respuesta = JSON.parse(detalle);
        } catch {
          return { ok: false, status: 200, detalle: 'Respuesta inválida del buzón; resultado incierto' };
        }
        if (respuesta?.ok === true) return { ok: true, status: r.status, detalle };
        return { ok: false, status: 200, detalle: 'El buzón no confirmó el pedido; resultado incierto' };
      }
      if (r.status === 422 && /repetid|duplicad|ya existe/i.test(detalle)) return { ok: true, status: r.status, detalle };
      ultimo = { ok: false, status: r.status, detalle };
      if (r.status !== 429 && r.status !== 502 && r.status !== 503) break;
    } catch (err) {
      ultimo = { ok: false, status: 0, detalle: err.message };
    }
    if (intento < 3) await espera(reintentoMs * intento);
  }
  console.error(`buzón: pedido ${pedido.order_id} rechazado (${ultimo.status}): ${ultimo.detalle}`);
  return ultimo;
}
