// Supplier data cleaning (moved from db/build-init.mjs so the server and the SQL
// generator share one implementation). Rules from db/data/LEEME.md:
//  - A product listed by both suppliers is sold once, with the data of the most recent update.
//  - Discontinued products are not sold.
//  - Prices include VAT (21 %), in euros with two decimals.
//  - Measurements are in centimetres.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = fileURLToPath(new URL('../db/data/', import.meta.url));
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
export const COLORES = ['blanco', 'negro', 'gris', 'beige', 'marron', 'azul', 'verde', 'roble', 'nogal', 'natural'];
export const MATERIALES = ['tela', 'lino', 'piel', 'terciopelo', 'madera', 'metal', 'melamina', 'espuma', 'muelles', 'algodon', 'lana', 'malla', 'ceramica'];
export const CATEGORIAS = ['sofa', 'cama', 'colchon', 'mesa', 'silla', 'escritorio', 'silla_oficina', 'almacenaje', 'iluminacion', 'textil', 'accesorio'];

function check(value, allowed, what, id) {
  if (!allowed.includes(value)) throw new Error(`${id}: ${what} desconocido "${value}"`);
  return value;
}

// ---------- supplier A (CSV, latin-1, ';' separated, decimal comma) ----------

function loadA(dataDir) {
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

function loadB(dataDir) {
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

export function buildCatalog(dataDir = DATA_DIR) {
  const groups = new Map();
  for (const rec of [...loadA(dataDir), ...loadB(dataDir)]) {
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

export function loadHistorial(dataDir = DATA_DIR) {
  const [, ...rows] = readFileSync(join(dataDir, 'historial-ventas.csv'), 'utf8').split(/\r?\n/).filter((l) => l.trim());
  return rows.map((l) => {
    const [pedido, fecha, id_origen, cantidad, precio] = l.split(',').map((v) => v.trim());
    return { pedido, fecha, id_origen, cantidad: Number(cantidad), precio: Number(precio) };
  });
}

