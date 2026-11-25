import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enviarPedido } from '../src/pedido.js';

test('rejects orders larger than the mailbox limit before sending', async () => {
  const result = await enviarPedido(
    { name: 'á'.repeat(32768) },
    { url: 'http://127.0.0.1:1', clave: 'test', reintentoMs: 1 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 413);
});

test('a malformed success response is not a confirmation', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('invalid json', { status: 200 }));
  const result = await enviarPedido({}, { url: 'https://example.test', clave: 'test' });
  assert.equal(result.ok, false);
  assert.match(result.detalle, /incierto/);
});
