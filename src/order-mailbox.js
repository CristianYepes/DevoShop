const MAILBOX_URL = 'https://hk-buzon-168798369712.europe-southwest1.run.app/api/pedido';
const MAX_ORDER_BYTES = 64 * 1024;

export class MailboxError extends Error {
  constructor(message, { status, detail, cause } = {}) {
    super(message, { cause });
    this.name = 'MailboxError';
    this.status = status;
    this.detail = detail;
  }
}

export async function sendOrderToMailbox(order, { teamKey = process.env.CLAVE_EQUIPO, fetchImpl = fetch } = {}) {
  if (typeof teamKey !== 'string' || !teamKey.trim()) {
    throw new MailboxError('Falta la clave del equipo para enviar el pedido');
  }

  const body = JSON.stringify(order);
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > MAX_ORDER_BYTES) {
    throw new MailboxError('El pedido no es JSON válido o supera los 64 KB');
  }

  let response;
  try {
    response = await fetchImpl(MAILBOX_URL, {
      method: 'POST',
      headers: { 'x-clave': teamKey, 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    throw new MailboxError('No se pudo confirmar la entrega del pedido; el resultado es incierto', { cause });
  }

  if (!response.ok) {
    const detail = response.status === 422 ? (await response.text()).slice(0, 1000) : undefined;
    throw new MailboxError(`El buzón rechazó el pedido (HTTP ${response.status})`, { status: response.status, detail });
  }

  let result;
  try {
    result = await response.json();
  } catch (cause) {
    throw new MailboxError('El buzón devolvió una respuesta inválida; el resultado es incierto', { cause });
  }
  if (response.status !== 200 || result?.ok !== true) {
    throw new MailboxError('El buzón no confirmó el pedido; el resultado es incierto', { status: response.status });
  }
}
