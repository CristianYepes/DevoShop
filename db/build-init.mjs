// Generates db/init.sql from the raw supplier files in db/data/.
// Usage: node db/build-init.mjs
//
// Cleaning rules (from data/LEEME.md):
//  - A product listed by both suppliers is sold once, with the data of the most recent update.
//  - Discontinued products are not sold.
//  - Prices include VAT (21 %), in euros with two decimals.
//  - Measurements are in centimetres.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, 'data');
const IVA = 1.21;

// ---------- helpers ----------

const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
const round2 = (n) => Math.round(n * 100) / 100;
// Suppliers round the net price to cents before we add VAT, so the gross can be
// off by up to ±0.006 € (354,55 × 1,21 = 429,0055). Snap to the nearest 10 cents
// when we are that close to it; otherwise keep the exact cents (890 × 1,21 = 1076,90).
function withIva(price, included) {
  if (included) return round2(price);
  const gross = price * IVA;
  const tenth = Math.round(gross * 10) / 10;
  return Math.abs(gross - tenth) <= 0.0061 ? round2(tenth) : round2(gross);
}

const NUM_WORDS = { una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };
function parsePlazas(text) {
  const m = norm(text).match(/\b(\d+|una|un|dos|tres|cuatro|cinco) plazas?\b/);
  if (!m) return null;
  return NUM_WORDS[m[1]] ?? Number(m[1]);
}

// Key used to detect the same product in both catalogues.
function matchKey(name) {
  return norm(name)
    .replace(/\b(\d+|una|un|dos|tres|cuatro|cinco) plazas?\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// "SOFÁ NÓRDICO 3 PLAZAS" -> "Sofá nórdico 3 plazas"
function tidyName(name) {
  const n = name.replace(/\s+/g, ' ').trim().replace(/\bPLAZAS?\b/g, (w) => w.toLowerCase());
  if (n !== n.toUpperCase()) return n;
  const lower = n.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// "1,50 x 0,60 x 2,00 m" | "160x230x1 cm" -> [ancho, fondo, alto] in cm
function parseMedidasA(s) {
  const m = s.trim().match(/^([\d.,]+)\s*x\s*([\d.,]+)\s*x\s*([\d.,]+)\s*(cm|m|mm)$/i);
  if (!m) throw new Error(`Medidas no reconocidas: ${s}`);
  const factor = { m: 100, cm: 1, mm: 0.1 }[m[4].toLowerCase()];
  return [m[1], m[2], m[3]].map((v) => round2(Number(v.replace(',', '.')) * factor));
}

// ---------- vocabularies ----------

const CATEGORIA_A = {
  'SOFAS Y SILLONES': 'sofa',
  'DORMITORIO / CAMAS': 'cama',
  DESCANSO: 'colchon',
  'COMEDOR - MESAS': 'mesa',
  'COMEDOR - SILLAS': 'silla',
  DESPACHO: 'escritorio',
  'DESPACHO - SILLAS': 'silla_oficina',
  ALMACENAJE: 'almacenaje',
  ILUMINACION: 'iluminacion',
  'TEXTIL HOGAR': 'textil',
  ACCESORIOS: 'accesorio',
};
const CATEGORIA_B = {
  sofa: 'sofa', bed: 'cama', mattress: 'colchon', dining_table: 'mesa', dining_chair: 'silla',
  desk: 'escritorio', office_chair: 'silla_oficina', storage: 'almacenaje', lighting: 'iluminacion',
  textile: 'textil', accessory: 'accesorio',
};
const COLOR_B = {
  white: 'blanco', black: 'negro', grey: 'gris', gray: 'gris', beige: 'beige', brown: 'marron',
  blue: 'azul', green: 'verde', oak: 'roble', walnut: 'nogal', natural: 'natural',
};
const MATERIAL_B = {
  fabric: 'tela', linen: 'lino', leather: 'piel', velvet: 'terciopelo', wood: 'madera', metal: 'metal',
  melamine: 'melamina', foam: 'espuma', 'pocket springs': 'muelles', springs: 'muelles',
  cotton: 'algodon', wool: 'lana', mesh: 'malla', ceramic: 'ceramica',
};
const COLORES = ['blanco', 'negro', 'gris', 'beige', 'marron', 'azul', 'verde', 'roble', 'nogal', 'natural'];
const MATERIALES = ['tela', 'lino', 'piel', 'terciopelo', 'madera', 'metal', 'melamina', 'espuma', 'muelles', 'algodon', 'lana', 'malla', 'ceramica'];
const CATEGORIAS = ['sofa', 'cama', 'colchon', 'mesa', 'silla', 'escritorio', 'silla_oficina', 'almacenaje', 'iluminacion', 'textil', 'accesorio'];

function check(value, allowed, what, id) {
  if (!allowed.includes(value)) throw new Error(`${id}: ${what} desconocido "${value}"`);
  return value;
}

// ---------- supplier A (CSV, latin-1, ';' separated, decimal comma) ----------

function loadA() {
  const text = new TextDecoder('latin1').decode(readFileSync(join(dataDir, 'proveedor-a.csv')));
  const [header, ...rows] = text.split(/\r?\n/).filter((l) => l.trim());
  const cols = header.split(';');
  return rows.map((line) => {
    const r = Object.fromEntries(line.split(';').map((v, i) => [cols[i], v.trim()]));
    const id = r.REF;
    const nombre = tidyName(r.DESCRIPCION);
    const categoria = check(CATEGORIA_A[stripAccents(r.FAMILIA).toUpperCase()], CATEGORIAS, 'categoria', id);
    const precio = withIva(Number(r.PVP.replace(/\./g, '').replace(',', '.')), r.IVA_INCL === 'S');
    const [ancho, fondo, alto] = parseMedidasA(r.MEDIDAS);
    const [d, m, y] = r.F_ACT.split('/');
    return {
      id, nombre, categoria, precio, ancho, fondo, alto,
      plazas: categoria === 'sofa' ? parsePlazas(r.DESCRIPCION) : null,
      descripcion: null,
      color: check(norm(r.COLOR), COLORES, 'color', id),
      material: check(norm(r.ACABADO), MATERIALES, 'material', id),
      stock: null,
      activo: r.ESTADO.toUpperCase() === 'ACTIVO',
      actualizado: new Date(`${y}-${m}-${d}T00:00:00Z`),
    };
  });
}

// ---------- supplier B (JSON, English vocab, mixed units) ----------

function loadB() {
  const { products } = JSON.parse(readFileSync(join(dataDir, 'proveedor-b.json'), 'utf8'));
  return products.map((p) => {
    const id = p.id;
    const categoria = check(CATEGORIA_B[p.category], CATEGORIAS, 'categoria', id);
    let ancho, fondo, alto;
    if (p.dimensions) {
      const f = { mm: 0.1, cm: 1, m: 100 }[p.dimensions.unit];
      [ancho, fondo, alto] = [p.dimensions.w, p.dimensions.d, p.dimensions.h].map((v) => round2(v * f));
    } else {
      const m = p.description.match(/Medidas:\s*([\d.,]+)\s*x\s*([\d.,]+)\s*x\s*([\d.,]+)\s*cm/i);
      if (!m) throw new Error(`${id}: sin medidas`);
      [ancho, fondo, alto] = [m[1], m[2], m[3]].map((v) => Number(v.replace(',', '.')));
    }
    if (p.currency !== 'EUR') throw new Error(`${id}: moneda ${p.currency}`);
    return {
      id, nombre: p.title.trim(), categoria, ancho, fondo, alto,
      descripcion: p.description.trim(),
      precio: withIva(p.price_cents / 100, p.tax_included),
      plazas: categoria === 'sofa' ? parsePlazas(p.description) ?? parsePlazas(p.title) : null,
      color: check(COLOR_B[p.color], COLORES, 'color', id),
      material: check(MATERIAL_B[p.material], MATERIALES, 'material', id),
      stock: p.stock ?? null,
      activo: p.status === 'active',
      actualizado: new Date(p.updated_at),
    };
  });
}

// ---------- merge ----------

function buildCatalog() {
  const groups = new Map();
  for (const rec of [...loadA(), ...loadB()]) {
    const k = matchKey(rec.nombre);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(rec);
  }

  const productos = [];
  const descartados = [];
  const usedSkus = new Set();
  for (const recs of groups.values()) {
    recs.sort((a, b) => b.actualizado - a.actualizado);
    const latest = recs[0];
    const ids = recs.map((r) => r.id).sort();
    if (!latest.activo) {
      descartados.push(ids);
      continue;
    }
    let sku = slug(latest.nombre.replace(/\b(\d+|una|un|dos|tres|cuatro|cinco) plazas?\b/gi, ''));
    for (let i = 2, base = sku; usedSkus.has(sku); i++) sku = `${base}-${i}`;
    usedSkus.add(sku);
    // Name: newest record, unless it was shouted in capitals and the other supplier has a proper one.
    const shouted = (r) => r.nombre === tidyName(r.nombre.toUpperCase());
    const nombre = shouted(latest) ? (recs.find((r) => !shouted(r))?.nombre ?? latest.nombre) : latest.nombre;
    productos.push({
      ...latest,
      nombre,
      descripcion: latest.descripcion ?? recs.find((r) => r.descripcion)?.descripcion ?? null,
      sku,
      ids_origen: ids,
      // Only supplier B reports stock; keep it even when A has the newer record.
      stock: latest.stock ?? recs.find((r) => r.stock != null)?.stock ?? null,
    });
  }
  productos.sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nombre.localeCompare(b.nombre, 'es'));
  return { productos, descartados };
}

function loadHistorial() {
  const [, ...rows] = readFileSync(join(dataDir, 'historial-ventas.csv'), 'utf8').split(/\r?\n/).filter((l) => l.trim());
  return rows.map((l) => {
    const [pedido, fecha, id_origen, cantidad, precio] = l.split(',').map((v) => v.trim());
    return { pedido, fecha, id_origen, cantidad: Number(cantidad), precio: Number(precio) };
  });
}

// ---------- SQL ----------

const VIEWS = `
-- Exactly what GET /catalogo.json publishes: SELECT catalogo FROM catalogo_json;
CREATE VIEW catalogo_json AS
SELECT json_build_object('productos', COALESCE(json_agg(json_build_object(
           'sku',        p.sku,
           'ids_origen', (SELECT json_agg(o.id_origen ORDER BY o.id_origen) FROM producto_origenes o WHERE o.sku = p.sku),
           'nombre',     p.nombre,
           'categoria',  p.categoria,
           'precio',     p.precio,
           'plazas',     p.plazas,
           'ancho_cm',   p.ancho_cm,
           'color',      p.color,
           'material',   p.material
       ) ORDER BY p.categoria, p.nombre), '[]'::json)) AS catalogo
FROM productos p;

-- Products bought together in the sales history, mapped to our skus.
-- SELECT * FROM comprado_junto WHERE sku = 'sofa-nordico' ORDER BY pedidos DESC LIMIT 4;
CREATE VIEW comprado_junto AS
WITH lineas AS (
    SELECT DISTINCT h.pedido, o.sku
    FROM historial_ventas h
    JOIN producto_origenes o ON o.id_origen = h.id_origen
)
SELECT a.sku, b.sku AS sku_junto, count(*) AS pedidos
FROM lineas a
JOIN lineas b ON a.pedido = b.pedido AND a.sku <> b.sku
GROUP BY a.sku, b.sku;
`;

const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const money = (n) => n.toFixed(2);

function render({ productos, descartados }, historial) {
  const out = [];
  out.push(`-- GENERATED by db/build-init.mjs from db/data/. Do not edit by hand.
-- Runs once, on the first start of an empty Postgres volume.
-- Products: ${productos.length} for sale. Discontinued and excluded: ${descartados.map((d) => d.join('+')).join(', ') || 'none'}.

CREATE TABLE productos (
    sku          TEXT          PRIMARY KEY,
    nombre       TEXT          NOT NULL,
    descripcion  TEXT,                                              -- texto del proveedor B, si lo hay
    categoria    TEXT          NOT NULL CHECK (categoria IN (${CATEGORIAS.map(q).join(', ')})),
    precio       NUMERIC(10,2) NOT NULL CHECK (precio >= 0),        -- EUR, IVA 21 % incluido
    plazas       SMALLINT      CHECK (plazas > 0),                  -- solo sofás y sillones
    ancho_cm     NUMERIC(7,2)  NOT NULL,
    fondo_cm     NUMERIC(7,2)  NOT NULL,
    alto_cm      NUMERIC(7,2)  NOT NULL,
    color        TEXT          NOT NULL CHECK (color IN (${COLORES.map(q).join(', ')})),
    material     TEXT          NOT NULL CHECK (material IN (${MATERIALES.map(q).join(', ')})),
    stock        INTEGER       CHECK (stock >= 0),                  -- NULL = desconocido
    actualizado  TIMESTAMPTZ   NOT NULL,                            -- fecha del registro ganador
    CHECK (plazas IS NULL OR categoria = 'sofa')
);

-- Supplier identifiers of each product (ids_origen in /catalogo.json).
CREATE TABLE producto_origenes (
    id_origen    TEXT PRIMARY KEY,
    sku          TEXT NOT NULL REFERENCES productos(sku) ON DELETE CASCADE
);
CREATE INDEX ON producto_origenes (sku);

-- Past orders of a similar store, for "frequently bought together".
-- id_origen is a supplier id; join through producto_origenes to get the sku.
CREATE TABLE historial_ventas (
    pedido           TEXT          NOT NULL,
    fecha            DATE          NOT NULL,
    id_origen        TEXT          NOT NULL,
    cantidad         INTEGER       NOT NULL CHECK (cantidad > 0),
    precio_unitario  NUMERIC(10,2) NOT NULL
);
CREATE INDEX ON historial_ventas (pedido);
CREATE INDEX ON historial_ventas (id_origen);

-- Orders placed in this store.
CREATE TABLE pedidos (
    order_id     UUID          PRIMARY KEY,
    email        TEXT          NOT NULL,
    estado       TEXT          NOT NULL DEFAULT 'completed'
                               CHECK (estado IN ('pending', 'completed', 'cancelled')),
    subtotal     NUMERIC(10,2) NOT NULL,
    envio        NUMERIC(10,2) NOT NULL DEFAULT 0,
    montaje      NUMERIC(10,2) NOT NULL DEFAULT 0,
    total        NUMERIC(10,2) NOT NULL,
    creado       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE pedido_lineas (
    order_id     UUID          NOT NULL REFERENCES pedidos(order_id) ON DELETE CASCADE,
    sku          TEXT          NOT NULL REFERENCES productos(sku),
    cantidad     INTEGER       NOT NULL CHECK (cantidad > 0),
    precio       NUMERIC(10,2) NOT NULL,
    PRIMARY KEY (order_id, sku)
);

-- Sales conditions (data/condiciones-de-venta.md) as numbers the checkout can use.
CREATE TABLE condiciones (
    clave        TEXT PRIMARY KEY,
    valor        TEXT NOT NULL,
    descripcion  TEXT NOT NULL
);

INSERT INTO condiciones (clave, valor, descripcion) VALUES
    ('envio_gratis_desde',      '500.00',  'Envío gratis en pedidos desde 500 €'),
    ('envio_coste',             '49.00',   'Coste de envío en pedidos de menos de 500 €'),
    ('montaje_coste',           '39.00',   'Montaje a domicilio, por pedido'),
    ('montaje_gratis_desde',    '1500.00', 'Montaje gratis en pedidos desde 1.500 €'),
    ('entrega_peninsula_dias',  '3-5',     'Días laborables de entrega en la península'),
    ('entrega_baleares_dias',   '7-10',    'Días laborables de entrega en Baleares'),
    ('zonas_sin_envio',         'Canarias,Ceuta,Melilla', 'No enviamos a estas zonas'),
    ('devolucion_dias',         '30',      'Días naturales para devolver un producto sin usar'),
    ('colchon_noches_prueba',   '100',     'Noches de prueba en colchones, recogida sin coste'),
    ('garantia_muebles_anos',   '3',       'Años de garantía en muebles'),
    ('garantia_colchones_anos', '10',      'Años de garantía en colchones'),
    ('metodos_pago',            'tarjeta,bizum,transferencia', 'Métodos de pago aceptados'),
    ('financiacion',            'no',      'No ofrecemos financiación ni pago a plazos');
`);

  out.push('INSERT INTO productos (sku, nombre, descripcion, categoria, precio, plazas, ancho_cm, fondo_cm, alto_cm, color, material, stock, actualizado) VALUES');
  out.push(productos.map((p) =>
    `    (${[q(p.sku), q(p.nombre), q(p.descripcion), q(p.categoria), money(p.precio), q(p.plazas), p.ancho, p.fondo, p.alto, q(p.color), q(p.material), q(p.stock), q(p.actualizado.toISOString())].join(', ')})`,
  ).join(',\n') + ';\n');

  out.push('INSERT INTO producto_origenes (id_origen, sku) VALUES');
  out.push(productos.flatMap((p) => p.ids_origen.map((id) => `    (${q(id)}, ${q(p.sku)})`)).join(',\n') + ';\n');

  out.push('INSERT INTO historial_ventas (pedido, fecha, id_origen, cantidad, precio_unitario) VALUES');
  out.push(historial.map((h) =>
    `    (${q(h.pedido)}, ${q(h.fecha)}, ${q(h.id_origen)}, ${h.cantidad}, ${money(h.precio)})`,
  ).join(',\n') + ';\n');

  out.push(VIEWS);
  return out.join('\n');
}

const catalog = buildCatalog();
const historial = loadHistorial();
writeFileSync(join(here, 'init.sql'), render(catalog, historial));

const merged = catalog.productos.filter((p) => p.ids_origen.length > 1);
console.log(`init.sql: ${catalog.productos.length} productos (${merged.length} en ambos proveedores), ` +
  `${catalog.descartados.length} descatalogados excluidos, ${historial.length} líneas de historial.`);
for (const p of merged) console.log(`  merged ${p.ids_origen.join(' + ')} -> ${p.sku} (${p.precio.toFixed(2)} €)`);
console.log(`  excluded: ${catalog.descartados.map((d) => d.join('+')).join(', ')}`);

// ---------- JSON for the app (served from memory, no DB on the hot path) ----------
// src/data/catalogo.json: clean products; src/data/comprado-junto.json: for each sku, the
// skus bought in the same past order, with how many orders and the % of that sku's orders.
{
  const appDir = join(here, '..', 'src', 'data');
  mkdirSync(appDir, { recursive: true });
  const productos = catalog.productos.map((p) => ({
    sku: p.sku, ids_origen: p.ids_origen, nombre: p.nombre, categoria: p.categoria, precio: p.precio,
    plazas: p.plazas, ancho_cm: p.ancho, fondo_cm: p.fondo, alto_cm: p.alto,
    color: p.color, material: p.material, descripcion: p.descripcion,
  }));
  writeFileSync(join(appDir, 'catalogo.json'), JSON.stringify({ productos }, null, 1) + '\n');

  const skuByOrigen = new Map(catalog.productos.flatMap((p) => p.ids_origen.map((id) => [id, p.sku])));
  const orders = new Map();
  for (const h of historial) {
    const sku = skuByOrigen.get(h.id_origen);
    if (!sku) continue;
    if (!orders.has(h.pedido)) orders.set(h.pedido, new Set());
    orders.get(h.pedido).add(sku);
  }
  const withSku = new Map();
  const pairs = new Map();
  for (const skus of orders.values()) {
    for (const a of skus) {
      withSku.set(a, (withSku.get(a) ?? 0) + 1);
      for (const b of skus) if (a !== b) pairs.set(`${a}|${b}`, (pairs.get(`${a}|${b}`) ?? 0) + 1);
    }
  }
  const junto = {};
  for (const [key, n] of pairs) {
    const [a, b] = key.split('|');
    (junto[a] ??= []).push({ sku: b, pedidos: n, pct: Math.round((n / withSku.get(a)) * 100) });
  }
  for (const list of Object.values(junto)) list.sort((x, y) => y.pedidos - x.pedidos || x.sku.localeCompare(y.sku));
  writeFileSync(join(appDir, 'comprado-junto.json'), JSON.stringify(junto) + '\n');
  console.log(`src/data: ${productos.length} productos, ${Object.keys(junto).length} con "comprado junto"`);
}
