// Shop assistant (V0, no LLM): answers only from the catalog and the sales conditions.
// The question is treated as data to look things up, never as instructions, and the user's
// own words are never echoed back, so role-injection attempts have nothing to grab onto.
import { allProducts, getCategory, CATEGORIES } from './catalog.js';

const MAX_CHARS = 1400;
const MAX_PRECIOS = 4;

const precio = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const eur = (n) => precio.format(n);

// From db/data/condiciones-de-venta.md.
const CONDICIONES = [
  { claves: ['envio', 'enviais', 'entrega', 'entregais', 'llega', 'tarda', 'canaria', 'baleare', 'ceuta', 'melilla', 'peninsula', 'transporte', 'porte'],
    texto: 'Envío gratis en pedidos desde 500 €; en pedidos de menos de 500 € el envío cuesta 49 €. Entregamos en 3 a 5 días laborables en la península y en 7 a 10 días laborables en Baleares. No enviamos a Canarias, Ceuta ni Melilla.' },
  { claves: ['montaje', 'montar', 'monta', 'montais', 'instalacion', 'instalar'],
    texto: 'Montaje a domicilio: 39 € por pedido. Es gratis en pedidos desde 1.500 €.' },
  { claves: ['devolucion', 'devolver', 'devuelvo', 'cambio', 'cambiar', 'desisti', 'noche', 'prueba', 'reembolso'],
    texto: 'Tienes 30 días naturales para devolver cualquier producto sin usar. Los colchones tienen 100 noches de prueba: si no te convence, lo recogemos sin coste.' },
  { claves: ['garantia', 'garantizado', 'roto', 'defecto', 'averia'],
    texto: 'Garantía de 3 años en todos los muebles y de 10 años en los colchones.' },
  { claves: ['pago', 'pagar', 'tarjeta', 'bizum', 'transferencia', 'financiacion', 'financiar', 'plazo', 'plazos', 'cuota', 'aplazado', 'paypal'],
    texto: 'Aceptamos tarjeta, Bizum y transferencia bancaria. No ofrecemos financiación ni pago a plazos.' },
];

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const stem = (w) => w.replace(/(es|s)$/, '');
const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

// Generic words that say nothing about WHICH product.
const GENERICAS = new Set(`que cual cuanto cuanta cuesta cuestan vale valen precio precios coste tiene teneis tienes hay
  vendeis venden busco quiero necesito me te se lo la el los las un una unos unas de del al a en y o para por con sin
  mas menos tu su sus mi este esta ese esa es son color tamano medida medidas ancho cm disponible disponibles barato
  barata caro cara economico mejor algun alguna ofreceis ofrece dime decir saber puedo podeis hola gracias favor
  modelo modelos tipo tipos producto productos articulo catalogo tienda devoshop como donde cuando plaza plazas`.split(/\s+/).map(stem));
// Words that show the question is about a product.
const PRODUCTO = new Set(['sofa', 'sillon', 'cama', 'colchon', 'mesa', 'silla', 'escritorio', 'lampara', 'flexo', 'alfombra',
  'cojin', 'manta', 'funda', 'sabana', 'almohada', 'armario', 'aparador', 'estanteria', 'mesilla', 'cajonera', 'protector',
  'reposapie', 'soporte', 'alfombrilla', 'mueble',
  'iluminacion', 'textil', 'almacenaje', 'accesorio', 'decoracion', 'comedor', 'dormitorio', 'salon', 'despacho', 'oficina'].map(stem));
// Price/stock words: they make a question about products only when no sales condition was asked.
const PREGUNTA_PRODUCTO = new Set(['precio', 'cuesta', 'cuestan', 'vale', 'valen', 'teneis', 'vendeis', 'producto', 'catalogo'].map(stem));

const INDICE = allProducts().map((p) => ({
  p,
  nombre: new Set(tokens(p.name).map(stem)),
  todo: new Set(tokens([p.name, p.category, getCategory(p.category)?.name, p.color, p.material, p.seats ? `${p.seats} plazas` : ''].join(' ')).map(stem)),
}));
const VOCAB = new Set(INDICE.flatMap((x) => [...x.todo]));
for (const c of CONDICIONES) for (const k of c.claves) VOCAB.add(stem(k));

function lineaProducto(p) {
  const extra = [p.seats ? `${p.seats} plazas` : null, `${p.width_cm} cm de ancho`, p.color, p.material].filter(Boolean).join(', ');
  return `${p.name}: ${eur(p.price)} (${extra}).`;
}

function recortar(texto) {
  return texto.length <= MAX_CHARS ? texto : `${texto.slice(0, MAX_CHARS - 1).replace(/\s+\S*$/, '')}…`;
}

export function responder(pregunta) {
  const pal = tokens(pregunta).map(stem);
  const partes = [];

  const condiciones = CONDICIONES.filter((c) => c.claves.some((k) => pal.includes(stem(k))));
  for (const c of condiciones) partes.push(c.texto);

  const nombraProducto = pal.some((w) => PRODUCTO.has(w)) || pal.some((w) => INDICE.some((x) => x.nombre.has(w) && !GENERICAS.has(w)));
  const pideProducto = nombraProducto || (!condiciones.length && pal.some((w) => PREGUNTA_PRODUCTO.has(w)));
  if (pideProducto) {
    const desconocidas = pal.filter((w) => w.length > 3 && !GENERICAS.has(w) && !VOCAB.has(w) && !/^\d+$/.test(w));
    const puntos = INDICE.map(({ p, nombre, todo }) => ({
      p, s: pal.reduce((s, w) => s + (GENERICAS.has(w) ? 0 : nombre.has(w) ? 2 : todo.has(w) ? 1 : 0), 0),
    })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.p.price - b.p.price);

    if (desconocidas.length || !puntos.length) {
      partes.push('No tenemos ese producto en nuestro catálogo. Puedo ayudarte con los productos de DevoShop: sofás, camas, colchones, mesas, sillas, escritorios, almacenaje, iluminación, textil y accesorios.');
    } else {
      const mejor = puntos[0].s;
      const top = puntos.filter((x) => x.s === mejor).slice(0, MAX_PRECIOS).map((x) => x.p);
      partes.push(top.length === 1 ? lineaProducto(top[0]) : `Te puede interesar:\n${top.map((p) => `- ${lineaProducto(p)}`).join('\n')}`);
      partes.push('Precios con IVA incluido. Puedes comprar como invitado, sin registro.');
    }
  }

  if (!partes.length) {
    partes.push(`Soy el asistente de la tienda DevoShop y solo puedo ayudarte con nuestros productos (${CATEGORIES.map((c) => c.name.toLowerCase()).join(', ')}) y con las condiciones de venta: envío, montaje, devoluciones, garantía y pago.`);
  }
  // Never more than 4 prices in one answer, whatever the branches above produced.
  let n = 0;
  const texto = partes.join('\n\n').replace(/\d[\d.]*,\d{2}\s?€/g, (m) => (++n <= MAX_PRECIOS ? m : ''));
  return recortar(texto);
}
