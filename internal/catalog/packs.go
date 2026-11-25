package catalog

// Packs: real products at catalog prices, every total below the agent's 4.000 € budget.

// PackItem is a sku and a quantity inside a pack definition.
type PackItem struct {
	SKU string
	Qty int
}

// Line is a product with a quantity (pack lines and cart lines).
type Line struct {
	Product  *Product
	Quantity int
}

// Pack is a ready-made room. Lines and Total are resolved against the catalog.
type Pack struct {
	ID, Name, Img, Description string
	Items                      []PackItem
	Lines                      []Line
	Total                      float64
}

var packDefs = []Pack{
	{
		ID: "salon-completo", Name: "Pack Salón completo", Img: "sofa",
		Description: "Todo para un salón de 20 m²: sofá de piel de tres plazas, sillón de lectura, lámpara de pie, lámpara de techo, alfombra de lana, cojines, manta, estantería y aparador.",
		Items:       []PackItem{{"sofa-aarhus", 1}, {"sillon-viena", 1}, {"lampara-de-pie-arco", 1}, {"lampara-de-techo-trenzada", 1}, {"alfombra-de-salon-160x230", 1}, {"pack-4-cojines-decorativos", 1}, {"manta-para-sofa", 1}, {"estanteria-libreria-5-baldas", 1}, {"aparador-3-puertas", 1}},
	},
	{
		ID: "dormitorio", Name: "Pack Dormitorio listo para estrenar", Img: "bed",
		Description: "Cama tapizada de 150, colchón de muelles ensacados, dos mesillas con sus lámparas, ropa de cama completa y armario.",
		Items:       []PackItem{{"cama-brisa-150x200-tapizada", 1}, {"colchon-premium-150x190-de-muelles-ensacados", 1}, {"mesilla-de-noche-1-cajon", 2}, {"lampara-de-mesilla-ceramica", 2}, {"funda-nordica-150-todo-el-ano", 1}, {"juego-de-sabanas-150", 1}, {"pack-2-almohadas-viscoelasticas", 1}, {"protector-de-colchon-impermeable-150", 1}, {"armario-2-puertas-correderas", 1}},
	},
	{
		ID: "comedor", Name: "Pack Comedor para seis", Img: "table",
		Description: "Mesa extensible de roble, seis sillas de nogal, aparador y lámpara de techo.",
		Items:       []PackItem{{"mesa-de-comedor-ebro-extensible", 1}, {"pack-6-sillas-de-comedor-nogal", 1}, {"aparador-3-puertas", 1}, {"lampara-de-techo-trenzada", 1}},
	},
	{
		ID: "despacho", Name: "Pack Despacho en casa", Img: "table",
		Description: "Escritorio elevable eléctrico, silla ergonómica con reposacabezas, flexo, soporte de monitor, reposapiés, alfombrilla, cajonera y estantería.",
		Items:       []PackItem{{"escritorio-elevable-electrico-160-cm", 1}, {"silla-de-oficina-pro-con-reposacabezas", 1}, {"flexo-led-regulable", 1}, {"soporte-de-monitor-de-madera", 1}, {"reposapies-ergonomico", 1}, {"alfombrilla-protectora-para-silla", 1}, {"cajonera-con-ruedas-3-cajones", 1}, {"estanteria-libreria-5-baldas", 1}},
	},
}

func (c *Catalog) buildPacks() {
	for _, def := range packDefs {
		pack := def
		pack.Lines = c.Lines(def.Items)
		pack.Total = LinesTotal(pack.Lines)
		c.packs = append(c.packs, pack)
	}
}

// Lines resolves skus against the catalog; unknown skus are dropped.
func (c *Catalog) Lines(items []PackItem) []Line {
	var out []Line
	for _, it := range items {
		if p := c.bySKU[it.SKU]; p != nil {
			out = append(out, Line{p, it.Qty})
		}
	}
	return out
}

// LinesTotal adds the lines in integer cents, so the total is exact to the cent.
func LinesTotal(lines []Line) float64 {
	var cents int64
	for _, l := range lines {
		cents += int64(l.Quantity) * l.Product.PriceCents()
	}
	return float64(cents) / 100
}

// PriceCents is the price in integer cents.
func (p *Product) PriceCents() int64 {
	if p.Price >= 0 {
		return int64(p.Price*100 + 0.5)
	}
	return -int64(-p.Price*100 + 0.5)
}

// Packs returns every pack.
func (c *Catalog) Packs() []Pack { return c.packs }

// GetPack returns the pack with that id, or nil.
func (c *Catalog) GetPack(id string) *Pack {
	for i := range c.packs {
		if c.packs[i].ID == id {
			return &c.packs[i]
		}
	}
	return nil
}
