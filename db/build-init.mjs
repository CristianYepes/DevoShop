// Generates db/init.sql from the raw supplier files in db/data/.
// Usage: node db/build-init.mjs
//
// Cleaning rules (from data/LEEME.md):
//  - A product listed by both suppliers is sold once, with the data of the most recent update.
//  - Discontinued products are not sold.
//  - Prices include VAT (21 %), in euros with two decimals.
//  - Measurements are in centimetres.

import { readFileSync, writeFileSync } from 'node:fs';
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

// ---------- SQL (BigQuery / GoogleSQL) ----------
// BigQuery has no CHECK constraints, indexes or enforced keys: the vocabularies are
// checked above while loading, and the keys are declared NOT ENFORCED (optimizer hints).

const DATASET = process.env.BQ_DATASET || 'devoshop';
const LOCATION = process.env.BQ_LOCATION || 'europe-southwest1'; // same region as Cloud Run
if (!/^[A-Za-z0-9_]+$/.test(DATASET)) throw new Error(`BQ_DATASET no válido: ${DATASET}`);
if (!/^[a-z0-9-]+$/i.test(LOCATION)) throw new Error(`BQ_LOCATION no válido: ${LOCATION}`);
const t = (name) => `\`${DATASET}.${name}\``;

// JSON string escapes (\" \\ \n \uXXXX) are valid in GoogleSQL double-quoted literals.
const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : JSON.stringify(String(v)));
const num = (n, d) => (n == null ? 'NULL' : `NUMERIC '${n.toFixed(d)}'`);

const VIEWS = `
-- Exactly what GET /catalogo.json publishes: SELECT catalogo FROM ${DATASET}.catalogo_json;
CREATE OR REPLACE VIEW ${t('catalogo_json')} AS
SELECT TO_JSON_STRING(STRUCT(ARRAY(
           SELECT AS STRUCT
               p.sku,
               ARRAY(SELECT o.id_origen FROM ${t('producto_origenes')} o WHERE o.sku = p.sku ORDER BY o.id_origen) AS ids_origen,
               p.nombre,
               p.categoria,
               p.precio,
               p.plazas,
               p.ancho_cm,
               p.color,
               p.material
           FROM ${t('productos')} p
           ORDER BY p.categoria, p.nombre
       ) AS productos)) AS catalogo;

-- Products bought together in the sales history, mapped to our skus.
-- SELECT * FROM ${DATASET}.comprado_junto WHERE sku = 'sofa-nordico' ORDER BY pedidos DESC LIMIT 4;
CREATE OR REPLACE VIEW ${t('comprado_junto')} AS
WITH lineas AS (
    SELECT DISTINCT h.pedido, o.sku
    FROM ${t('historial_ventas')} h
    JOIN ${t('producto_origenes')} o ON o.id_origen = h.id_origen
)
SELECT a.sku, b.sku AS sku_junto, COUNT(*) AS pedidos
FROM lineas a
JOIN lineas b ON a.pedido = b.pedido AND a.sku <> b.sku
GROUP BY a.sku, b.sku;
`;

const CONDICIONES = [
  ['envio_gratis_desde', '500.00', 'Envío gratis en pedidos desde 500 €'],
  ['envio_coste', '49.00', 'Coste de envío en pedidos de menos de 500 €'],
  ['montaje_coste', '39.00', 'Montaje a domicilio, por pedido'],
  ['montaje_gratis_desde', '1500.00', 'Montaje gratis en pedidos desde 1.500 €'],
  ['entrega_peninsula_dias', '3-5', 'Días laborables de entrega en la península'],
  ['entrega_baleares_dias', '7-10', 'Días laborables de entrega en Baleares'],
  ['zonas_sin_envio', 'Canarias,Ceuta,Melilla', 'No enviamos a estas zonas'],
  ['devolucion_dias', '30', 'Días naturales para devolver un producto sin usar'],
  ['colchon_noches_prueba', '100', 'Noches de prueba en colchones, recogida sin coste'],
  ['garantia_muebles_anos', '3', 'Años de garantía en muebles'],
  ['garantia_colchones_anos', '10', 'Años de garantía en colchones'],
  ['metodos_pago', 'tarjeta,bizum,transferencia', 'Métodos de pago aceptados'],
  ['financiacion', 'no', 'No ofrecemos financiación ni pago a plazos'],
];

function render({ productos, descartados }, historial) {
  const out = [];
  out.push(`-- GENERATED by db/build-init.mjs from db/data/. Do not edit by hand.
-- BigQuery (GoogleSQL) script. Safe to re-run: the catalogue tables are replaced,
-- the order tables (pedidos, pedido_lineas) are only created if missing.
-- Products: ${productos.length} for sale. Discontinued and excluded: ${descartados.map((d) => d.join('+')).join(', ') || 'none'}.

CREATE SCHEMA IF NOT EXISTS \`${DATASET}\` OPTIONS (location = '${LOCATION}');

CREATE OR REPLACE TABLE ${t('productos')} (
    sku          STRING        NOT NULL,
    nombre       STRING        NOT NULL,
    descripcion  STRING,                                -- texto del proveedor B, si lo hay
    categoria    STRING        NOT NULL,                -- ${CATEGORIAS.join(', ')}
    precio       NUMERIC(10,2) NOT NULL,                -- EUR, IVA 21 % incluido
    plazas       INT64,                                 -- solo sofás y sillones
    ancho_cm     NUMERIC(7,2)  NOT NULL,
    fondo_cm     NUMERIC(7,2)  NOT NULL,
    alto_cm      NUMERIC(7,2)  NOT NULL,
    color        STRING        NOT NULL,                -- ${COLORES.join(', ')}
    material     STRING        NOT NULL,                -- ${MATERIALES.join(', ')}
    stock        INT64,                                 -- NULL = desconocido
    actualizado  TIMESTAMP     NOT NULL,                -- fecha del registro ganador
    PRIMARY KEY (sku) NOT ENFORCED
);

-- Supplier identifiers of each product (ids_origen in /catalogo.json).
CREATE OR REPLACE TABLE ${t('producto_origenes')} (
    id_origen    STRING NOT NULL,
    sku          STRING NOT NULL,
    PRIMARY KEY (id_origen) NOT ENFORCED
);

-- Past orders of a similar store, for "frequently bought together".
-- id_origen is a supplier id; join through producto_origenes to get the sku.
CREATE OR REPLACE TABLE ${t('historial_ventas')} (
    pedido           STRING        NOT NULL,
    fecha            DATE          NOT NULL,
    id_origen        STRING        NOT NULL,
    cantidad         INT64         NOT NULL,
    precio_unitario  NUMERIC(10,2) NOT NULL
);

-- Sales conditions (data/condiciones-de-venta.md) as values the checkout can use.
CREATE OR REPLACE TABLE ${t('condiciones')} (
    clave        STRING NOT NULL,
    valor        STRING NOT NULL,
    descripcion  STRING NOT NULL,
    PRIMARY KEY (clave) NOT ENFORCED
);

-- Orders placed in this store. Kept across re-runs.
CREATE TABLE IF NOT EXISTS ${t('pedidos')} (
    order_id     STRING        NOT NULL,                -- UUID
    email        STRING        NOT NULL,
    estado       STRING        DEFAULT 'completed' NOT NULL, -- pending, completed, cancelled
    subtotal     NUMERIC(10,2) NOT NULL,
    envio        NUMERIC(10,2) DEFAULT 0 NOT NULL,
    montaje      NUMERIC(10,2) DEFAULT 0 NOT NULL,
    total        NUMERIC(10,2) NOT NULL,
    creado       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP() NOT NULL,
    PRIMARY KEY (order_id) NOT ENFORCED
);

CREATE TABLE IF NOT EXISTS ${t('pedido_lineas')} (
    order_id     STRING        NOT NULL,
    sku          STRING        NOT NULL,
    cantidad     INT64         NOT NULL,
    precio       NUMERIC(10,2) NOT NULL,
    PRIMARY KEY (order_id, sku) NOT ENFORCED
);
`);

  out.push(`INSERT INTO ${t('condiciones')} (clave, valor, descripcion) VALUES`);
  out.push(CONDICIONES.map((c) => `    (${c.map(q).join(', ')})`).join(',\n') + ';\n');

  out.push(`INSERT INTO ${t('productos')} (sku, nombre, descripcion, categoria, precio, plazas, ancho_cm, fondo_cm, alto_cm, color, material, stock, actualizado) VALUES`);
  out.push(productos.map((p) =>
    `    (${[q(p.sku), q(p.nombre), q(p.descripcion), q(p.categoria), num(p.precio, 2), q(p.plazas), num(p.ancho, 2), num(p.fondo, 2), num(p.alto, 2), q(p.color), q(p.material), q(p.stock), `TIMESTAMP '${p.actualizado.toISOString()}'`].join(', ')})`,
  ).join(',\n') + ';\n');

  out.push(`INSERT INTO ${t('producto_origenes')} (id_origen, sku) VALUES`);
  out.push(productos.flatMap((p) => p.ids_origen.map((id) => `    (${q(id)}, ${q(p.sku)})`)).join(',\n') + ';\n');

  out.push(`INSERT INTO ${t('historial_ventas')} (pedido, fecha, id_origen, cantidad, precio_unitario) VALUES`);
  out.push(historial.map((h) =>
    `    (${q(h.pedido)}, DATE '${h.fecha}', ${q(h.id_origen)}, ${h.cantidad}, ${num(h.precio, 2)})`,
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
