// Catalog used by the pages, the cart, the order and the assistant.
// Built once at startup from the supplier files (src/limpieza.js), kept in memory:
// no database on the request path, so pages stay fast under load.
import { buildCatalog, loadHistorial } from './limpieza.js';

// Display names and images for the LEEME.md categories (the slug IS the catalog category).
export const CATEGORIES = [
  { slug: 'sofa', name: 'Sofás y sillones', img: 'sofa' },
  { slug: 'mesa', name: 'Mesas', img: 'table' },
  { slug: 'silla', name: 'Sillas de comedor', img: 'chair' },
  { slug: 'cama', name: 'Camas', img: 'bed' },
  { slug: 'colchon', name: 'Colchones', img: 'bed' },
  { slug: 'escritorio', name: 'Escritorios', img: 'table' },
  { slug: 'silla_oficina', name: 'Sillas de oficina', img: 'chair' },
  { slug: 'almacenaje', name: 'Almacenaje', img: 'storage' },
  { slug: 'iluminacion', name: 'Iluminación', img: 'lamp' },
  { slug: 'textil', name: 'Textil', img: 'textile' },
  { slug: 'accesorio', name: 'Accesorios', img: 'decor' },
];
/** Categories that count as cross-sell for the agent evaluation. */
export const CROSS_SELL = ['iluminacion', 'textil', 'almacenaje', 'accesorio'];

const categoryBySlug = new Map(CATEGORIES.map((c) => [c.slug, c]));

function describe(p) {
  if (p.descripcion) return p.descripcion;
  return `${p.nombre}, acabado en ${p.material} color ${p.color}. Medidas: ${p.ancho} x ${p.fondo} x ${p.alto} cm (ancho x fondo x alto).`;
}

const { productos } = buildCatalog();
const historial = loadHistorial();

/** Products in the shape the pages use. Price and name are the ones in /catalogo.json. */
const PRODUCTS = productos.map((p) => ({
  sku: p.sku,
  ids_origen: p.ids_origen,
  name: p.nombre,
  category: p.categoria,
  price: p.precio,
  width_cm: p.ancho,
  depth_cm: p.fondo,
  height_cm: p.alto,
  seats: p.plazas,
  color: p.color,
  material: p.material,
  description: describe(p),
}));
const bySku = new Map(PRODUCTS.map((p) => [p.sku, p]));

// Exactly the LEEME.md format, serialised once.
const CATALOGO_JSON = JSON.stringify({
  productos: PRODUCTS.map((p) => ({
    sku: p.sku,
    ids_origen: p.ids_origen,
    nombre: p.name,
    categoria: p.category,
    precio: p.price,
    plazas: p.seats ?? null,
    ancho_cm: p.width_cm,
    color: p.color,
    material: p.material,
  })),
});
export const catalogoJson = () => CATALOGO_JSON;

export const allProducts = () => PRODUCTS;
export const getProduct = (sku) => bySku.get(sku);
export const getCategory = (slug) => categoryBySlug.get(slug);
export const productsInCategory = (slug) => PRODUCTS.filter((p) => p.category === slug);
export const productImage = (p) => `/static/img/${categoryBySlug.get(p.category)?.img ?? 'decor'}.svg`;

// ---------- sales history: best sellers and "bought together" ----------

const skuByOrigin = new Map(PRODUCTS.flatMap((p) => p.ids_origen.map((id) => [id, p.sku])));
const unitsSold = new Map();
const together = new Map(); // sku -> Map(sku -> orders together)
const ordersWith = new Map(); // sku -> number of orders containing it
{
  const orders = new Map();
  for (const h of historial) {
    const sku = skuByOrigin.get(h.id_origen);
    if (!sku) continue;
    unitsSold.set(sku, (unitsSold.get(sku) ?? 0) + h.cantidad);
    if (!orders.has(h.pedido)) orders.set(h.pedido, new Set());
    orders.get(h.pedido).add(sku);
  }
  for (const skus of orders.values()) {
    for (const a of skus) {
      ordersWith.set(a, (ordersWith.get(a) ?? 0) + 1);
      if (!together.has(a)) together.set(a, new Map());
      for (const b of skus) if (a !== b) together.get(a).set(b, (together.get(a).get(b) ?? 0) + 1);
    }
  }
}

/** Real best sellers by units in the sales history (honest social proof, no invented discounts). */
export function bestSellers(limit = 8) {
  return [...PRODUCTS].sort((a, b) => (unitsSold.get(b.sku) ?? 0) - (unitsSold.get(a.sku) ?? 0)).slice(0, limit);
}

/**
 * Cross-sell for a product: items from lighting, textile, storage or accessories most often
 * bought in the same order, with the real share of orders. Falls back to best sellers.
 */
export function complementsFor(product, limit = 4) {
  const base = ordersWith.get(product.sku) ?? 0;
  const pairs = [...(together.get(product.sku) ?? new Map())]
    .map(([sku, n]) => ({ product: bySku.get(sku), n }))
    .filter((x) => x.product && CROSS_SELL.includes(x.product.category) && x.product.category !== product.category)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((x) => ({ ...x.product, share: base ? Math.round((100 * x.n) / base) : null }));
  if (pairs.length >= limit) return pairs;
  const extra = bestSellers(PRODUCTS.length)
    .filter((p) => CROSS_SELL.includes(p.category) && p.category !== product.category && !pairs.some((x) => x.sku === p.sku));
  return [...pairs, ...extra.slice(0, limit - pairs.length)];
}

/** One product per category, best sellers first, for the home page. */
export function featuredProducts(limit = 8) {
  const seen = new Set();
  return bestSellers(PRODUCTS.length).filter((p) => !seen.has(p.category) && seen.add(p.category)).slice(0, limit);
}

// ---------- search ----------

const normalize = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const STOP = new Set(['de', 'la', 'el', 'los', 'las', 'un', 'una', 'para', 'con', 'y', 'en', 'del', 'por', 'que']);
const stem = (w) => w.replace(/(es|s)$/, '');
const words = (s) => normalize(s).split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map(stem);

const SEARCH_INDEX = PRODUCTS.map((p) => ({
  p,
  name: new Set(words(p.name)),
  all: new Set(words([p.name, getCategory(p.category)?.name, p.category, p.color, p.material, p.description, p.seats ? `${p.seats} plazas` : ''].join(' '))),
}));

/**
 * Ranked search: every query word that matches adds points (name matches count double).
 * Never requires all words, so an over-specific query still returns the closest products.
 */
export function searchProducts(query) {
  const q = words(query);
  if (!q.length) return [];
  return SEARCH_INDEX
    .map(({ p, name, all }) => ({ p, score: q.reduce((s, w) => s + (name.has(w) ? 2 : all.has(w) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.price - b.p.price)
    .map((x) => x.p);
}

// ---------- packs: real products at catalog prices, every total below 4.000 € ----------

const PACKS = [
  {
    id: 'salon-completo', name: 'Pack Salón completo', img: 'sofa',
    description: 'Todo para un salón de 20 m²: sofá de piel de tres plazas, sillón de lectura, lámpara de pie, lámpara de techo, alfombra de lana, cojines, manta, estantería y aparador.',
    items: [['sofa-aarhus', 1], ['sillon-viena', 1], ['lampara-de-pie-arco', 1], ['lampara-de-techo-trenzada', 1], ['alfombra-de-salon-160x230', 1], ['pack-4-cojines-decorativos', 1], ['manta-para-sofa', 1], ['estanteria-libreria-5-baldas', 1], ['aparador-3-puertas', 1]],
  },
  {
    id: 'dormitorio', name: 'Pack Dormitorio listo para estrenar', img: 'bed',
    description: 'Cama tapizada de 150, colchón de muelles ensacados, dos mesillas con sus lámparas, ropa de cama completa y armario.',
    items: [['cama-brisa-150x200-tapizada', 1], ['colchon-premium-150x190-de-muelles-ensacados', 1], ['mesilla-de-noche-1-cajon', 2], ['lampara-de-mesilla-ceramica', 2], ['funda-nordica-150-todo-el-ano', 1], ['juego-de-sabanas-150', 1], ['pack-2-almohadas-viscoelasticas', 1], ['protector-de-colchon-impermeable-150', 1], ['armario-2-puertas-correderas', 1]],
  },
  {
    id: 'comedor', name: 'Pack Comedor para seis', img: 'table',
    description: 'Mesa extensible de roble, seis sillas de nogal, aparador y lámpara de techo.',
    items: [['mesa-de-comedor-ebro-extensible', 1], ['pack-6-sillas-de-comedor-nogal', 1], ['aparador-3-puertas', 1], ['lampara-de-techo-trenzada', 1]],
  },
  {
    id: 'despacho', name: 'Pack Despacho en casa', img: 'table',
    description: 'Escritorio elevable eléctrico, silla ergonómica con reposacabezas, flexo, soporte de monitor, reposapiés, alfombrilla, cajonera y estantería.',
    items: [['escritorio-elevable-electrico-160-cm', 1], ['silla-de-oficina-pro-con-reposacabezas', 1], ['flexo-led-regulable', 1], ['soporte-de-monitor-de-madera', 1], ['reposapies-ergonomico', 1], ['alfombrilla-protectora-para-silla', 1], ['cajonera-con-ruedas-3-cajones', 1], ['estanteria-libreria-5-baldas', 1]],
  },
];

const toCents = (n) => Math.round(n * 100);

function expandPack(pack) {
  const lines = pack.items.map(([sku, quantity]) => ({ product: bySku.get(sku), quantity })).filter((l) => l.product);
  const totalCents = lines.reduce((s, l) => s + l.quantity * toCents(l.product.price), 0);
  return { ...pack, lines, total: totalCents / 100 };
}

export const getPacks = () => PACKS.map(expandPack);
export const getPack = (id) => {
  const pack = PACKS.find((p) => p.id === id);
  return pack && expandPack(pack);
};
