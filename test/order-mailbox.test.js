import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MailboxError, sendOrderToMailbox } from '../src/order-mailbox.js';
import { createOrder } from '../src/order.js';

test('envía el pedido al buzón con la clave en la cabecera', async () => {
  const order = createOrder({
    customer: { name: 'Cliente', email: 'cliente@example.com', address: 'Calle 1' },
    items: [{ sku: 'A-1', quantity: 2 }],
  }, { productos: [{ sku: 'A-1', nombre: 'Lámpara', precio: 23.97 }] });
  await sendOrderToMailbox(order, {
    teamKey: 'clave-de-prueba',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://hk-buzon-168798369712.europe-southwest1.run.app/api/pedido');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['x-clave'], 'clave-de-prueba');
      assert.equal(options.headers['content-type'], 'application/json');
      assert.deepEqual(JSON.parse(options.body), order);
      assert.equal(order.total, 47.94);
      return Response.json({ ok: true });
    },
  });
});

test('no envía pedidos sin clave ni cuerpos que superen 64 KB', async () => {
  const fetchImpl = () => assert.fail('No debe enviar la petición');
  await assert.rejects(sendOrderToMailbox({}, { teamKey: '', fetchImpl }), MailboxError);
  await assert.rejects(
    sendOrderToMailbox({ data: 'x'.repeat(64 * 1024) }, { teamKey: 'clave', fetchImpl }),
    MailboxError,
  );
});

test('propaga el rechazo del buzón sin dar el pedido por confirmado', async () => {
  await assert.rejects(
    sendOrderToMailbox({}, {
      teamKey: 'clave',
      fetchImpl: async () => new Response('Pedido inválido', { status: 422 }),
    }),
    (err) => err instanceof MailboxError && err.status === 422 && err.detail === 'Pedido inválido',
  );
});

test('no trata como confirmación una respuesta inválida o un fallo de red', async () => {
  for (const fetchImpl of [
    async () => new Response('invalid json'),
    async () => Response.json({ ok: false }),
    async () => { throw new Error('network error'); },
  ]) {
    await assert.rejects(
      sendOrderToMailbox({}, { teamKey: 'clave', fetchImpl }),
      (err) => err instanceof MailboxError && /incierto/.test(err.message),
    );
  }
});
