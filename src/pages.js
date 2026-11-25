// HTML templates. No inline scripts or style attributes, so the CSP can forbid 'unsafe-inline'.
// Every page has exactly one <h1>, alt text on images and a <label> on every field.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CATEGORIES, getCategory, productImage, featuredProducts, complementsFor, offerProducts, getPacks,
} from './catalog.js';

// Cache-busting: the stylesheet URL changes whenever its content changes, so a new deploy
// is never hidden behind the 1-hour browser cache of /static.
const CSS_VERSION = createHash('sha256')
  .update(readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url))))
  .digest('hex').slice(0, 10);

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const priceFormat = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
export const formatPrice = (n) => priceFormat.format(n);

function header(activeCategory, query = '') {
  const current = (key) => (key === activeCategory ? ' aria-current="page"' : '');
  const links = `<li><a class="nav-highlight" href="/ofertas"${current('ofertas')}>Ofertas</a></li>`
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
<a class="cart-link" href="/carrito" aria-label="Carrito" title="Carrito"><span aria-hidden="true">🛒</span></a>
</div>
<nav class="cat-nav" aria-label="Categorías"><ul class="container">${links}</ul></nav>
</header>`;
}

const footer = `<footer class="site-footer">
<div class="container footer-grid">
<div><p class="footer-brand">DevoShop</p><p>Muebles de diseño para vivir mejor. Compra como invitado, sin registro.</p></div>
<div><p class="footer-title">Comprar</p><ul>${CATEGORIES.slice(0, 4).map((c) => `<li><a href="/categoria/${c.slug}">${c.name}</a></li>`).join('')}</ul></div>
<div><p class="footer-title">Complementos</p><ul>${CATEGORIES.slice(4).map((c) => `<li><a href="/categoria/${c.slug}">${c.name}</a></li>`).join('')}</ul></div>
<div><p class="footer-title">Ayuda</p><ul><li><a href="/carrito">Tu carrito</a></li><li>Precios con IVA incluido</li><li>Pago simulado, sin tarjeta</li></ul></div>
</div>
<p class="container footer-legal">© 2026 DevoShop · Tienda creada en el hackathon Devo Team</p>
</footer>`;

export function layout({ title, description, body, activeCategory, query }) {
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
${header(activeCategory, query)}
<main>
${body}
</main>
${footer}
</body>
</html>`;
}

const isOffer = (p) => p.old_price > p.price;
const savingPct = (p) => Math.round((1 - p.price / p.old_price) * 100);

function priceHtml(p, cls = 'card-price') {
  return isOffer(p)
    ? `<span class="${cls}"><span class="price-now">${formatPrice(p.price)}</span> <del>${formatPrice(p.old_price)}</del></span>`
    : `<span class="${cls}">${formatPrice(p.price)}</span>`;
}

function productCard(p) {
  return `<li class="card">
<a href="/producto/${encodeURIComponent(p.sku)}">
<span class="card-media"><img src="${productImage(p)}" alt="${escapeHtml(p.name)}" width="400" height="300" loading="lazy">${isOffer(p) ? `<span class="badge">-${savingPct(p)} %</span>` : ''}</span>
<span class="card-name">${escapeHtml(p.name)}</span>
<span class="card-meta">${escapeHtml(getCategory(p.category)?.name ?? '')} · ${p.width_cm} cm</span>
${priceHtml(p)}
</a>
</li>`;
}

const productGrid = (products) => `<ul class="grid">${products.map(productCard).join('')}</ul>`;

function packCard(pack) {
  const list = pack.lines.map((l) => `<li>${l.quantity > 1 ? `${l.quantity} × ` : ''}${escapeHtml(l.product.name)}</li>`).join('');
  return `<li class="pack">
<img src="/static/img/${pack.img}.svg" alt="${escapeHtml(pack.name)}" width="400" height="300" loading="lazy">
<div class="pack-body">
<h3>${escapeHtml(pack.name)}</h3>
<p class="muted">${escapeHtml(pack.description)}</p>
<ul class="pack-items">${list}</ul>
<p class="pack-total">${formatPrice(pack.total)} <span class="muted">${pack.lines.length} productos · IVA incluido</span></p>
<form action="/carrito/anadir-pack" method="post">
<input type="hidden" name="pack" value="${escapeHtml(pack.id)}">
<button class="btn btn-block" type="submit">Añadir el pack al carrito</button>
</form>
</div>
</li>`;
}

const packGrid = (packs) => `<ul class="packs">${packs.map(packCard).join('')}</ul>`;

export function renderHome() {
  const tiles = CATEGORIES.map((c) => `<li><a class="tile" href="/categoria/${c.slug}">
<img src="/static/img/${c.img}.svg" alt="${c.name}" width="400" height="300" loading="lazy"><span>${c.name}</span></a></li>`).join('');
  return layout({
    title: 'DevoShop | Muebles de diseño y decoración para tu hogar',
    description: 'Sofás, mesas, camas, iluminación y textil de diseño. Compra como invitado, sin registro y con precios con IVA incluido.',
    body: `<section class="hero">
<img class="hero-img" src="/static/img/hero.svg" alt="Salón con sofá gris, lámpara de pie y alfombra" width="1600" height="800">
<div class="hero-text container">
<p class="eyebrow">Nueva colección</p>
<h1>Muebles de diseño para vivir mejor</h1>
<p>Piezas atemporales para el salón, el comedor y el dormitorio. Compra como invitado en pocos pasos.</p>
<a class="btn" href="/categoria/sofas">Ver sofás</a>
</div>
</section>
<ul class="usp container">
<li><strong>Sin registro</strong> Compra como invitado</li>
<li><strong>Precios claros</strong> IVA incluido en todo</li>
<li><strong>Pago en un clic</strong> Sin datos de tarjeta</li>
</ul>
<section class="container section">
<h2 class="section-title">Compra por categoría</h2>
<ul class="tiles">${tiles}</ul>
</section>
<section class="container section">
<div class="section-head"><h2 class="section-title">Ofertas</h2><a href="/ofertas">Ver todas las ofertas</a></div>
${productGrid(offerProducts().slice(0, 4))}
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

export function renderCategory(category, products) {
  return layout({
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

export function renderOffers() {
  const offers = offerProducts();
  return layout({
    title: 'Ofertas en muebles y decoración | DevoShop',
    description: 'Sofás, sillones, iluminación y textil a precio rebajado. Precios con IVA incluido y compra como invitado.',
    activeCategory: 'ofertas',
    body: `<div class="container section">
<nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> / <span>Ofertas</span></nav>
<h1 class="page-title">Ofertas</h1>
<p class="muted">${offers.length} productos rebajados. El precio rebajado es el que pagas, IVA incluido.</p>
${productGrid(offers)}
</div>`,
  });
}

export function renderPacks() {
  return layout({
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

export function renderSearch(query, products) {
  const q = escapeHtml(query);
  return layout({
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

export function renderProduct(p) {
  const category = getCategory(p.category);
  const specs = [
    ['Ancho', `${p.width_cm} cm`],
    p.seats ? ['Plazas', p.seats] : null,
    ['Color', p.color],
    ['Material', p.material],
    ['Referencia', p.sku],
  ].filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('');
  const options = [1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}</option>`).join('');
  const complements = complementsFor(p);
  return layout({
    title: `${p.name} | DevoShop`,
    description: `${p.name}: ${p.description}`.slice(0, 160),
    activeCategory: p.category,
    body: `<div class="container section">
<nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> / <a href="/categoria/${category.slug}">${category.name}</a> / <span>${escapeHtml(p.name)}</span></nav>
<div class="product">
<img class="product-img" src="${productImage(p)}" alt="${escapeHtml(p.name)}" width="800" height="600">
<div class="product-info">
<h1 class="product-name">${escapeHtml(p.name)}</h1>
<p class="product-price">${isOffer(p) ? `<span class="price-now">${formatPrice(p.price)}</span> <del>${formatPrice(p.old_price)}</del> <span class="badge badge-inline">-${savingPct(p)} %</span>` : formatPrice(p.price)} <span class="muted">IVA incluido</span></p>
<form class="buy" action="/carrito/anadir" method="post">
<input type="hidden" name="sku" value="${escapeHtml(p.sku)}">
<label for="cantidad">Cantidad</label>
<select id="cantidad" name="cantidad">${options}</select>
<button class="btn btn-block" type="submit">Añadir al carrito</button>
</form>
<p>${escapeHtml(p.description)}</p>
<dl class="specs">${specs}</dl>
</div>
</div>
</div>
${complements.length ? `<section class="container section">
<h2 class="section-title">Completa tu espacio</h2>
${productGrid(complements)}
</section>` : ''}`,
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
