// HTML templates. No inline scripts or style attributes, so the CSP can forbid 'unsafe-inline'.
// Every page has exactly one <h1>, alt text on images and a <label> on every field.
// Every form works without JavaScript (POST -> 303 -> GET).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CATEGORIES, getCategory, productImage, featuredProducts, complementsFor, offerProducts, getPacks, pretty,
  FREE_SHIPPING_FROM, FREE_ASSEMBLY_FROM,
} from './catalog.js';

// Cache-busting: the stylesheet URL changes whenever its content changes, so a new deploy
// is never hidden behind the 1-hour browser cache of /static.
const CSS_VERSION = createHash('sha256')
  .update(readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url))))
  .digest('hex').slice(0, 10);

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const priceFormat = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
// Intl drops the thousands dot for 4-digit numbers in es-ES ("1590,00 €"); add it back.
export const formatPrice = (n) => priceFormat.format(n).replace(/^(\d)(\d{3}),/, '$1.$2,');

/** Max total the agent can spend: suggestions never push the cart above it. */
export const BUDGET_CAP = 4000;

const CONDITIONS = {
  entrega: 'De 3 a 5 días laborables en la península; de 7 a 10 en Baleares. No enviamos a Canarias, Ceuta ni Melilla.',
  envio: `Gratis desde ${formatPrice(FREE_SHIPPING_FROM)}; si no, 49,00 €.`,
  montaje: `A domicilio por 39,00 € por pedido; gratis desde ${formatPrice(FREE_ASSEMBLY_FROM)}.`,
  devoluciones: '30 días naturales para devolver cualquier producto sin usar.',
};

function header(activeCategory, query = '', cartCount = 0) {
  const current = (key) => (key === activeCategory ? ' aria-current="page"' : '');
  const links = `<li><a class="nav-highlight" href="/ofertas"${current('ofertas')}>Ofertas</a></li>`
    + `<li><a class="nav-highlight" href="/packs"${current('packs')}>Packs</a></li>`
    + CATEGORIES.map((c) => `<li><a href="/categoria/${c.slug}"${current(c.slug)}>${c.name}</a></li>`).join('');
  const label = cartCount ? `Carrito, ${cartCount} ${cartCount === 1 ? 'producto' : 'productos'}` : 'Carrito';
  return `<header class="site-header">
<div class="header-bar container">
<a class="brand" href="/">DevoShop</a>
<form class="search" action="/buscar" method="get" role="search">
<label for="q" class="sr-only">Buscar productos</label>
<input id="q" name="q" type="search" value="${escapeHtml(query)}" placeholder="Buscar sofás, mesas, lámparas…">
<button type="submit">Buscar</button>
</form>
<a class="cart-link" href="/carrito" aria-label="${label}" title="${label}"><span aria-hidden="true">🛒</span>${cartCount ? `<span class="cart-count" aria-hidden="true">${cartCount}</span>` : ''}</a>
</div>
<nav class="cat-nav" aria-label="Categorías"><ul class="container">${links}</ul></nav>
</header>`;
}

const half = Math.ceil(CATEGORIES.length / 2);
const footer = `<footer class="site-footer">
<div class="container footer-grid">
<div><p class="footer-brand">DevoShop</p><p>Muebles de diseño para vivir mejor. Compra como invitado, sin registro.</p></div>
<div><p class="footer-title">Comprar</p><ul>${CATEGORIES.slice(0, half).map((c) => `<li><a href="/categoria/${c.slug}">${c.name}</a></li>`).join('')}</ul></div>
<div><p class="footer-title">Complementos</p><ul>${CATEGORIES.slice(half).map((c) => `<li><a href="/categoria/${c.slug}">${c.name}</a></li>`).join('')}</ul></div>
<div><p class="footer-title">Ayuda</p><ul><li><a href="/carrito">Tu carrito</a></li><li>Envío gratis desde 500 €</li><li>Garantía de 3 años</li><li>Pago simulado, sin tarjeta</li></ul></div>
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

const specLine = (p) => [getCategory(p.category)?.name, p.seats ? `${p.seats} ${p.seats === 1 ? 'plaza' : 'plazas'}` : null,
  `${p.width_cm} cm de ancho`, pretty(p.color), pretty(p.material)].filter(Boolean).join(' · ');

function productCard(p) {
  return `<li class="card">
<a href="/producto/${encodeURIComponent(p.sku)}">
<span class="card-media"><img src="${productImage(p)}" alt="${escapeHtml(p.name)}" width="400" height="300" loading="lazy">${p.price >= FREE_SHIPPING_FROM ? '<span class="badge badge-ok">Envío gratis</span>' : ''}</span>
<span class="card-name">${escapeHtml(p.name)}</span>
<span class="card-meta">${escapeHtml(specLine(p))}</span>
<span class="card-price">${formatPrice(p.price)}</span>
</a>
</li>`;
}

const productGrid = (products) => `<ul class="grid">${products.map(productCard).join('')}</ul>`;

function packCard(pack) {
  const list = pack.lines.map((l) => `<li><span>${l.quantity > 1 ? `${l.quantity} × ` : ''}<a href="/producto/${l.product.sku}">${escapeHtml(l.product.name)}</a></span><span>${formatPrice(l.product.price * l.quantity)}</span></li>`).join('');
  return `<li class="pack">
<img src="/static/img/${pack.img}.svg" alt="${escapeHtml(pack.name)}" width="400" height="300" loading="lazy">
<div class="pack-body">
<h3>${escapeHtml(pack.name)}</h3>
<p class="muted">${escapeHtml(pack.description)}</p>
<ul class="pack-items">${list}</ul>
<p class="pack-total">${formatPrice(pack.total)} <span class="muted">${pack.lines.reduce((s, l) => s + l.quantity, 0)} productos a su precio de catálogo · IVA incluido${pack.total >= FREE_ASSEMBLY_FROM ? ' · envío y montaje gratis' : pack.total >= FREE_SHIPPING_FROM ? ' · envío gratis' : ''}</span></p>
<form action="/carrito/anadir-pack" method="post">
<input type="hidden" name="pack" value="${escapeHtml(pack.id)}">
<button class="btn btn-block" type="submit">Añadir el ${escapeHtml(pack.name)} al carrito, ${formatPrice(pack.total)}</button>
</form>
</div>
</li>`;
}

const packGrid = (packs) => `<ul class="packs">${packs.map(packCard).join('')}</ul>`;

/** One-click complement: picture, full name, reason, price and a button that names it. */
function complementCard({ product: p, pct }, reasonFor) {
  const reason = pct ? `Lo compra el ${pct} % de quienes compran ${escapeHtml(reasonFor)}.` : 'Combina con lo que estás comprando.';
  return `<li class="complement">
<a href="/producto/${encodeURIComponent(p.sku)}"><img src="${productImage(p)}" alt="${escapeHtml(p.name)}" width="120" height="90" loading="lazy"></a>
<div class="complement-body">
<a class="complement-name" href="/producto/${encodeURIComponent(p.sku)}">${escapeHtml(p.name)}</a>
<p class="muted">${reason}</p>
<p class="complement-price">${formatPrice(p.price)}</p>
</div>
<form action="/carrito/anadir" method="post">
<input type="hidden" name="sku" value="${escapeHtml(p.sku)}">
<button class="btn btn-small btn-outline" type="submit">Añadir ${escapeHtml(p.name)}, ${formatPrice(p.price)}</button>
</form>
</li>`;
}

export function renderHome({ cartCount } = {}) {
  const tiles = CATEGORIES.map((c) => `<li><a class="tile" href="/categoria/${c.slug}">
<img src="/static/img/${c.img}.svg" alt="${c.name}" width="400" height="300" loading="lazy"><span>${c.name}</span></a></li>`).join('');
  return layout({
    title: 'DevoShop | Muebles de diseño y decoración para tu hogar',
    description: 'Sofás, mesas, camas, iluminación y textil de diseño. Compra como invitado, sin registro y con precios con IVA incluido.',
    cartCount,
    body: `<section class="hero">
<img class="hero-img" src="/static/img/hero.svg" alt="Salón con sofá gris, lámpara de pie y alfombra" width="1600" height="800">
<div class="hero-text container">
<p class="eyebrow">Envío gratis desde 500 €</p>
<h1>Muebles de diseño para vivir mejor</h1>
<p>Sofás, camas, mesas y todo lo que los completa. Compra como invitado en pocos pasos y con 3 años de garantía.</p>
<a class="btn" href="/categoria/sofa">Ver sofás</a>
</div>
</section>
<ul class="usp container">
<li><strong>Envío gratis</strong> En pedidos desde 500 €</li>
<li><strong>Montaje gratis</strong> En pedidos desde 1.500 €</li>
<li><strong>Sin registro</strong> Compra como invitado, pago simulado</li>
</ul>
<section class="container section">
<h2 class="section-title">Compra por categoría</h2>
<ul class="tiles">${tiles}</ul>
</section>
<section class="container section">
<div class="section-head"><h2 class="section-title">Packs para amueblar de una vez</h2><a href="/packs">Ver todos los packs</a></div>
${packGrid(getPacks().slice(0, 3))}
</section>
<section class="container section">
<div class="section-head"><h2 class="section-title">Ofertas: envío gratis</h2><a href="/ofertas">Ver todas las ofertas</a></div>
${productGrid(offerProducts().slice(0, 4))}
</section>
<section class="container section">
<h2 class="section-title">Destacados</h2>
${productGrid(featuredProducts())}
</section>`,
  });
}

export function renderCategory(category, products, { cartCount } = {}) {
  return layout({
    title: `${category.name} de diseño | DevoShop`,
    description: `Descubre nuestra selección de ${category.name.toLowerCase()} de diseño con precios con IVA incluido. Compra como invitado.`,
    activeCategory: category.slug,
    cartCount,
    body: `<div class="container section">
<nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> / <span>${category.name}</span></nav>
<h1 class="page-title">${category.name}</h1>
<p class="muted">${products.length} ${products.length === 1 ? 'producto' : 'productos'} · precios con IVA incluido</p>
${products.length ? productGrid(products) : '<p>No hay productos en esta categoría ahora mismo.</p>'}
</div>`,
  });
}

export function renderOffers({ cartCount } = {}) {
  const offers = offerProducts();
  return layout({
    title: 'Ofertas: envío y montaje gratis | DevoShop',
    description: 'Envío gratis en pedidos desde 500 € y montaje gratis desde 1.500 €. Precios con IVA incluido y compra como invitado.',
    activeCategory: 'ofertas',
    cartCount,
    body: `<div class="container section">
<nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> / <span>Ofertas</span></nav>
<h1 class="page-title">Ofertas</h1>
<ul class="offer-banner">
<li><strong>Envío gratis</strong> en pedidos desde 500 € (si no, 49 €).</li>
<li><strong>Montaje gratis</strong> en pedidos desde 1.500 € (si no, 39 €).</li>
</ul>
<h2 class="section-title">Packs con envío y montaje gratis</h2>
${packGrid(getPacks())}
<h2 class="section-title section-gap">Productos con envío gratis</h2>
${productGrid(offers)}
</div>`,
  });
}

export function renderPacks({ cartCount } = {}) {
  return layout({
    title: 'Packs para amueblar tu casa | DevoShop',
    description: 'Packs de salón, dormitorio, comedor y teletrabajo con todo lo necesario. Añade el pack entero al carrito de una vez.',
    activeCategory: 'packs',
    cartCount,
    body: `<div class="container section">
<nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> / <span>Packs</span></nav>
<h1 class="page-title">Packs</h1>
<p class="muted">Habitaciones completas, pensadas para combinar. Cada pack suma los productos a su precio de catálogo, y con un clic los tienes todos en el carrito.</p>
${packGrid(getPacks())}
</div>`,
  });
}

export function renderSearch(query, products, { cartCount } = {}) {
  const q = escapeHtml(query);
  return layout({
    title: query ? `Resultados para «${query}» | DevoShop` : 'Buscar productos | DevoShop tienda de muebles',
    description: 'Busca sofás, mesas, camas, lámparas y textil en el catálogo de DevoShop.',
    query,
    cartCount,
    body: `<div class="container section">
<h1 class="page-title">${query ? `Resultados para «${q}»` : 'Buscar productos'}</h1>
${products.length
    ? `<p class="muted">${products.length} ${products.length === 1 ? 'producto' : 'productos'}, los que más se parecen primero</p>${productGrid(products)}`
    : `<p>${query ? 'No hemos encontrado productos con esa búsqueda.' : 'Escribe qué buscas en el buscador.'} Prueba con una categoría:</p>
<ul class="chips">${CATEGORIES.map((c) => `<li><a href="/categoria/${c.slug}">${c.name}</a></li>`).join('')}</ul>`}
</div>`,
  });
}

export function renderProduct(p, { cartCount } = {}) {
  const category = getCategory(p.category);
  const isMattress = p.category === 'colchon';
  const specs = [
    ['Precio', `${formatPrice(p.price)} (IVA incluido)`],
    ['Medidas', `${p.width_cm} × ${p.depth_cm} × ${p.height_cm} cm (ancho × fondo × alto)`],
    p.seats ? ['Plazas', p.seats] : null,
    ['Color', pretty(p.color)],
    ['Material', pretty(p.material)],
    ['Entrega', CONDITIONS.entrega],
    ['Envío', CONDITIONS.envio],
    ['Montaje', CONDITIONS.montaje],
    ['Garantía', isMattress ? '10 años' : '3 años'],
    ['Devoluciones', isMattress ? '100 noches de prueba: si no te convence, lo recogemos sin coste.' : CONDITIONS.devoluciones],
    ['Referencia', p.sku],
  ].filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('');
  const options = Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  const complements = complementsFor(p, 4);
  return layout({
    title: `${p.name} | DevoShop`,
    description: `${p.name}: ${p.description}`.slice(0, 160),
    activeCategory: p.category,
    cartCount,
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
<p class="ship-note">${p.price >= FREE_SHIPPING_FROM ? '✓ Este producto tiene envío gratis.' : `Envío gratis en pedidos desde ${formatPrice(FREE_SHIPPING_FROM)}.`} Montaje gratis desde ${formatPrice(FREE_ASSEMBLY_FROM)}.</p>
${complements.length ? `<section class="complements" aria-labelledby="junto">
<h2 id="junto" class="complements-title">Se compra junto con este producto</h2>
<ul>${complements.map((c) => complementCard(c, p.name)).join('')}</ul>
</section>` : ''}
<p>${escapeHtml(p.description)}</p>
<dl class="specs">${specs}</dl>
</div>
</div>
</div>`,
  });
}

/** Cross-sell for the whole cart: related to what is in it, never pushing the total over 4.000 €. */
function cartComplements(priced, limit = 3) {
  const inCart = new Set(priced.items.map((i) => i.product.sku));
  const anchors = [...priced.items].sort((a, b) => b.product.price - a.product.price);
  const out = [];
  const seen = new Set(inCart);
  for (const anchor of anchors) {
    for (const c of complementsFor(anchor.product, 6, seen)) {
      if (priced.total + c.product.price > BUDGET_CAP) continue;
      out.push({ ...c, anchor: anchor.product });
      seen.add(c.product.sku);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function thresholds(total) {
  const ship = total >= FREE_SHIPPING_FROM
    ? '✓ Tu pedido tiene envío gratis.'
    : `Te faltan ${formatPrice(FREE_SHIPPING_FROM - total)} para el envío gratis.`;
  const mount = total >= FREE_ASSEMBLY_FROM
    ? '✓ Tu pedido tiene montaje gratis.'
    : `Te faltan ${formatPrice(FREE_ASSEMBLY_FROM - total)} para el montaje gratis.`;
  return `<ul class="thresholds"><li>${ship}</li><li>${mount}</li></ul>`;
}

export function renderCart(priced, { added, cartCount } = {}) {
  const checkoutBtn = '<a class="btn btn-block" href="/checkout">Finalizar compra como invitado</a>';
  if (!priced.items.length) {
    return layout({
      title: 'Tu carrito está vacío | DevoShop',
      description: 'Tu carrito de DevoShop está vacío. Descubre sofás, camas, mesas y packs para amueblar tu casa.',
      cartCount,
      body: `<div class="container section">
<h1 class="page-title">Tu carrito</h1>
<p>Tu carrito está vacío. Empieza por una categoría o por un pack:</p>
<ul class="chips"><li><a href="/packs">Packs</a></li>${CATEGORIES.map((c) => `<li><a href="/categoria/${c.slug}">${c.name}</a></li>`).join('')}</ul>
</div>`,
    });
  }
  const rows = priced.items.map((i, n) => {
    const p = i.product;
    const opts = Array.from({ length: 20 }, (_, k) => `<option value="${k + 1}"${k + 1 === i.quantity ? ' selected' : ''}>${k + 1}</option>`).join('');
    return `<li class="cart-line">
<img src="${productImage(p)}" alt="${escapeHtml(p.name)}" width="120" height="90">
<div class="cart-line-body">
<a class="cart-line-name" href="/producto/${encodeURIComponent(p.sku)}">${escapeHtml(p.name)}</a>
<p class="muted">${formatPrice(p.price)} / unidad</p>
<div class="cart-line-actions">
<form action="/carrito/cantidad" method="post" class="qty-form">
<input type="hidden" name="sku" value="${escapeHtml(p.sku)}">
<label for="cantidad-${n}">Cantidad</label>
<select id="cantidad-${n}" name="cantidad">${opts}</select>
<button class="btn btn-outline btn-small" type="submit">Actualizar</button>
</form>
<form action="/carrito/cantidad" method="post">
<input type="hidden" name="sku" value="${escapeHtml(p.sku)}">
<input type="hidden" name="cantidad" value="0">
<button class="link-btn" type="submit">Quitar ${escapeHtml(p.name)}</button>
</form>
</div>
</div>
<p class="cart-line-total">${formatPrice(i.subtotalCents / 100)}</p>
</li>`;
  }).join('');
  const suggestions = cartComplements(priced);
  const addedNote = added ? `<p class="notice" role="status">✓ Añadido al carrito: ${escapeHtml(added)}</p>` : '';
  return layout({
    title: `Tu carrito (${priced.count}) | DevoShop`,
    description: 'Revisa los productos de tu carrito y finaliza la compra como invitado, sin registro y con pago simulado.',
    cartCount,
    body: `<div class="container section">
${addedNote}
<h1 class="page-title">Tu carrito</h1>
<div class="cart-top"><p><strong>Total: ${formatPrice(priced.total)}</strong> · ${priced.count} ${priced.count === 1 ? 'producto' : 'productos'}</p>${checkoutBtn}</div>
<div class="cart">
<div>
<ul class="cart-lines">${rows}</ul>
${suggestions.length ? `<section class="complements" aria-labelledby="completa">
<h2 id="completa" class="complements-title">Completa tu espacio</h2>
<ul>${suggestions.map((c) => complementCard(c, c.anchor.name)).join('')}</ul>
</section>` : ''}
</div>
<aside class="summary" aria-label="Resumen del pedido">
<p class="summary-total"><span>Total (IVA incluido)</span> <strong>${formatPrice(priced.total)}</strong></p>
${thresholds(priced.total)}
${checkoutBtn}
<a class="continue" href="/">Seguir comprando</a>
</aside>
</div>
</div>`,
  });
}

function summaryList(priced) {
  return `<ul class="summary-lines">${priced.items.map((i) => `<li><span>${i.quantity} × ${escapeHtml(i.product.name)}</span><span>${formatPrice(i.subtotalCents / 100)}</span></li>`).join('')}</ul>
<p class="summary-total"><span>Total (IVA incluido)</span> <strong>${formatPrice(priced.total)}</strong></p>`;
}

export function renderCheckout(priced, { values = {}, errors = {}, failed = false, cartCount } = {}) {
  const field = (name, label, type, autocomplete, placeholder) => {
    const err = errors[name];
    return `<div class="field${err ? ' has-error' : ''}">
<label for="${name}">${label}</label>
<input id="${name}" name="${name}" type="${type}" autocomplete="${autocomplete}" required value="${escapeHtml(values[name] ?? '')}"${err ? ` aria-invalid="true" aria-describedby="${name}-error"` : ''}>
${err ? `<p class="field-error" id="${name}-error">${escapeHtml(err)}</p>` : ''}
</div>`;
  };
  return layout({
    title: 'Finalizar compra como invitado | DevoShop',
    description: 'Finaliza tu compra en DevoShop como invitado: nombre, email y dirección. Pago simulado, sin datos de tarjeta.',
    cartCount,
    body: `<div class="container section">
<h1 class="page-title">Finalizar compra</h1>
<p class="muted">Compra como invitado, sin registro. Solo necesitamos tu nombre, tu email y la dirección de envío.</p>
${failed ? '<p class="notice notice-error" role="alert">No hemos podido registrar tu pedido y no se ha completado la compra. Pulsa «Pagar» otra vez para reintentarlo.</p>' : ''}
${Object.keys(errors).length ? '<p class="notice notice-error" role="alert">Revisa los campos marcados.</p>' : ''}
<div class="cart">
<form class="checkout-form" action="/checkout" method="post" novalidate>
${field('name', 'Nombre y apellidos', 'text', 'name', 'Lucía Fernández Ruiz')}
${field('email', 'Email', 'email', 'email', 'nombre@dominio.com')}
${field('address', 'Dirección de envío', 'text', 'street-address', 'Calle de los Olivos 12, 28045 Madrid')}
<p class="pay-note">Pago simulado: no se piden datos de tarjeta. Al pulsar «Pagar», el pedido queda confirmado.</p>
<button class="btn btn-block" type="submit">Pagar ${formatPrice(priced.total)} (pago simulado)</button>
</form>
<aside class="summary" aria-label="Resumen del pedido">
<h2 class="complements-title">Tu pedido</h2>
${summaryList(priced)}
${thresholds(priced.total)}
<a class="continue" href="/carrito">Volver al carrito</a>
</aside>
</div>
</div>`,
  });
}

export function renderConfirmation(order, { cartCount } = {}) {
  const lines = order.items.map((i) => `<li><span>${i.quantity} × ${escapeHtml(i.name)}</span><span>${formatPrice(i.quantity * i.unit_price)}</span></li>`).join('');
  return layout({
    title: 'Pedido confirmado | DevoShop',
    description: 'Tu pedido en DevoShop está confirmado. Gracias por tu compra.',
    cartCount,
    body: `<div class="container section confirmation">
<p class="confirm-icon" aria-hidden="true">✓</p>
<h1 class="page-title">Pedido confirmado</h1>
<p>Gracias, ${escapeHtml(order.customer.name)}. Tu pedido <strong>${escapeHtml(order.order_id)}</strong> está registrado.</p>
<p class="muted">Lo enviaremos a ${escapeHtml(order.customer.address)}. ${CONDITIONS.entrega}</p>
<div class="summary">
<ul class="summary-lines">${lines}</ul>
<p class="summary-total"><span>Total pagado (IVA incluido)</span> <strong>${formatPrice(order.total)}</strong></p>
</div>
<a class="btn" href="/">Volver a la tienda</a>
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
