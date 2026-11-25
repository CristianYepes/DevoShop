import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrder, OrderValidationError } from '../src/order.js';

const catalog = {
  productos: [
    { sku: 'sofa', nombre: 'Sofá', precio: 649 },
    { sku: 'lampara', nombre: 'Lámpara', precio: 23.97 },
  ],
};
const customer = { name: ' Lucía ', email: ' lucia@example.com ', address: ' Calle 12 ' };

test('construye el pedido usando exclusivamente nombres y precios del catálogo', () => {
  const order = createOrder({
    customer,
    items: [{ sku: 'sofa', quantity: 1, unit_price: 1 }, { sku: 'lampara', quantity: 3 }],
  }, catalog);

  assert.match(order.order_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(order.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(order.schema_version, '1.0');
  assert.equal(order.currency, 'EUR');
  assert.deepEqual(order.customer, { name: 'Lucía', email: 'lucia@example.com', address: 'Calle 12' });
  assert.deepEqual(order.items, [
    { sku: 'sofa', name: 'Sofá', quantity: 1, unit_price: 649 },
    { sku: 'lampara', name: 'Lámpara', quantity: 3, unit_price: 23.97 },
  ]);
  assert.equal(order.total, 720.91);
  assert.notEqual(order.order_id, createOrder({ customer, items: [{ sku: 'sofa', quantity: 1 }] }, catalog).order_id);
});

test('rechaza clientes y carritos inválidos o con productos desconocidos', () => {
  const cases = [
    { customer: { ...customer, email: 'invalid' }, items: [{ sku: 'sofa', quantity: 1 }] },
    { customer, items: [] },
    { customer, items: [{ sku: 'missing', quantity: 1 }] },
    { customer, items: [{ sku: 'sofa', quantity: 0 }] },
    { customer, items: [{ sku: 'sofa', quantity: 1.5 }] },
    { customer, items: [{ sku: 'sofa', quantity: 1 }, { sku: 'sofa', quantity: 1 }] },
    { customer, items: Array.from({ length: 201 }, () => ({ sku: 'sofa', quantity: 1 })) },
    { customer, items: [{ sku: 'sofa', quantity: Number.MAX_SAFE_INTEGER }] },
  ];
  for (const input of cases) assert.throws(() => createOrder(input, catalog), OrderValidationError);
});

test('rechaza catálogos ausentes, ambiguos o con precios inválidos', () => {
  const input = { customer, items: [{ sku: 'sofa', quantity: 1 }] };
  for (const invalidCatalog of [
    {},
    { productos: [catalog.productos[0], catalog.productos[0]] },
    { productos: [{ sku: 'sofa', nombre: 'Sofá', precio: 1.001 }] },
  ]) {
    assert.throws(() => createOrder(input, invalidCatalog), (err) => !(err instanceof OrderValidationError));
  }
});
