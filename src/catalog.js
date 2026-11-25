// Catalog access used by the pages.
// TEMPORARY: demo products so the design can be built before the supplier files arrive.
// The feat/catalogo branch replaces DEMO_PRODUCTS with the clean catalog built from
// proveedor-a.csv + proveedor-b.json (the same one served at /catalogo.json).

export const CATEGORIES = [
  { slug: 'sofas', name: 'Sofás', img: 'sofa' },
  { slug: 'sillones', name: 'Sillones', img: 'chair' },
  { slug: 'mesas', name: 'Mesas', img: 'table' },
  { slug: 'camas', name: 'Camas', img: 'bed' },
  { slug: 'almacenaje', name: 'Almacenaje', img: 'storage' },
  { slug: 'iluminacion', name: 'Iluminación', img: 'lamp' },
  { slug: 'textil', name: 'Textil', img: 'textile' },
  { slug: 'decoracion', name: 'Decoración', img: 'decor' },
];

const DEMO_PRODUCTS = [
  { sku: 'demo-sofa-3p', name: 'Sofá 3 plazas Nórdico', category: 'sofas', price: 899, width_cm: 210, seats: 3, color: 'gris', material: 'tela', description: 'Sofá de líneas rectas con cojines de espuma de alta densidad y patas de roble macizo.' },
  { sku: 'demo-sofa-2p', name: 'Sofá 2 plazas Lino', category: 'sofas', price: 649, width_cm: 165, seats: 2, color: 'beige', material: 'lino', description: 'Sofá compacto tapizado en lino lavado, ideal para salones pequeños.' },
  { sku: 'demo-sofa-chaise', name: 'Sofá chaise longue Oslo', category: 'sofas', price: 1290, old_price: 1490, width_cm: 280, seats: 4, color: 'verde', material: 'terciopelo', description: 'Sofá con chaise longue reversible y tapizado de terciopelo resistente.' },
  { sku: 'demo-sillon-lectura', name: 'Sillón de lectura Ámbar', category: 'sillones', price: 429, old_price: 519, width_cm: 78, color: 'marrón', material: 'piel', description: 'Sillón envolvente en piel natural con respaldo alto.' },
  { sku: 'demo-mesa-comedor', name: 'Mesa de comedor Roble 180', category: 'mesas', price: 749, width_cm: 180, color: 'natural', material: 'madera', description: 'Mesa de roble macizo para seis personas con acabado al aceite.' },
  { sku: 'demo-mesa-centro', name: 'Mesa de centro Redonda', category: 'mesas', price: 239, width_cm: 90, color: 'negro', material: 'metal', description: 'Mesa de centro de acero con sobre de vidrio templado.' },
  { sku: 'demo-cama-160', name: 'Cama Bruma 160', category: 'camas', price: 690, width_cm: 170, color: 'blanco', material: 'tela', description: 'Cama tapizada con cabecero acolchado para colchón de 160 × 200 cm.' },
  { sku: 'demo-aparador', name: 'Aparador Vela', category: 'almacenaje', price: 559, width_cm: 160, color: 'natural', material: 'madera', description: 'Aparador de cuatro puertas con estantes interiores regulables.' },
  { sku: 'demo-estanteria', name: 'Estantería Línea', category: 'almacenaje', price: 189, old_price: 229, width_cm: 80, color: 'negro', material: 'metal', description: 'Estantería abierta de cinco baldas, ligera y robusta.' },
  { sku: 'demo-lampara-pie', name: 'Lámpara de pie Arco', category: 'iluminacion', price: 159, old_price: 189, width_cm: 40, color: 'negro', material: 'metal', description: 'Lámpara de pie con brazo curvo y pantalla orientable.' },
  { sku: 'demo-lampara-mesa', name: 'Lámpara de mesa Duna', category: 'iluminacion', price: 69, width_cm: 25, color: 'blanco', material: 'cerámica', description: 'Lámpara de cerámica esmaltada con pantalla de lino.' },
  { sku: 'demo-alfombra', name: 'Alfombra Tierra 200 × 300', category: 'textil', price: 249, old_price: 299, width_cm: 200, color: 'beige', material: 'lana', description: 'Alfombra de lana tejida a mano en tonos tierra.' },
  { sku: 'demo-cojin', name: 'Cojín Lino 50 × 50', category: 'textil', price: 29.95, width_cm: 50, color: 'verde', material: 'lino', description: 'Funda de lino lavado con relleno de fibra.' },
  { sku: 'demo-manta', name: 'Manta Punto Grueso', category: 'textil', price: 59.9, width_cm: 130, color: 'gris', material: 'algodón', description: 'Manta de punto grueso, suave y cálida.' },
  { sku: 'demo-jarron', name: 'Jarrón Barro', category: 'decoracion', price: 34.5, width_cm: 18, color: 'terracota', material: 'cerámica', description: 'Jarrón de barro cocido hecho a mano.' },
  { sku: 'demo-espejo', name: 'Espejo Redondo 80', category: 'decoracion', price: 119, width_cm: 80, color: 'dorado', material: 'metal', description: 'Espejo redondo con marco fino de latón.' },
];

const bySku = new Map(DEMO_PRODUCTS.map((p) => [p.sku, p]));
const categoryBySlug = new Map(CATEGORIES.map((c) => [c.slug, c]));

export const getProduct = (sku) => bySku.get(sku);
export const getCategory = (slug) => categoryBySlug.get(slug);
export const productsInCategory = (slug) => DEMO_PRODUCTS.filter((p) => p.category === slug);
export const productImage = (p) => `/static/img/${categoryBySlug.get(p.category)?.img ?? 'decor'}.svg`;

/** One product per category, for the home page. */
export function featuredProducts(limit = 8) {
  const seen = new Set();
  return DEMO_PRODUCTS.filter((p) => !seen.has(p.category) && seen.add(p.category)).slice(0, limit);
}

/** Lighting, textile, storage and decor items to complete a room: the cross-sell categories. */
export function complementsFor(product, limit = 4) {
  const extras = ['iluminacion', 'textil', 'almacenaje', 'decoracion'];
  return DEMO_PRODUCTS.filter((p) => p.sku !== product.sku && p.category !== product.category && extras.includes(p.category)).slice(0, limit);
}

const normalize = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Every word of the query must appear in name, category, color, material or description. */
export function searchProducts(query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return DEMO_PRODUCTS.filter((p) => {
    const hay = normalize([p.name, getCategory(p.category)?.name, p.color, p.material, p.description].join(' '));
    return words.every((w) => hay.includes(w));
  });
}

/** Products whose previous price is higher than the current one, biggest saving first. */
export function offerProducts() {
  return DEMO_PRODUCTS.filter((p) => p.old_price > p.price)
    .sort((a, b) => (b.old_price - b.price) / b.old_price - (a.old_price - a.price) / a.old_price);
}

// Packs: ready-made rooms. Each pack is just a list of catalog products, so the order
// carries the same SKUs, names and unit prices as /catalogo.json (no pack-only prices).
const PACKS = [
  {
    id: 'salon-completo', name: 'Pack Salón completo', img: 'sofa',
    description: 'Todo lo que necesita un salón: sofá de tres plazas, mesa de centro, lámpara de pie, alfombra de lana y cojines a juego.',
    items: [['demo-sofa-3p', 1], ['demo-mesa-centro', 1], ['demo-lampara-pie', 1], ['demo-alfombra', 1], ['demo-cojin', 2]],
  },
  {
    id: 'dormitorio', name: 'Pack Dormitorio sereno', img: 'bed',
    description: 'Cama tapizada de 160 con dos lámparas de mesita, una manta de punto y un espejo redondo.',
    items: [['demo-cama-160', 1], ['demo-lampara-mesa', 2], ['demo-manta', 1], ['demo-espejo', 1]],
  },
  {
    id: 'comedor', name: 'Pack Comedor y almacenaje', img: 'table',
    description: 'Mesa de roble para seis, aparador a juego y un jarrón de barro para el centro.',
    items: [['demo-mesa-comedor', 1], ['demo-aparador', 1], ['demo-jarron', 1]],
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
