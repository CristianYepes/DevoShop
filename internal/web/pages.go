package web

// HTML templates. No inline scripts or style attributes, so the CSP can forbid 'unsafe-inline'.
// Every page has exactly one <h1>, alt text on images and a <label> on every field.

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/CristianYepes/DevoShop/internal/cart"
	"github.com/CristianYepes/DevoShop/internal/catalog"
	"github.com/CristianYepes/DevoShop/internal/order"
	"github.com/CristianYepes/DevoShop/internal/textx"
)

var htmlEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")

func esc(s string) string { return htmlEscaper.Replace(s) }

var price = textx.EUR

// encodeURIComponent, for skus in links.
func encodeURIComponent(s string) string {
	const keep = "-_.!~*'()"
	var b strings.Builder
	for _, c := range []byte(s) {
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.IndexByte(keep, c) >= 0 {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func join[T any](items []T, f func(T) string) string {
	var b strings.Builder
	for _, it := range items {
		b.WriteString(f(it))
	}
	return b.String()
}

// pages renders every page of the store for one catalog.
type pages struct {
	cat        *catalog.Catalog
	cssVersion string
	footer     string
}

func newPages(cat *catalog.Catalog, cssVersion string) *pages {
	link := func(c catalog.Category) string {
		return `<li><a href="/categoria/` + c.Slug + `">` + c.Name + `</a></li>`
	}
	footer := `<footer class="site-footer">
<div class="container footer-grid">
<div><p class="footer-brand">DevoShop</p><p>Muebles de diseño para vivir mejor. Compra como invitado, sin registro.</p></div>
<div><p class="footer-title">Comprar</p><ul>` + join(catalog.Categories[:4], link) + `</ul></div>
<div><p class="footer-title">Complementos</p><ul>` + join(catalog.Categories[4:], link) + `</ul></div>
<div><p class="footer-title">Ayuda</p><ul><li><a href="/carrito">Tu carrito</a></li><li>Precios con IVA incluido</li><li>Pago simulado, sin tarjeta</li></ul></div>
</div>
<p class="container footer-legal">© 2026 DevoShop · Tienda creada en el hackathon Devo Team</p>
</footer>`
	return &pages{cat: cat, cssVersion: cssVersion, footer: footer}
}

func header(activeCategory, query string) string {
	current := func(key string) string {
		if key == activeCategory {
			return ` aria-current="page"`
		}
		return ""
	}
	links := `<li><a class="nav-highlight" href="/mas-vendidos"` + current("ofertas") + `>Más vendidos</a></li>` +
		`<li><a class="nav-highlight" href="/packs"` + current("packs") + `>Packs</a></li>` +
		join(catalog.Categories, func(c catalog.Category) string {
			return `<li><a href="/categoria/` + c.Slug + `"` + current(c.Slug) + `>` + c.Name + `</a></li>`
		})
	return `<header class="site-header">
<div class="header-bar container">
<a class="brand" href="/">DevoShop</a>
<form class="search" action="/buscar" method="get" role="search">
<label for="q" class="sr-only">Buscar productos</label>
<input id="q" name="q" type="search" value="` + esc(query) + `" placeholder="Buscar sofás, mesas, lámparas…">
<button type="submit">Buscar</button>
</form>
<a class="cart-link" href="/carrito" aria-label="Carrito" title="Carrito"><span aria-hidden="true">🛒</span></a>
</div>
<nav class="cat-nav" aria-label="Categorías"><ul class="container">` + links + `</ul></nav>
</header>`
}

type layoutOpts struct {
	title, description, body, activeCategory, query string
}

func (pg *pages) layout(o layoutOpts) string {
	return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>` + esc(o.title) + `</title>
<meta name="description" content="` + esc(o.description) + `">
<link rel="stylesheet" href="/static/styles.css?v=` + pg.cssVersion + `">
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
</head>
<body>
` + header(o.activeCategory, o.query) + `
<main>
` + o.body + `
</main>
` + pg.footer + `
</body>
</html>`
}

func categoryName(slug string) string {
	if c := catalog.GetCategory(slug); c != nil {
		return c.Name
	}
	return ""
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

// No reference ("before") prices: the supplier data has none, and an invented one is a fake discount.
func productCard(p *catalog.Product) string {
	seats := ""
	if p.Seats > 0 {
		seats = " · " + strconv.Itoa(p.Seats) + " " + plural(p.Seats, "plaza", "plazas")
	}
	return `<li class="card">
<a href="/producto/` + encodeURIComponent(p.SKU) + `">
<span class="card-media"><img src="` + p.Image() + `" alt="` + esc(p.Name) + `" width="400" height="300" loading="lazy"></span>
<span class="card-name">` + esc(p.Name) + `</span>
<span class="card-meta">` + esc(categoryName(p.Category)) + ` · ` + textx.Num(p.Width) + ` cm` + seats + ` · ` + esc(p.Color) + ` · ` + esc(p.Material) + `</span>
<span class="card-price">` + price(p.Price) + `</span>
</a>
</li>`
}

func productGrid(products []*catalog.Product) string {
	return `<ul class="grid">` + join(products, productCard) + `</ul>`
}

func packCard(pack catalog.Pack) string {
	list := join(pack.Lines, func(l catalog.Line) string {
		qty := ""
		if l.Quantity > 1 {
			qty = strconv.Itoa(l.Quantity) + " × "
		}
		return `<li>` + qty + esc(l.Product.Name) + `</li>`
	})
	return `<li class="pack">
<img src="/static/img/` + pack.Img + `.svg" alt="` + esc(pack.Name) + `" width="400" height="300" loading="lazy">
<div class="pack-body">
<h3>` + esc(pack.Name) + `</h3>
<p class="muted">` + esc(pack.Description) + `</p>
<ul class="pack-items">` + list + `</ul>
<p class="pack-total">` + price(pack.Total) + ` <span class="muted">` + strconv.Itoa(len(pack.Lines)) + ` productos · IVA incluido</span></p>
<form action="/carrito/anadir-pack" method="post">
<input type="hidden" name="pack" value="` + esc(pack.ID) + `">
<button class="btn btn-block" type="submit">Añadir el pack al carrito</button>
</form>
</div>
</li>`
}

func packGrid(packs []catalog.Pack) string {
	return `<ul class="packs">` + join(packs, packCard) + `</ul>`
}

func (pg *pages) home() string {
	tiles := join(catalog.Categories, func(c catalog.Category) string {
		return `<li><a class="tile" href="/categoria/` + c.Slug + `">
<img src="/static/img/` + c.Img + `.svg" alt="` + c.Name + `" width="400" height="300" loading="lazy"><span>` + c.Name + `</span></a></li>`
	})
	return pg.layout(layoutOpts{
		title:       "DevoShop | Muebles de diseño y decoración para tu hogar",
		description: "Sofás, mesas, camas, iluminación y textil de diseño. Compra como invitado, sin registro y con precios con IVA incluido.",
		body: `<section class="hero">
<img class="hero-img" src="/static/img/hero.svg" alt="Salón con sofá gris, lámpara de pie y alfombra" width="1600" height="800">
<div class="hero-text container">
<p class="eyebrow">Nueva colección</p>
<h1>Muebles de diseño para vivir mejor</h1>
<p>Piezas atemporales para el salón, el comedor y el dormitorio. Compra como invitado en pocos pasos.</p>
<a class="btn" href="/categoria/sofa">Ver sofás</a>
</div>
</section>
<ul class="usp container">
<li><strong>Sin registro</strong> Compra como invitado</li>
<li><strong>Precios claros</strong> IVA incluido en todo</li>
<li><strong>Pago en un clic</strong> Sin datos de tarjeta</li>
<li><strong>Montaje gratis</strong> En pedidos desde 1.500 €</li>
</ul>
<section class="container section">
<h2 class="section-title">Compra por categoría</h2>
<ul class="tiles">` + tiles + `</ul>
</section>
<section class="container section">
<div class="section-head"><h2 class="section-title">Más vendidos</h2><a href="/mas-vendidos">Ver los más vendidos</a></div>
` + productGrid(pg.cat.BestSellers(4)) + `
</section>
<section class="container section">
<div class="section-head"><h2 class="section-title">Packs para amueblar de una vez</h2><a href="/packs">Ver todos los packs</a></div>
` + packGrid(pg.cat.Packs()) + `
</section>
<section class="container section">
<h2 class="section-title">Destacados</h2>
` + productGrid(pg.cat.Featured(8)) + `
</section>
<section class="container section editorial">
<div>
<h2>Crea un salón completo</h2>
<p>Un buen sofá pide una lámpara de lectura, una alfombra cálida y un par de cojines. Combínalos y deja tu espacio listo de una vez.</p>
<a class="btn btn-outline" href="/categoria/iluminacion">Ver iluminación</a>
</div>
<img src="/static/img/lamp.svg" alt="Lámpara de pie junto a un sofá" width="400" height="300" loading="lazy">
</section>`,
	})
}

func (pg *pages) category(c *catalog.Category, products []*catalog.Product) string {
	list := `<p>No hay productos en esta categoría ahora mismo.</p>`
	if len(products) > 0 {
		list = productGrid(products)
	}
	return pg.layout(layoutOpts{
		title:          c.Name + " de diseño | DevoShop",
		description:    "Descubre nuestra selección de " + strings.ToLower(c.Name) + " de diseño con precios con IVA incluido. Compra como invitado.",
		activeCategory: c.Slug,
		body: `<div class="container section">
<nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> / <span>` + c.Name + `</span></nav>
<h1 class="page-title">` + c.Name + `</h1>
<p class="muted">` + strconv.Itoa(len(products)) + ` ` + plural(len(products), "producto", "productos") + `</p>
` + list + `
</div>`,
	})
}

func (pg *pages) offers() string {
	top := pg.cat.BestSellers(12)
	return pg.layout(layoutOpts{
		title:          "Los muebles más vendidos | DevoShop",
		description:    "Los sofás, camas, mesas, lámparas y textiles que más compran nuestros clientes. Precios con IVA incluido.",
		activeCategory: "ofertas",
		body: `<div class="container section">
<nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> / <span>Más vendidos</span></nav>
<h1 class="page-title">Más vendidos</h1>
<p class="muted">Los ` + strconv.Itoa(len(top)) + ` productos que más unidades han vendido. Precios con IVA incluido.</p>
` + productGrid(top) + `
</div>`,
	})
}

func (pg *pages) packs() string {
	return pg.layout(layoutOpts{
		title:          "Packs para amueblar tu casa | DevoShop",
		description:    "Packs de salón, dormitorio y comedor con todo lo necesario. Añade el pack entero al carrito de una vez.",
		activeCategory: "packs",
		body: `<div class="container section">
<nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> / <span>Packs</span></nav>
<h1 class="page-title">Packs</h1>
<p class="muted">Habitaciones completas, pensadas para combinar. Un clic y tienes todo en el carrito.</p>
` + packGrid(pg.cat.Packs()) + `
</div>`,
	})
}

func (pg *pages) search(query string, products []*catalog.Product) string {
	q := esc(query)
	title, h1 := "Buscar productos | DevoShop tienda de muebles", "Buscar productos"
	if query != "" {
		title, h1 = "Resultados para «"+query+"» | DevoShop", "Resultados para «"+q+"»"
	}
	var results string
	if len(products) > 0 {
		results = `<p class="muted">` + strconv.Itoa(len(products)) + ` ` + plural(len(products), "producto", "productos") + `</p>` + productGrid(products)
	} else {
		msg := "Escribe qué buscas en el buscador."
		if query != "" {
			msg = "No hemos encontrado productos con esa búsqueda."
		}
		results = `<p>` + msg + ` Prueba con una categoría:</p>
<ul class="chips">` + join(catalog.Categories, func(c catalog.Category) string {
			return `<li><a href="/categoria/` + c.Slug + `">` + c.Name + `</a></li>`
		}) + `</ul>`
	}
	return pg.layout(layoutOpts{
		title:       title,
		description: "Busca sofás, mesas, camas, lámparas y textil en el catálogo de DevoShop.",
		query:       query,
		body: `<div class="container section">
<h1 class="page-title">` + h1 + `</h1>
` + results + `
</div>`,
	})
}

func (pg *pages) product(p *catalog.Product) string {
	c := catalog.GetCategory(p.Category)
	spec := func(k, v string) string { return `<dt>` + k + `</dt><dd>` + esc(v) + `</dd>` }
	specs := spec("Medidas", textx.Num(p.Width)+" x "+textx.Num(p.Depth)+" x "+textx.Num(p.Height)+" cm (ancho x fondo x alto)")
	if p.Seats > 0 {
		specs += spec("Plazas", strconv.Itoa(p.Seats))
	}
	specs += spec("Color", p.Color) + spec("Material", p.Material) + spec("Referencia", p.SKU)
	var options string
	for n := 1; n <= 5; n++ {
		options += fmt.Sprintf(`<option value="%d">%d</option>`, n, n)
	}
	return pg.layout(layoutOpts{
		title:          p.Name + " | DevoShop",
		description:    textx.Truncate(p.Name+": "+p.Description, 160),
		activeCategory: p.Category,
		body: `<div class="container section">
<nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> / <a href="/categoria/` + c.Slug + `">` + c.Name + `</a> / <span>` + esc(p.Name) + `</span></nav>
<div class="product">
<img class="product-img" src="` + p.Image() + `" alt="` + esc(p.Name) + `" width="800" height="600">
<div class="product-info">
<h1 class="product-name">` + esc(p.Name) + `</h1>
<p class="product-price">` + price(p.Price) + ` <span class="muted">IVA incluido</span></p>
<form class="buy" action="/carrito/anadir" method="post">
<input type="hidden" name="sku" value="` + esc(p.SKU) + `">
<label for="cantidad">Cantidad</label>
<select id="cantidad" name="cantidad">` + options + `</select>
<button class="btn btn-block" type="submit">Añadir al carrito, ` + price(p.Price) + `</button>
</form>
` + complementForms(pg.cat.ComplementsFor(p, 4), "Se compra junto con") + `
<p>` + esc(p.Description) + `</p>
<dl class="specs">` + specs + `</dl>
</div>
</div>
</div>
<ul class="usp container">
<li><strong>Envío gratis</strong> En pedidos desde 500 €</li>
<li><strong>Montaje gratis</strong> En pedidos desde 1.500 €</li>
<li><strong>Garantía</strong> 3 años en muebles, 10 en colchones</li>
<li><strong>Devolución</strong> 30 días</li>
</ul>`,
	})
}

// complementForms is the cross-sell right under the add-to-cart button: one-click add, with the
// real share from the sales history.
func complementForms(items []catalog.Complement, heading string) string {
	if len(items) == 0 {
		return ""
	}
	li := join(items, func(c catalog.Complement) string {
		share := ""
		if c.Share != 0 {
			share = ` <span class="muted">(` + strconv.Itoa(c.Share) + ` % de los clientes lo añaden)</span>`
		}
		return `<li class="complement">
<img src="` + c.Image() + `" alt="` + esc(c.Name) + `" width="80" height="60" loading="lazy">
<span><a href="/producto/` + encodeURIComponent(c.SKU) + `">` + esc(c.Name) + `</a> · ` + price(c.Price) + share + `</span>
<form action="/carrito/anadir" method="post"><input type="hidden" name="sku" value="` + esc(c.SKU) + `"><input type="hidden" name="cantidad" value="1"><button class="btn btn-outline" type="submit">Añadir ` + esc(c.Name) + `, ` + price(c.Price) + `</button></form>
</li>`
	})
	return `<section class="complements" aria-label="` + heading + `"><h2 class="section-title">` + heading + `</h2><ul class="complement-list">` + li + `</ul></section>`
}

const (
	freeAssemblyFrom = 1500
	freeShippingFrom = 500
)

func cartLines(r cart.Summary, editable bool) string {
	lines := join(r.Items, func(l catalog.Line) string {
		sku, name := esc(l.Product.SKU), esc(l.Product.Name)
		edit := ""
		if editable {
			edit = `<form action="/carrito/cantidad" method="post" class="qty"><input type="hidden" name="sku" value="` + sku + `">
<label for="q-` + sku + `">Cantidad de ` + name + `</label>
<input id="q-` + sku + `" name="cantidad" type="number" min="0" max="20" value="` + strconv.Itoa(l.Quantity) + `">
<button type="submit">Actualizar</button></form>
<form action="/carrito/cantidad" method="post"><input type="hidden" name="sku" value="` + sku + `"><input type="hidden" name="cantidad" value="0"><button type="submit">Quitar ` + name + `</button></form>`
		}
		return `<li class="cart-line" data-linea="` + sku + `" data-cantidad="` + strconv.Itoa(l.Quantity) + `">
<img src="` + l.Product.Image() + `" alt="` + name + `" width="80" height="60" loading="lazy">
<span class="cart-name"><a href="/producto/` + encodeURIComponent(l.Product.SKU) + `">` + name + `</a><br><span class="muted">` + strconv.Itoa(l.Quantity) + ` × ` + price(l.Product.Price) + `</span></span>
<strong>` + price(float64(l.Product.PriceCents()*int64(l.Quantity))/100) + `</strong>
` + edit + `
</li>`
	})
	return `<ul class="cart-lines">` + lines + `</ul>
<p class="cart-total">Total: <strong>` + price(r.Total) + `</strong> <span class="muted">IVA incluido</span></p>`
}

func perks(total float64) string {
	missing := func(from float64) string { return price(float64(textx.Cents(from)-textx.Cents(total)) / 100) }
	shipping := "Tu pedido tiene envío gratis."
	if total < freeShippingFrom {
		shipping = "Envío: 49 €. Gratis a partir de " + price(freeShippingFrom) + " (te faltan " + missing(freeShippingFrom) + ")."
	}
	assembly := "Tu pedido tiene montaje a domicilio gratis."
	if total < freeAssemblyFrom {
		assembly = "Montaje a domicilio gratis a partir de " + price(freeAssemblyFrom) + " (te faltan " + missing(freeAssemblyFrom) + ")."
	}
	return `<ul class="perks"><li>` + shipping + `</li><li>` + assembly + `</li></ul>`
}

func (pg *pages) cart(r cart.Summary) string {
	body := `<p>Tu carrito está vacío.</p><p><a class="btn" href="/">Seguir comprando</a></p>`
	if len(r.Items) > 0 {
		var cross []catalog.Complement
		for _, c := range pg.cat.ComplementsFor(r.Items[0].Product, 6) {
			inCart := false
			for _, l := range r.Items {
				inCart = inCart || l.Product.SKU == c.SKU
			}
			if !inCart && len(cross) < 3 {
				cross = append(cross, c)
			}
		}
		body = `<p><a class="btn" href="/checkout">Finalizar compra como invitado</a></p>
` + cartLines(r, true) + `
` + perks(r.Total) + `
<p><a class="btn btn-block" href="/checkout">Finalizar compra como invitado</a></p>
` + complementForms(cross, "Completa tu pedido")
	}
	return pg.layout(layoutOpts{
		title:       "Tu carrito de compra | DevoShop",
		description: "Revisa los productos de tu carrito y finaliza la compra como invitado, sin registro.",
		body: `<div class="container section">
<h1 class="page-title">Tu carrito</h1>
` + body + `
</div>`,
	})
}

func field(id, label, typ, value, errMsg, autocomplete string) string {
	attrs, errHTML := "", ""
	if errMsg != "" {
		attrs = ` aria-invalid="true" aria-describedby="` + id + `-error"`
		errHTML = `<span class="field-error" id="` + id + `-error">` + esc(errMsg) + `</span>`
	}
	return `<p class="field">
<label for="` + id + `">` + label + `</label>
<input id="` + id + `" name="` + id + `" type="` + typ + `" value="` + esc(value) + `" autocomplete="` + autocomplete + `" required` + attrs + `>
` + errHTML + `
</p>`
}

func (pg *pages) checkout(r cart.Summary, orderID string, form, errs map[string]string, notice string) string {
	alert := ""
	if notice != "" {
		alert = `<p class="alert" role="alert">` + notice + `</p>`
	}
	return pg.layout(layoutOpts{
		title:       "Finalizar compra como invitado | DevoShop",
		description: "Escribe tus datos de envío y confirma el pedido. Pago simulado, sin datos de tarjeta.",
		body: `<div class="container section">
<h1 class="page-title">Finalizar compra</h1>
` + alert + `
` + cartLines(r, false) + `
` + perks(r.Total) + `
<form class="checkout" action="/checkout" method="post">
<input type="hidden" name="order_id" value="` + esc(orderID) + `">
` + field("nombre", "Nombre y apellidos", "text", form["nombre"], errs["nombre"], "name") + `
` + field("email", "Email", "email", form["email"], errs["email"], "email") + `
` + field("direccion", "Dirección de envío", "text", form["direccion"], errs["direccion"], "street-address") + `
<p class="muted">Pago simulado: no se piden datos de tarjeta. Al pulsar el botón, el pedido queda confirmado.</p>
<button class="btn btn-block" type="submit">Pagar ` + price(r.Total) + ` (pago simulado)</button>
</form>
</div>`,
	})
}

func (pg *pages) orderError(r cart.Summary, orderID string, form map[string]string) string {
	return pg.checkout(r, orderID, form, nil, "No hemos podido registrar el pedido. Tus datos siguen aquí: pulsa «Pagar» otra vez para reintentarlo.")
}

func (pg *pages) emptyCheckout() string {
	return pg.layout(layoutOpts{
		title:       "Finalizar compra como invitado | DevoShop",
		description: "Tu carrito está vacío. Añade productos para finalizar la compra como invitado.",
		body: `<div class="container section"><h1 class="page-title">Finalizar compra</h1>
<p>Tu carrito está vacío.</p><p><a class="btn" href="/">Seguir comprando</a></p></div>`,
	})
}

// receipt is the signed copy of a confirmed order kept in the hk_pedido cookie.
type receipt struct {
	ID    string       `json:"id"`
	Items []order.Item `json:"items"`
	Total float64      `json:"total"`
	Name  string       `json:"name"`
}

func (pg *pages) confirmation(rc receipt) string {
	items := join(rc.Items, func(i order.Item) string {
		return `<li class="cart-line"><span class="cart-name">` + esc(i.Name) + `<br><span class="muted">` + strconv.Itoa(i.Quantity) + ` × ` + price(i.UnitPrice) + `</span></span></li>`
	})
	return pg.layout(layoutOpts{
		title:       "Pedido confirmado | DevoShop tienda de muebles",
		description: "Tu pedido en DevoShop está confirmado. Gracias por tu compra.",
		body: `<div class="container section">
<h1 class="page-title">Pedido confirmado</h1>
<p>Gracias, ` + esc(rc.Name) + `. Tu número de pedido es <strong>` + esc(rc.ID) + `</strong>.</p>
<ul class="cart-lines">` + items + `</ul>
<p class="cart-total">Total pagado: <strong>` + price(rc.Total) + `</strong> <span class="muted">IVA incluido</span></p>
<p><a class="btn" href="/">Volver a la tienda</a></p>
</div>`,
	})
}

var errorText = map[int]string{
	400: "Petición no válida",
	404: "Página no encontrada",
	405: "Método no permitido",
	413: "Petición demasiado grande",
	500: "Error interno",
}

func (pg *pages) errorPage(status int) string {
	text, ok := errorText[status]
	if !ok {
		text = "Error"
	}
	return pg.layout(layoutOpts{
		title:       text + " | DevoShop tienda online",
		description: "La página que buscas no está disponible. Vuelve a la portada de DevoShop.",
		body:        `<div class="container section"><h1 class="page-title">` + text + `</h1><p><a href="/">Volver a la portada</a></p></div>`,
	})
}
