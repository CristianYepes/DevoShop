// HTML templates. No inline scripts or style attributes, so the CSP can forbid 'unsafe-inline'.
// Every page has exactly one <h1>, alt text on images and a <label> on every field.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CATEGORIES, getCategory, productImage, featuredProducts, complementsFor, bestSellers, getPacks, allProducts,
} from './catalog.js';

// Cache-busting: the stylesheet URL changes whenever its content changes, so a new deploy
// is never hidden behind the 1-hour browser cache of /static.
const CSS_VERSION = createHash('sha256')
  .update(readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url))))
  .digest('hex').slice(0, 10);

/** condiciones-de-venta.md */
const ENVIO_GRATIS = 500;
const MONTAJE_GRATIS = 1500;

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 'always' so 1698 reads "1.698,00 €" (es-ES skips the separator on 4-digit numbers by default).
const priceFormat = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
export const formatPrice = (n) => priceFormat.format(n);

function header(activeCategory, query = '', cartCount = 0) {
  const current = (key) => (key === activeCategory ? ' aria-current="page"' : '');
  const links = `<li><a class="nav-highlight" href="/ofertas"${current('ofertas')}>Ofertas</a></li>`
    + `<li><a class="nav-highlight" href="/mas-vendidos"${current('mas-vendidos')}>Más vendidos</a></li>`
    + `<li><a class="nav-highlight" href="/packs"${current('packs')}>Packs</a></li>`
    + CATEGORIES.map((c) => `<li><a href="/categoria/${c.slug}"${current(c.slug)}>${c.name}</a></li>`).join('');
  return `<header class="site-header">
<div class="header-bar container">
<a class="brand" href="/">DevoShop</a>
<form class="search" action="/buscar" method="get" role="search">
<label for="q" class="sr-only">Buscar productos</label>
<input id="q" name="q" type="search" value="${escapeHtml(query)}" placeholder="Buscar sofás, mesas, lámparas…">
<button type="submit">Buscar</button>
</form>
<a class="cart-link" href="/carrito" aria-label="${cartLabel(cartCount)}" title="${cartLabel(cartCount)}"><span aria-hidden="true">🛒</span>${cartCount ? `<span class="cart-count" aria-hidden="true">${cartCount}</span>` : ''}</a>
</div>
<nav class="cat-nav" aria-label="Categorías"><ul class="container">${links}</ul></nav>
</header>`;
}

const cartLabel = (n) => (n ? `Carrito, ${n} ${n === 1 ? 'producto' : 'productos'}` : 'Carrito');

const footer = `<footer class="site-footer">
<div class="container footer-grid">
<div><p class="footer-brand">DevoShop</p><p>Muebles de diseño para vivir mejor. Compra como invitado, sin registro.</p></div>
<div><p class="footer-title">Comprar</p><ul>${CATEGORIES.slice(0, 4).map((c) => `<li><a href="/categoria/${c.slug}">${c.name}</a></li>`).join('')}</ul></div>
<div><p class="footer-title">Complementos</p><ul>${CATEGORIES.slice(4).map((c) => `<li><a href="/categoria/${c.slug}">${c.name}</a></li>`).join('')}</ul></div>
<div><p class="footer-title">Ayuda</p><ul><li><a href="/carrito">Tu carrito</a></li><li>Envío gratis desde 500 €</li><li>Precios con IVA incluido</li><li>Pago simulado, sin tarjeta</li></ul></div>
</div>
<p class="container footer-legal">© 2026 DevoShop · Tienda creada en el hackathon Devo Team</p>
</footer>`;

export function layout({ title, description, body, activeCategory, query, cartCount = 0 }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="stylesheet" href="/static/styles.css?v=${CSS_VERSION}">
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
</head>
<body>
${header(activeCategory, query, cartCount)}
<main>
${body}
</main>
${footer}
</body>
</html>`;
}

// No reference ("before") prices: the supplier data has none, and an invented one is a fake discount.
const priceHtml = (p, cls = 'card-price') => `<span class="${cls}">${formatPrice(p.price)}</span>`;

function productCard(p) {
  return `<li class="card">
<a href="/producto/${encodeURIComponent(p.sku)}">
<span class="card-media"><img src="${productImage(p)}" alt="${escapeHtml(p.name)}" width="400" height="300" loading="lazy">${p.price >= ENVIO_GRATIS ? '<span class="badge badge-ok">Envío gratis</span>' : ''}</span>
<span class="card-name">${escapeHtml(p.name)}</span>
<span class="card-meta">${escapeHtml(getCategory(p.category)?.name ?? '')} · ${p.width_cm} cm${p.seats ? ` · ${p.seats} ${p.seats === 1 ? 'plaza' : 'plazas'}` : ''} · ${escapeHtml(p.color)} · ${escapeHtml(p.material)}</span>
${priceHtml(p)}
</a>
</li>`;
}

const productGrid = (products) => `<ul class="grid">${products.map(productCard).join('')}</ul>`;

function packCard(pack) {
  const list = pack.lines.map((l) => `<li><span>${l.quantity > 1 ? `${l.quantity} × ` : ''}<a href="/producto/${encodeURIComponent(l.product.sku)}">${escapeHtml(l.product.name)}</a></span><span>${formatPrice(Math.round(l.product.price * 100) * l.quantity / 100)}</span></li>`).join('');
  const units = pack.lines.reduce((s, l) => s + l.quantity, 0);
  const perk = pack.total >= MONTAJE_GRATIS ? ' · envío y montaje gratis' : pack.total >= ENVIO_GRATIS ? ' · envío gratis' : '';
  return `<li class="pack">
<img src="/static/img/${pack.img}.svg" alt="${escapeHtml(pack.name)}" width="400" height="300" loading="lazy">
<div class="pack-body">
<h3>${escapeHtml(pack.name)}</h3>
<p class="muted">${escapeHtml(pack.description)}</p>
<ul class="pack-items">${list}</ul>
<p class="pack-total">${formatPrice(pack.total)} <span class="muted">${units} productos a su precio de catálogo · IVA incluido${perk}</span></p>
<form action="/carrito/anadir-pack" method="post">
<input type="hidden" name="pack" value="${escapeHtml(pack.id)}">
<button class="btn btn-block" type="submit">Añadir el ${escapeHtml(pack.name)} al carrito, ${formatPrice(pack.total)}</button>
</form>
</div>
</li>`;
}

const packGrid = (packs) => `<ul class="packs">${packs.map(packCard).join('')}</ul>`;

export function renderHome(o = {}) {
  const tiles = CATEGORIES.map((c) => `<li><a class="tile" href="/categoria/${c.slug}">
<img src="/static/img/${c.img}.svg" alt="${c.name}" width="400" height="300" loading="lazy"><span>${c.name}</span></a></li>`).join('');
  return layout({
    title: 'DevoShop | Muebles de diseño y decoración para tu hogar',
    description: 'Sofás, mesas, camas, iluminación y textil de diseño. Compra como invitado, sin registro y con precios con IVA incluido.',
    cartCount: o.cartCount,
    body: `<section class="hero">
<img class="hero-img" src="/static/img/hero.svg" alt="Salón con sofá gris, lámpara de pie y alfombra" width="1600" height="800">
<div class="hero-text container">
<p class="eyebrow">Envío gratis desde 500 €</p>
<h1>Muebles de diseño para vivir mejor</h1>
<p>Piezas atemporales para el salón, el comedor y el dormitorio. Compra como invitado en pocos pasos.</p>
<a class="btn" href="/categoria/sofa">Ver sofás</a>
</div>
</section>
<ul class="usp container">
<li><strong>Sin registro</strong> Compra como invitado</li>
<li><strong>Precios claros</strong> IVA incluido en todo</li>
<li><strong>Envío gratis</strong> En pedidos desde 500 €</li>
<li><strong>Montaje gratis</strong> En pedidos desde 1.500 €</li>
</ul>
<section class="container section">
<h2 class="section-title">Compra por categoría</h2>
<ul class="tiles">${tiles}</ul>
</section>
<section class="container section">
<div class="section-head"><h2 class="section-title">Más vendidos</h2><a href="/mas-vendidos">Ver los más vendidos</a></div>
${productGrid(bestSellers(4))}
</section>
<section class="container section">
<div class="section-head"><h2 class="section-title">Packs para amueblar de una vez</h2><a href="/packs">Ver todos los packs</a></div>
${packGrid(getPacks())}
</section>
<section class="container section">
<h2 class="section-title">Destacados</h2>
${productGrid(featuredProducts())}
</section>
<section class="container section editorial">
<div>
<h2>Crea un salón completo</h2>
<p>Un buen sofá pide una lámpara de lectura, una alfombra cálida y un par de cojines. Combínalos y deja tu espacio listo de una vez.</p>
<a class="btn btn-outline" href="/categoria/iluminacion">Ver iluminación</a>
</div>
<img src="/static/img/lamp.svg" alt="Lámpara de pie junto a un sofá" width="400" height="300" loading="lazy">
</section>`,
  });
}

export function renderCategory(category, products, o = {}) {
  return layout({
    cartCount: o.cartCount,
    title: `${category.name} de diseño | DevoShop`,
    description: `Descubre nuestra selección de ${category.name.toLowerCase()} de diseño con precios con IVA incluido. Compra como invitado.`,
    activeCategory: category.slug,
    body: `<div class="container section">
<nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> / <span>${category.name}</span></nav>
<h1 class="page-title">${category.name}</h1>
<p class="muted">${products.length} ${products.length === 1 ? 'producto' : 'productos'}</p>
${products.length ? productGrid(products) : '<p>No hay productos en esta categoría ahora mismo.</p>'}
</div>`,
  });
}

export function renderBestSellers(o = {}) {
  const top = bestSellers(12);
  return layout({
    cartCount: o.cartCount,
    title: 'Los muebles más vendidos | DevoShop',
    description: 'Los sofás, camas, mesas, lámparas y textiles que más compran nuestros clientes. Precios con IVA incluido.',
    activeCategory: 'mas-vendidos',
    body: `<div class="container section">
<nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> / <span>Más vendidos</span></nav>
<h1 class="page-title">Más vendidos</h1>
<p class="muted">Los ${top.length} productos que más unidades han vendido. Precios con IVA incluido.</p>
${productGrid(top)}
</div>`,
  });
}

/** Real offers from condiciones-de-venta.md: free shipping from 500 €, free assembly from 1.500 €. */
export function renderOffers(o = {}) {
  const freeShipping = allProducts().filter((p) => p.price >= ENVIO_GRATIS).sort((a, b) => b.price - a.price);
  return layout({
    title: 'Ofertas: envío y montaje gratis | DevoShop',
    description: 'Envío gratis en pedidos desde 500 € y montaje gratis desde 1.500 €. Precios con IVA incluido y compra como invitado.',
    activeCategory: 'ofertas',
    cartCount: o.cartCount,
    body: `<div class="container section">
<nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> / <span>Ofertas</span></nav>
<h1 class="page-title">Ofertas</h1>
<ul class="offer-banner">
<li><strong>Envío gratis</strong> en pedidos desde 500 € (si no, 49 €).</li>
<li><strong>Montaje gratis</strong> en pedidos desde 1.500 € (si no, 39 €).</li>
</ul>
<h2 class="section-title">Packs con envío gratis</h2>
${packGrid(getPacks())}
<h2 class="section-title section-gap">Productos con envío gratis</h2>
${productGrid(freeShipping)}
</div>`,
  });
}

export function renderPacks(o = {}) {
  return layout({
    cartCount: o.cartCount,
    title: 'Packs para amueblar tu casa | DevoShop',
    description: 'Packs de salón, dormitorio y comedor con todo lo necesario. Añade el pack entero al carrito de una vez.',
    activeCategory: 'packs',
    body: `<div class="container section">
<nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> / <span>Packs</span></nav>
<h1 class="page-title">Packs</h1>
<p class="muted">Habitaciones completas, pensadas para combinar. Un clic y tienes todo en el carrito.</p>
${packGrid(getPacks())}
</div>`,
  });
}

export function renderSearch(query, products, o = {}) {
  const q = escapeHtml(query);
  return layout({
    cartCount: o.cartCount,
    title: query ? `Resultados para «${query}» | DevoShop` : 'Buscar productos | DevoShop tienda de muebles',
    description: 'Busca sofás, mesas, camas, lámparas y textil en el catálogo de DevoShop.',
    query,
    body: `<div class="container section">
<h1 class="page-title">${query ? `Resultados para «${q}»` : 'Buscar productos'}</h1>
${products.length
    ? `<p class="muted">${products.length} ${products.length === 1 ? 'producto' : 'productos'}</p>${productGrid(products)}`
    : `<p>${query ? 'No hemos encontrado productos con esa búsqueda.' : 'Escribe qué buscas en el buscador.'} Prueba con una categoría:</p>
<ul class="chips">${CATEGORIES.map((c) => `<li><a href="/categoria/${c.slug}">${c.name}</a></li>`).join('')}</ul>`}
</div>`,
  });
}

export function renderProduct(p, o = {}) {
  const category = getCategory(p.category);
  const isMattress = p.category === 'colchon';
  const specs = [
    ['Precio', `${formatPrice(p.price)} (IVA incluido)`],
    ['Medidas', `${p.width_cm} x ${p.depth_cm} x ${p.height_cm} cm (ancho x fondo x alto)`],
    p.seats ? ['Plazas', p.seats] : null,
    ['Color', p.color],
    ['Material', p.material],
    ['Entrega', 'De 3 a 5 días laborables en la península; de 7 a 10 en Baleares. No enviamos a Canarias, Ceuta ni Melilla.'],
    ['Envío', 'Gratis en pedidos desde 500 €; si no, 49 €.'],
    ['Montaje', 'A domicilio por 39 € por pedido; gratis desde 1.500 €.'],
    ['Garantía', isMattress ? '10 años' : '3 años'],
    ['Devoluciones', isMattress ? '100 noches de prueba: si no te convence, lo recogemos sin coste.' : '30 días naturales para devolver cualquier producto sin usar.'],
    ['Referencia', p.sku],
  ].filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('');
  const options = [1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}</option>`).join('');
  const complements = complementsFor(p);
  return layout({
    title: `${p.name} | DevoShop`,
    description: `${p.name}: ${p.description}`.slice(0, 160),
    activeCategory: p.category,
    cartCount: o.cartCount,
    body: `<div class="container section">
<nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> / <a href="/categoria/${category.slug}">${category.name}</a> / <span>${escapeHtml(p.name)}</span></nav>
<div class="product">
<img class="product-img" src="${productImage(p)}" alt="${escapeHtml(p.name)}" width="800" height="600">
<div class="product-info">
<h1 class="product-name">${escapeHtml(p.name)}</h1>
<p class="product-price">${formatPrice(p.price)} <span class="muted">IVA incluido</span></p>
<form class="buy" action="/carrito/anadir" method="post">
<input type="hidden" name="sku" value="${escapeHtml(p.sku)}">
<label for="cantidad">Cantidad</label>
<select id="cantidad" name="cantidad">${options}</select>
<button class="btn btn-block" type="submit">Añadir al carrito, ${formatPrice(p.price)}</button>
</form>
<p class="ship-note">${p.price >= ENVIO_GRATIS ? '✓ Este producto tiene envío gratis.' : 'Envío gratis en pedidos desde 500 €.'} Montaje gratis desde 1.500 €.</p>
${complementForms(complements)}
<p>${escapeHtml(p.description)}</p>
<dl class="specs">${specs}</dl>
</div>
</div>
</div>
<ul class="usp container">
<li><strong>Envío gratis</strong> En pedidos desde 500 €</li>
<li><strong>Montaje gratis</strong> En pedidos desde 1.500 €</li>
<li><strong>Garantía</strong> 3 años en muebles, 10 en colchones</li>
<li><strong>Devolución</strong> 30 días</li>
</ul>`,
  });
}

/** Cross-sell right under the add-to-cart button: one-click add, with the real share from the sales history. */
function complementForms(items, heading = 'Se compra junto con') {
  if (!items.length) return '';
  const li = items.map((c) => `<li class="complement">
<img src="${productImage(c)}" alt="${escapeHtml(c.name)}" width="80" height="60" loading="lazy">
<span><a href="/producto/${encodeURIComponent(c.sku)}">${escapeHtml(c.name)}</a> · ${formatPrice(c.price)}${c.share ? ` <span class="muted">(${c.share} % de los clientes lo añaden)</span>` : ''}</span>
<form action="/carrito/anadir" method="post"><input type="hidden" name="sku" value="${escapeHtml(c.sku)}"><input type="hidden" name="cantidad" value="1"><button class="btn btn-outline" type="submit">Añadir ${escapeHtml(c.name)}, ${formatPrice(c.price)}</button></form>
</li>`).join('');
  return `<section class="complements" aria-label="${heading}"><h2 class="section-title">${heading}</h2><ul class="complement-list">${li}</ul></section>`;
}

function cartLines(r, editable) {
  return `<ul class="cart-lines">${r.items.map((l) => `<li class="cart-line" data-linea="${escapeHtml(l.product.sku)}" data-cantidad="${l.quantity}">
<img src="${productImage(l.product)}" alt="${escapeHtml(l.product.name)}" width="80" height="60" loading="lazy">
<span class="cart-name"><a href="/producto/${encodeURIComponent(l.product.sku)}">${escapeHtml(l.product.name)}</a><br><span class="muted">${l.quantity} × ${formatPrice(l.product.price)}</span></span>
<strong>${formatPrice(Math.round(l.product.price * 100) * l.quantity / 100)}</strong>
${editable ? `<form action="/carrito/cantidad" method="post" class="qty"><input type="hidden" name="sku" value="${escapeHtml(l.product.sku)}">
<label for="q-${escapeHtml(l.product.sku)}">Cantidad de ${escapeHtml(l.product.name)}</label>
<select id="q-${escapeHtml(l.product.sku)}" name="cantidad" data-autosubmit>${Array.from({ length: 20 }, (_, i) => `<option value="${i + 1}"${i + 1 === l.quantity ? ' selected' : ''}>${i + 1}</option>`).join('')}</select>
<noscript><button type="submit">Actualizar</button></noscript></form>
<form action="/carrito/cantidad" method="post"><input type="hidden" name="sku" value="${escapeHtml(l.product.sku)}"><input type="hidden" name="cantidad" value="0"><button type="submit">Quitar ${escapeHtml(l.product.name)}</button></form>` : ''}
</li>`).join('')}</ul>
<p class="cart-total">Total: <strong>${formatPrice(r.total)}</strong> <span class="muted">IVA incluido</span></p>`;
}

function perks(total) {
  const out = [];
  out.push(total >= ENVIO_GRATIS ? 'Tu pedido tiene envío gratis.' : `Envío: 49 €. Gratis a partir de ${formatPrice(ENVIO_GRATIS)} (te faltan ${formatPrice((Math.round(ENVIO_GRATIS * 100) - Math.round(total * 100)) / 100)}).`);
  out.push(total >= MONTAJE_GRATIS ? 'Tu pedido tiene montaje a domicilio gratis.' : `Montaje a domicilio gratis a partir de ${formatPrice(MONTAJE_GRATIS)} (te faltan ${formatPrice((Math.round(MONTAJE_GRATIS * 100) - Math.round(total * 100)) / 100)}).`);
  return `<ul class="perks">${out.map((t) => `<li>${t}</li>`).join('')}</ul>`;
}

/** The agent's budget: a suggestion that pushes the order over it would zero the spend score. */
const PRESUPUESTO_MAX = 4000;

/**
 * Cross-sell for the whole cart: complements of every line (most expensive first), never
 * already in the cart and never taking the total over 4.000 €.
 */
function cartComplements(r, limit = 3) {
  const inCart = new Set(r.items.map((l) => l.product.sku));
  const totalCents = Math.round(r.total * 100);
  const out = [];
  for (const line of [...r.items].sort((a, b) => b.product.price - a.product.price)) {
    for (const c of complementsFor(line.product, 6)) {
      if (inCart.has(c.sku) || out.some((x) => x.sku === c.sku)) continue;
      if (totalCents + Math.round(c.price * 100) > PRESUPUESTO_MAX * 100) continue;
      out.push(c);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function renderCart(r, o = {}) {
  const cross = r.items.length ? cartComplements(r) : [];
  return layout({
    cartCount: o.cartCount,
    title: 'Tu carrito de compra | DevoShop',
    description: 'Revisa los productos de tu carrito y finaliza la compra como invitado, sin registro.',
    body: `<div class="container section">
${o.added ? `<p class="notice" role="status">✓ Añadido al carrito: ${escapeHtml(o.added)}</p>` : ''}
<h1 class="page-title">Tu carrito</h1>
${r.items.length ? `<div class="cart-top"><p><strong>Total: ${formatPrice(r.total)}</strong> · ${r.unidades} ${r.unidades === 1 ? 'producto' : 'productos'}</p><a class="btn btn-block" href="/checkout">Finalizar compra como invitado</a></div>
${cartLines(r, true)}
${perks(r.total)}
<p><a class="btn btn-block" href="/checkout">Finalizar compra como invitado</a></p>
${complementForms(cross, 'Completa tu pedido')}
<script src="/static/carrito.js" defer></script>`
    : '<p>Tu carrito está vacío.</p><p><a class="btn" href="/">Seguir comprando</a></p>'}
</div>`,
  });
}

const field = (id, label, type, value, error, autocomplete) => `<p class="field">
<label for="${id}">${label}</label>
<input id="${id}" name="${id}" type="${type}" value="${escapeHtml(value ?? '')}" autocomplete="${autocomplete}" required${error ? ` aria-invalid="true" aria-describedby="${id}-error"` : ''}>
${error ? `<span class="field-error" id="${id}-error">${escapeHtml(error)}</span>` : ''}
</p>`;

export function renderCheckout(r, orderId, form, errores, aviso = '', o = {}) {
  return layout({
    cartCount: o.cartCount,
    title: 'Finalizar compra como invitado | DevoShop',
    description: 'Escribe tus datos de envío y confirma el pedido. Pago simulado, sin datos de tarjeta.',
    body: `<div class="container section">
<h1 class="page-title">Finalizar compra</h1>
${aviso ? `<p class="alert" role="alert">${aviso}</p>` : ''}
${cartLines(r, false)}
${perks(r.total)}
<form class="checkout" action="/checkout" method="post">
<input type="hidden" name="order_id" value="${escapeHtml(orderId)}">
${field('nombre', 'Nombre y apellidos', 'text', form.nombre, errores.nombre, 'name')}
${field('email', 'Email', 'email', form.email, errores.email, 'email')}
${field('direccion', 'Dirección de envío', 'text', form.direccion, errores.direccion, 'street-address')}
<p class="muted">Pago simulado: no se piden datos de tarjeta. Al pulsar el botón, el pedido queda confirmado.</p>
<button class="btn btn-block" type="submit">Pagar ${formatPrice(r.total)} (pago simulado)</button>
</form>
</div>`,
  });
}

export const renderOrderError = (r, orderId, form) =>
  renderCheckout(r, orderId, form, {}, 'No hemos podido registrar el pedido. Tus datos siguen aquí: pulsa «Pagar» otra vez para reintentarlo.');

export function renderEmptyCheckout() {
  return layout({
    title: 'Finalizar compra como invitado | DevoShop',
    description: 'Tu carrito está vacío. Añade productos para finalizar la compra como invitado.',
    body: `<div class="container section"><h1 class="page-title">Finalizar compra</h1>
<p>Tu carrito está vacío.</p><p><a class="btn" href="/">Seguir comprando</a></p></div>`,
  });
}

export function renderConfirmation(recibo) {
  return layout({
    title: 'Pedido confirmado | DevoShop tienda de muebles',
    description: 'Tu pedido en DevoShop está confirmado. Gracias por tu compra.',
    body: `<div class="container section">
<h1 class="page-title">Pedido confirmado</h1>
<p>Gracias, ${escapeHtml(recibo.name)}. Tu número de pedido es <strong>${escapeHtml(recibo.id)}</strong>.</p>
<ul class="cart-lines">${recibo.items.map((i) => `<li class="cart-line"><span class="cart-name">${escapeHtml(i.name)}<br><span class="muted">${i.quantity} × ${formatPrice(i.unit_price)}</span></span></li>`).join('')}</ul>
<p class="cart-total">Total pagado: <strong>${formatPrice(recibo.total)}</strong> <span class="muted">IVA incluido</span></p>
<p><a class="btn" href="/">Volver a la tienda</a></p>
</div>`,
  });
}

const ERROR_TEXT = {
  400: 'Petición no válida',
  404: 'Página no encontrada',
  405: 'Método no permitido',
  413: 'Petición demasiado grande',
  500: 'Error interno',
};

export function renderError(status) {
  const text = ERROR_TEXT[status] ?? 'Error';
  return layout({
    title: `${text} | DevoShop tienda online`,
    description: 'La página que buscas no está disponible. Vuelve a la portada de DevoShop.',
    body: `<div class="container section"><h1 class="page-title">${text}</h1><p><a href="/">Volver a la portada</a></p></div>`,
  });
}
