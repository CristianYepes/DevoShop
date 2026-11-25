// Package assistant is the shop assistant (no LLM): it answers only from the catalog and the
// sales conditions. The question is treated as data to look things up, never as instructions,
// and the user's own words are never echoed back, so role-injection attempts have nothing to
// grab onto. It answers in well under a millisecond and costs nothing.
package assistant

import (
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/CristianYepes/DevoShop/internal/catalog"
	"github.com/CristianYepes/DevoShop/internal/textx"
)

const (
	maxChars  = 1400
	maxPrices = 4
)

type condicion struct {
	claves []string
	texto  string
}

// From db/data/condiciones-de-venta.md.
var condiciones = []condicion{
	{[]string{"envio", "enviais", "entrega", "entregais", "llega", "tarda", "canaria", "baleare", "ceuta", "melilla", "peninsula", "transporte", "porte"},
		"Envío gratis en pedidos desde 500 €; en pedidos de menos de 500 € el envío cuesta 49 €. Entregamos en 3 a 5 días laborables en la península y en 7 a 10 días laborables en Baleares. No enviamos a Canarias, Ceuta ni Melilla."},
	{[]string{"montaje", "montar", "monta", "montais", "instalacion", "instalar"},
		"Montaje a domicilio: 39 € por pedido. Es gratis en pedidos desde 1.500 €."},
	{[]string{"devolucion", "devolver", "devuelvo", "cambio", "cambiar", "desisti", "noche", "prueba", "reembolso"},
		"Tienes 30 días naturales para devolver cualquier producto sin usar. Los colchones tienen 100 noches de prueba: si no te convence, lo recogemos sin coste."},
	{[]string{"garantia", "garantizado", "roto", "defecto", "averia"},
		"Garantía de 3 años en todos los muebles y de 10 años en los colchones."},
	{[]string{"pago", "pagar", "tarjeta", "bizum", "transferencia", "financiacion", "financiar", "plazo", "plazos", "cuota", "aplazado", "paypal"},
		"Aceptamos tarjeta, Bizum y transferencia bancaria. No ofrecemos financiación ni pago a plazos."},
}

func stemSet(words string) map[string]bool {
	out := map[string]bool{}
	for _, w := range strings.Fields(words) {
		out[textx.Stem(w)] = true
	}
	return out
}

var (
	// Generic words that say nothing about WHICH product.
	genericas = stemSet(`que cual cuanto cuanta cuesta cuestan vale valen precio precios coste tiene teneis tienes hay
  vendeis venden busco quiero necesito me te se lo la el los las un una unos unas de del al a en y o para por con sin
  mas menos tu su sus mi este esta ese esa es son color tamano medida medidas ancho cm disponible disponibles barato
  barata caro cara economico mejor algun alguna ofreceis ofrece dime decir saber puedo podeis hola gracias favor
  modelo modelos tipo tipos producto productos articulo catalogo tienda devoshop como donde cuando plaza plazas`)
	// Words that show the question is about a product.
	producto = stemSet(`sofa sillon cama colchon mesa silla escritorio lampara flexo alfombra
  cojin manta funda sabana almohada armario aparador estanteria mesilla cajonera protector
  reposapie soporte alfombrilla mueble
  iluminacion textil almacenaje accesorio decoracion comedor dormitorio salon despacho oficina`)
	// Price/stock words: they make a question about products only when no sales condition was asked.
	preguntaProducto = stemSet(`precio cuesta cuestan vale valen teneis vendeis producto catalogo`)

	digitsOnly = regexp.MustCompile(`^\d+$`)
	priceRe    = regexp.MustCompile(`\d[\d.]*,\d{2}[` + textx.JSSpace + `]?€`)
	lastWord   = regexp.MustCompile(`[` + textx.JSSpace + `]+[^` + textx.JSSpace + `]*$`)
)

type indexed struct {
	p      *catalog.Product
	nombre map[string]bool
	todo   map[string]bool
}

// Assistant answers questions about one catalog.
type Assistant struct {
	index      []indexed
	vocab      map[string]bool
	defaultMsg string
}

func stems(s string) []string {
	t := textx.Tokens(s)
	for i, w := range t {
		t[i] = textx.Stem(w)
	}
	return t
}

func set(words []string) map[string]bool {
	out := make(map[string]bool, len(words))
	for _, w := range words {
		out[w] = true
	}
	return out
}

// New indexes the catalog.
func New(cat *catalog.Catalog) *Assistant {
	a := &Assistant{vocab: map[string]bool{}}
	for _, p := range cat.All() {
		catName := ""
		if c := catalog.GetCategory(p.Category); c != nil {
			catName = c.Name
		}
		seats := ""
		if p.Seats > 0 {
			seats = strconv.Itoa(p.Seats) + " plazas"
		}
		x := indexed{
			p:      p,
			nombre: set(stems(p.Name)),
			todo:   set(stems(strings.Join([]string{p.Name, p.Category, catName, p.Color, p.Material, seats}, " "))),
		}
		for w := range x.todo {
			a.vocab[w] = true
		}
		a.index = append(a.index, x)
	}
	for _, c := range condiciones {
		for _, k := range c.claves {
			a.vocab[textx.Stem(k)] = true
		}
	}
	names := make([]string, len(catalog.Categories))
	for i, c := range catalog.Categories {
		names[i] = strings.ToLower(c.Name)
	}
	a.defaultMsg = "Soy el asistente de la tienda DevoShop y solo puedo ayudarte con nuestros productos (" +
		strings.Join(names, ", ") + ") y con las condiciones de venta: envío, montaje, devoluciones, garantía y pago."
	return a
}

func lineaProducto(p *catalog.Product) string {
	var extra []string
	if p.Seats > 0 {
		extra = append(extra, strconv.Itoa(p.Seats)+" plazas")
	}
	extra = append(extra, textx.Num(p.Width)+" cm de ancho")
	if p.Color != "" {
		extra = append(extra, p.Color)
	}
	if p.Material != "" {
		extra = append(extra, p.Material)
	}
	return p.Name + ": " + textx.EUR(p.Price) + " (" + strings.Join(extra, ", ") + ")."
}

func recortar(texto string) string {
	if textx.RuneLen(texto) <= maxChars {
		return texto
	}
	return lastWord.ReplaceAllString(textx.Truncate(texto, maxChars-1), "") + "…"
}

// Answer replies to one question. The reply is under 1.500 characters with at most 4 prices.
func (a *Assistant) Answer(pregunta string) string {
	pal := stems(pregunta)
	has := func(w string) bool { return slices.Contains(pal, w) }
	var partes []string

	var conds []condicion
	for _, c := range condiciones {
		if slices.ContainsFunc(c.claves, func(k string) bool { return has(textx.Stem(k)) }) {
			conds = append(conds, c)
			partes = append(partes, c.texto)
		}
	}

	nombraProducto := slices.ContainsFunc(pal, func(w string) bool { return producto[w] }) ||
		slices.ContainsFunc(pal, func(w string) bool {
			return !genericas[w] && slices.ContainsFunc(a.index, func(x indexed) bool { return x.nombre[w] })
		})
	pideProducto := nombraProducto || (len(conds) == 0 && slices.ContainsFunc(pal, func(w string) bool { return preguntaProducto[w] }))

	if pideProducto {
		desconocidas := 0
		for _, w := range pal {
			if len(w) > 3 && !genericas[w] && !a.vocab[w] && !digitsOnly.MatchString(w) {
				desconocidas++
			}
		}
		type punto struct {
			p *catalog.Product
			s int
		}
		var puntos []punto
		for _, x := range a.index {
			s := 0
			for _, w := range pal {
				switch {
				case genericas[w]:
				case x.nombre[w]:
					s += 2
				case x.todo[w]:
					s++
				}
			}
			if s > 0 {
				puntos = append(puntos, punto{x.p, s})
			}
		}
		sort.SliceStable(puntos, func(i, j int) bool {
			if puntos[i].s != puntos[j].s {
				return puntos[i].s > puntos[j].s
			}
			return puntos[i].p.Price < puntos[j].p.Price
		})

		if desconocidas > 0 || len(puntos) == 0 {
			partes = append(partes, "No tenemos ese producto en nuestro catálogo. Puedo ayudarte con los productos de DevoShop: sofás, camas, colchones, mesas, sillas, escritorios, almacenaje, iluminación, textil y accesorios.")
		} else {
			var top []*catalog.Product
			for _, x := range puntos {
				if x.s == puntos[0].s && len(top) < maxPrices {
					top = append(top, x.p)
				}
			}
			if len(top) == 1 {
				partes = append(partes, lineaProducto(top[0]))
			} else {
				lines := make([]string, len(top))
				for i, p := range top {
					lines[i] = "- " + lineaProducto(p)
				}
				partes = append(partes, "Te puede interesar:\n"+strings.Join(lines, "\n"))
			}
			partes = append(partes, "Precios con IVA incluido. Puedes comprar como invitado, sin registro.")
		}
	}

	if len(partes) == 0 {
		partes = append(partes, a.defaultMsg)
	}
	// Never more than 4 prices in one answer, whatever the branches above produced.
	n := 0
	texto := priceRe.ReplaceAllStringFunc(strings.Join(partes, "\n\n"), func(m string) string {
		n++
		if n <= maxPrices {
			return m
		}
		return ""
	})
	return recortar(texto)
}
