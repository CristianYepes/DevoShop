import { randomUUID } from 'node:crypto';

export class OrderValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OrderValidationError';
  }
}

export function createOrder(input, catalog) {
  const customer = input?.customer;
  if (
    typeof customer?.name !== 'string' || !customer.name.trim() ||
    typeof customer?.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim()) ||
    typeof customer?.address !== 'string' || !customer.address.trim()
  ) {
    throw new OrderValidationError('Se requieren nombre, email válido y dirección');
  }

  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 200) {
    throw new OrderValidationError('El pedido debe tener entre 1 y 200 líneas');
  }
  if (!Array.isArray(catalog?.productos)) {
    throw new Error('El catálogo no está disponible o tiene un formato inválido');
  }

  const products = new Map();
  for (const product of catalog.productos) {
    if (typeof product?.sku !== 'string' || !product.sku.trim() || products.has(product.sku)) {
      throw new Error('El catálogo contiene SKU inválidos o duplicados');
    }
    products.set(product.sku, product);
  }

  const seen = new Set();
  let totalCents = 0;
  const items = input.items.map((item) => {
    if (
      typeof item?.sku !== 'string' || !item.sku.trim() ||
      !Number.isSafeInteger(item.quantity) || item.quantity < 1 || seen.has(item.sku)
    ) {
      throw new OrderValidationError('SKU o cantidad inválidos, o SKU repetido');
    }
    seen.add(item.sku);
    const product = products.get(item.sku);
    if (!product) throw new OrderValidationError('El producto no existe en el catálogo');

    const price = product.precio;
    const cents = Math.round(price * 100);
    if (
      typeof product.nombre !== 'string' || !product.nombre.trim() ||
      typeof price !== 'number' || !Number.isFinite(price) || price < 0 ||
      !Number.isSafeInteger(cents) || Math.abs(price * 100 - cents) > 1e-7
    ) {
      throw new Error('El catálogo contiene un nombre o precio inválido');
    }
    const lineCents = cents * item.quantity;
    if (!Number.isSafeInteger(lineCents) || !Number.isSafeInteger(totalCents + lineCents)) {
      throw new OrderValidationError('El importe del pedido es demasiado grande');
    }
    totalCents += lineCents;
    return { sku: product.sku, name: product.nombre, quantity: item.quantity, unit_price: cents / 100 };
  });

  return {
    schema_version: '1.0',
    order_id: randomUUID(),
    created_at: new Date().toISOString(),
    customer: { name: customer.name.trim(), email: customer.email.trim(), address: customer.address.trim() },
    items,
    currency: 'EUR',
    total: totalCents / 100,
  };
}
