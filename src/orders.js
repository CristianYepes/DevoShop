// Builds the v1.0 order from the catalog and sends it to the hackathon mailbox from the
// server (the team key never reaches the browser). The order is sent BEFORE the customer
// sees the confirmation; if the mailbox does not accept it, there is no confirmation.

const BUZON_URL = process.env.BUZON_URL || 'https://hk-buzon-168798369712.europe-southwest1.run.app/api/pedido';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Field errors for the checkout form, in Spanish, keyed by field name. */
export function validateCustomer({ name, email, address }) {
  const errors = {};
  if (!name) errors.name = 'Escribe tu nombre y apellidos.';
  if (!email) errors.email = 'Escribe tu email.';
  else if (!EMAIL_RE.test(email)) errors.email = 'Escribe un email válido, por ejemplo nombre@dominio.com.';
  if (!address) errors.address = 'Escribe la dirección de envío: calle, número, código postal y ciudad.';
  return errors;
}

/** v1.0 order. Names and prices come from the catalog; the total is summed in cents. */
export function buildOrder(orderId, customer, priced) {
  return {
    schema_version: '1.0',
    order_id: orderId,
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    customer: { name: customer.name, email: customer.email, address: customer.address },
    items: priced.items.map((i) => ({
      sku: i.product.sku, name: i.product.name, quantity: i.quantity, unit_price: i.product.cents / 100,
    })),
    currency: 'EUR',
    total: priced.totalCents / 100,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POSTs the order. Retries on 502, 429 and network errors (3 tries, < 10 s in total).
 * A 422 for a repeated order_id means an earlier try was already stored: that is a success.
 * Returns { ok: true } or { ok: false, status, message }.
 */
export async function sendOrder(order) {
  const key = process.env.CLAVE_EQUIPO;
  if (!key) {
    console.error('pedido: CLAVE_EQUIPO no está configurada; no se puede enviar al buzón');
    return { ok: false, status: 0, message: 'missing CLAVE_EQUIPO' };
  }
  let last = { ok: false, status: 0, message: '' };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(BUZON_URL, {
        method: 'POST',
        headers: { 'x-clave': key, 'content-type': 'application/json' },
        body: JSON.stringify(order),
        signal: AbortSignal.timeout(4000),
      });
      const text = await r.text();
      if (r.ok) return { ok: true };
      if (r.status === 422 && /order_id/i.test(text) && /repet|exist|duplic|ya /i.test(text)) return { ok: true };
      last = { ok: false, status: r.status, message: text.slice(0, 300) };
      if (r.status === 401) console.error('pedido: el buzón rechaza la clave (401). Revisa CLAVE_EQUIPO');
      else console.error(`pedido ${order.order_id}: buzón ${r.status} ${last.message}`);
      if (r.status !== 502 && r.status !== 429) return last;
    } catch (err) {
      last = { ok: false, status: 0, message: err.name };
      console.error(`pedido ${order.order_id}: error de red (${err.name}), intento ${attempt}`);
    }
    if (attempt < 3) await sleep(500 * attempt);
  }
  return last;
}
