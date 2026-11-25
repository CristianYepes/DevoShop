// Package catalog is the catalog used by the pages, the cart, the order and the assistant.
// It is built once at startup from the supplier files and kept in memory: no database on the
// request path, so pages stay fast under load.
package catalog

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/fs"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/CristianYepes/DevoShop/internal/textx"
)

// Category is one of the LEEME.md categories with its display name and image.
type Category struct {
	Slug, Name, Img string
}

// Categories in menu order. The slug IS the catalog category.
var Categories = []Category{
	{"sofa", "Sofás y sillones", "sofa"},
	{"mesa", "Mesas", "table"},
	{"silla", "Sillas de comedor", "chair"},
	{"cama", "Camas", "bed"},
	{"colchon", "Colchones", "bed"},
	{"escritorio", "Escritorios", "table"},
	{"silla_oficina", "Sillas de oficina", "chair"},
	{"almacenaje", "Almacenaje", "storage"},
	{"iluminacion", "Iluminación", "lamp"},
	{"textil", "Textil", "textile"},
	{"accesorio", "Accesorios", "decor"},
}

// CrossSell are the categories that count as cross-sell for the agent evaluation.
var CrossSell = []string{"iluminacion", "textil", "almacenaje", "accesorio"}

// GetCategory returns the category with that slug, or nil.
func GetCategory(slug string) *Category {
	for i := range Categories {
		if Categories[i].Slug == slug {
			return &Categories[i]
		}
	}
	return nil
}

// Product is a sellable product. Name and Price are exactly the ones in /catalogo.json.
type Product struct {
	SKU         string
	IDsOrigen   []string
	Name        string
	Category    string
	Price       float64
	Width       float64
	Depth       float64
	Height      float64
	Seats       int // 0 = not stated
	Color       string
	Material    string
	Description string
}

// Image is the illustration for the product's category.
func (p *Product) Image() string {
	img := "decor"
	if c := GetCategory(p.Category); c != nil {
		img = c.Img
	}
	return "/static/img/" + img + ".svg"
}

// Complement is a cross-sell suggestion with the share of orders that included it (0 = unknown).
type Complement struct {
	*Product
	Share int
}

// counter counts keys and remembers the order they first appeared in.
type counter struct {
	keys []string
	n    map[string]int
}

func (c *counter) add(k string, v int) {
	if c.n == nil {
		c.n = map[string]int{}
	}
	if _, ok := c.n[k]; !ok {
		c.keys = append(c.keys, k)
	}
	c.n[k] += v
}

// Catalog is the in-memory catalog. It is read-only after Load.
type Catalog struct {
	products    []*Product
	bySKU       map[string]*Product
	catalogJSON []byte
	unitsSold   map[string]int
	together    map[string]*counter // sku -> skus bought in the same order
	ordersWith  map[string]int      // sku -> orders containing it
	searchIndex []indexed
	packs       []Pack
}

// Load builds the catalog from proveedor-a.csv, proveedor-b.json and historial-ventas.csv.
func Load(fsys fs.FS) (*Catalog, error) {
	productos, _, err := BuildCatalog(fsys)
	if err != nil {
		return nil, err
	}
	historial, err := loadHistorial(fsys)
	if err != nil {
		return nil, err
	}

	c := &Catalog{bySKU: map[string]*Product{}, unitsSold: map[string]int{}, together: map[string]*counter{}, ordersWith: map[string]int{}}
	for _, p := range productos {
		prod := &Product{
			SKU: p.SKU, IDsOrigen: p.IDsOrigen, Name: p.nombre, Category: p.categoria, Price: p.precio,
			Width: p.ancho, Depth: p.fondo, Height: p.alto, Seats: p.plazas, Color: p.color, Material: p.material,
			Description: p.descripcion,
		}
		if prod.Description == "" {
			prod.Description = fmt.Sprintf("%s, acabado en %s color %s. Medidas: %s x %s x %s cm (ancho x fondo x alto).",
				prod.Name, prod.Material, prod.Color, textx.Num(prod.Width), textx.Num(prod.Depth), textx.Num(prod.Height))
		}
		c.products = append(c.products, prod)
		c.bySKU[prod.SKU] = prod
	}
	if c.catalogJSON, err = c.buildCatalogJSON(); err != nil {
		return nil, err
	}
	c.indexHistory(historial)
	c.buildSearchIndex()
	c.buildPacks()
	return c, nil
}

// buildCatalogJSON serialises the LEEME.md format once.
func (c *Catalog) buildCatalogJSON() ([]byte, error) {
	type item struct {
		SKU       string   `json:"sku"`
		IDsOrigen []string `json:"ids_origen"`
		Nombre    string   `json:"nombre"`
		Categoria string   `json:"categoria"`
		Precio    float64  `json:"precio"`
		Plazas    *int     `json:"plazas"`
		AnchoCM   float64  `json:"ancho_cm"`
		Color     string   `json:"color"`
		Material  string   `json:"material"`
	}
	items := make([]item, len(c.products))
	for i, p := range c.products {
		items[i] = item{p.SKU, p.IDsOrigen, p.Name, p.Category, p.Price, nil, p.Width, p.Color, p.Material}
		if p.Seats > 0 {
			seats := p.Seats
			items[i].Plazas = &seats
		}
	}
	return MarshalJSON(struct {
		Productos []item `json:"productos"`
	}{items})
}

// MarshalJSON is compact JSON without HTML escaping (like JSON.stringify).
func MarshalJSON(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}

// CatalogJSON is the body of GET /catalogo.json.
func (c *Catalog) CatalogJSON() []byte { return c.catalogJSON }

// All returns every product, sorted by category and name.
func (c *Catalog) All() []*Product { return c.products }

// Get returns the product with that sku, or nil.
func (c *Catalog) Get(sku string) *Product { return c.bySKU[sku] }

// InCategory returns the products of one category.
func (c *Catalog) InCategory(slug string) []*Product {
	var out []*Product
	for _, p := range c.products {
		if p.Category == slug {
			out = append(out, p)
		}
	}
	return out
}

// ---------- sales history: best sellers and "bought together" ----------

func (c *Catalog) indexHistory(historial []venta) {
	skuByOrigin := map[string]string{}
	for _, p := range c.products {
		for _, id := range p.IDsOrigen {
			skuByOrigin[id] = p.SKU
		}
	}
	var orderKeys []string
	orders := map[string]*counter{}
	for _, h := range historial {
		sku, ok := skuByOrigin[h.idOrigen]
		if !ok {
			continue
		}
		c.unitsSold[sku] += h.cantidad
		if orders[h.pedido] == nil {
			orders[h.pedido] = &counter{}
			orderKeys = append(orderKeys, h.pedido)
		}
		orders[h.pedido].add(sku, 0)
	}
	for _, k := range orderKeys {
		skus := orders[k].keys
		for _, a := range skus {
			c.ordersWith[a]++
			if c.together[a] == nil {
				c.together[a] = &counter{}
			}
			for _, b := range skus {
				if a != b {
					c.together[a].add(b, 1)
				}
			}
		}
	}
}

// BestSellers are the real best sellers by units in the sales history (honest social proof,
// no invented discounts).
func (c *Catalog) BestSellers(limit int) []*Product {
	out := slices.Clone(c.products)
	sort.SliceStable(out, func(i, j int) bool { return c.unitsSold[out[i].SKU] > c.unitsSold[out[j].SKU] })
	return out[:min(limit, len(out))]
}

// ComplementsFor returns cross-sell for a product: items from lighting, textile, storage or
// accessories most often bought in the same order, with the real share of orders. Falls back
// to best sellers.
func (c *Catalog) ComplementsFor(p *Product, limit int) []Complement {
	base := c.ordersWith[p.SKU]
	var pairs []Complement
	type pair struct {
		p *Product
		n int
	}
	var cands []pair
	if t := c.together[p.SKU]; t != nil {
		for _, sku := range t.keys {
			q := c.bySKU[sku]
			if q != nil && slices.Contains(CrossSell, q.Category) && q.Category != p.Category {
				cands = append(cands, pair{q, t.n[sku]})
			}
		}
	}
	sort.SliceStable(cands, func(i, j int) bool { return cands[i].n > cands[j].n })
	for _, x := range cands[:min(limit, len(cands))] {
		share := 0
		if base > 0 {
			share = roundHalfUp(float64(100*x.n) / float64(base))
		}
		pairs = append(pairs, Complement{x.p, share})
	}
	if len(pairs) >= limit {
		return pairs
	}
	for _, q := range c.BestSellers(len(c.products)) {
		if len(pairs) >= limit {
			break
		}
		if !slices.Contains(CrossSell, q.Category) || q.Category == p.Category {
			continue
		}
		if slices.ContainsFunc(pairs, func(x Complement) bool { return x.SKU == q.SKU }) {
			continue
		}
		pairs = append(pairs, Complement{q, 0})
	}
	return pairs
}

func roundHalfUp(f float64) int {
	n := int(f)
	if f-float64(n) >= 0.5 {
		n++
	}
	return n
}

// Featured is one product per category, best sellers first, for the home page.
func (c *Catalog) Featured(limit int) []*Product {
	seen := map[string]bool{}
	var out []*Product
	for _, p := range c.BestSellers(len(c.products)) {
		if !seen[p.Category] {
			seen[p.Category] = true
			out = append(out, p)
		}
	}
	return out[:min(limit, len(out))]
}

// ---------- search ----------

var stopWords = map[string]bool{"de": true, "la": true, "el": true, "los": true, "las": true, "un": true, "una": true,
	"para": true, "con": true, "y": true, "en": true, "del": true, "por": true, "que": true}

func searchWords(s string) map[string]bool {
	out := map[string]bool{}
	for _, w := range queryWords(s) {
		out[w] = true
	}
	return out
}

func queryWords(s string) []string {
	var out []string
	for _, w := range textx.Tokens(s) {
		if !stopWords[w] {
			out = append(out, textx.Stem(w))
		}
	}
	return out
}

type indexed struct {
	p         *Product
	name, all map[string]bool
}

func (c *Catalog) buildSearchIndex() {
	for _, p := range c.products {
		catName := ""
		if cat := GetCategory(p.Category); cat != nil {
			catName = cat.Name
		}
		seats := ""
		if p.Seats > 0 {
			seats = strconv.Itoa(p.Seats) + " plazas"
		}
		c.searchIndex = append(c.searchIndex, indexed{
			p:    p,
			name: searchWords(p.Name),
			all:  searchWords(strings.Join([]string{p.Name, catName, p.Category, p.Color, p.Material, p.Description, seats}, " ")),
		})
	}
}

// Search ranks products: every query word that matches adds points (name matches count
// double). It never requires all words, so an over-specific query still returns the closest
// products.
func (c *Catalog) Search(query string) []*Product {
	q := queryWords(query)
	if len(q) == 0 {
		return nil
	}
	type hit struct {
		p     *Product
		score int
	}
	var hits []hit
	for _, x := range c.searchIndex {
		score := 0
		for _, w := range q {
			if x.name[w] {
				score += 2
			} else if x.all[w] {
				score++
			}
		}
		if score > 0 {
			hits = append(hits, hit{x.p, score})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].score != hits[j].score {
			return hits[i].score > hits[j].score
		}
		return hits[i].p.Price < hits[j].p.Price
	})
	out := make([]*Product, len(hits))
	for i, h := range hits {
		out[i] = h.p
	}
	return out
}
