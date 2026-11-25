package catalog

// Supplier data cleaning. Rules from db/data/LEEME.md:
//  - A product listed by both suppliers is sold once, with the data of the most recent update.
//  - Discontinued products are not sold.
//  - Prices include VAT (21 %), in euros with two decimals.
//  - Measurements are in centimetres.

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"math"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"

	"github.com/CristianYepes/DevoShop/internal/textx"
)

const iva = 1.21

// Vocabularies from LEEME.md.
var (
	Categorias = []string{"sofa", "cama", "colchon", "mesa", "silla", "escritorio", "silla_oficina", "almacenaje", "iluminacion", "textil", "accesorio"}
	Colores    = []string{"blanco", "negro", "gris", "beige", "marron", "azul", "verde", "roble", "nogal", "natural"}
	Materiales = []string{"tela", "lino", "piel", "terciopelo", "madera", "metal", "melamina", "espuma", "muelles", "algodon", "lana", "malla", "ceramica"}
)

var categoriaA = map[string]string{
	"SOFAS Y SILLONES":   "sofa",
	"DORMITORIO / CAMAS": "cama",
	"DESCANSO":           "colchon",
	"COMEDOR - MESAS":    "mesa",
	"COMEDOR - SILLAS":   "silla",
	"DESPACHO":           "escritorio",
	"DESPACHO - SILLAS":  "silla_oficina",
	"ALMACENAJE":         "almacenaje",
	"ILUMINACION":        "iluminacion",
	"TEXTIL HOGAR":       "textil",
	"ACCESORIOS":         "accesorio",
}

var categoriaB = map[string]string{
	"sofa": "sofa", "bed": "cama", "mattress": "colchon", "dining_table": "mesa", "dining_chair": "silla",
	"desk": "escritorio", "office_chair": "silla_oficina", "storage": "almacenaje", "lighting": "iluminacion",
	"textile": "textil", "accessory": "accesorio",
}

var colorB = map[string]string{
	"white": "blanco", "black": "negro", "grey": "gris", "gray": "gris", "beige": "beige", "brown": "marron",
	"blue": "azul", "green": "verde", "oak": "roble", "walnut": "nogal", "natural": "natural",
}

var materialB = map[string]string{
	"fabric": "tela", "linen": "lino", "leather": "piel", "velvet": "terciopelo", "wood": "madera", "metal": "metal",
	"melamine": "melamina", "foam": "espuma", "pocket springs": "muelles", "springs": "muelles",
	"cotton": "algodon", "wool": "lana", "mesh": "malla", "ceramic": "ceramica",
}

// record is one supplier row, already translated to the store vocabulary.
type record struct {
	id, nombre, categoria string
	precio                float64
	ancho, fondo, alto    float64
	plazas                int // 0 = not a sofa or not stated
	descripcion           string
	color, material       string
	activo                bool
	actualizado           time.Time
}

// Cleaned is a sellable product as it comes out of the merge.
type Cleaned struct {
	record
	SKU       string
	IDsOrigen []string
}

// ---------- helpers ----------

// norm: no accents, lower case, single spaces.
func norm(s string) string {
	return textx.Trim(textx.CollapseSpaces(strings.ToLower(textx.StripAccents(s))))
}

// Suppliers round the net price to cents before we add VAT, so the gross can be off by up to
// ±0.006 € (354,55 × 1,21 = 429,0055). Snap to the nearest 10 cents when we are that close to
// it; otherwise keep the exact cents (890 × 1,21 = 1076,90).
func withIva(price float64, included bool) float64 {
	if included {
		return textx.Round2(price)
	}
	gross := price * iva
	tenth := math.Floor(gross*10+0.5) / 10
	if math.Abs(gross-tenth) <= 0.0061 {
		return textx.Round2(tenth)
	}
	return textx.Round2(gross)
}

var (
	numWords   = map[string]int{"una": 1, "un": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5}
	plazasRe   = regexp.MustCompile(`\b(\d+|una|un|dos|tres|cuatro|cinco) plazas?\b`)
	plazasReCI = regexp.MustCompile(`(?i)\b(\d+|una|un|dos|tres|cuatro|cinco) plazas?\b`)
	upperPlaza = regexp.MustCompile(`\bPLAZAS?\b`)
	nonSlug    = regexp.MustCompile(`[^a-z0-9]+`)
	medidasA   = regexp.MustCompile(`(?i)^([\d.,]+)[` + textx.JSSpace + `]*x[` + textx.JSSpace + `]*([\d.,]+)[` + textx.JSSpace + `]*x[` + textx.JSSpace + `]*([\d.,]+)[` + textx.JSSpace + `]*(cm|m|mm)$`)
	medidasB   = regexp.MustCompile(`(?i)Medidas:[` + textx.JSSpace + `]*([\d.,]+)[` + textx.JSSpace + `]*x[` + textx.JSSpace + `]*([\d.,]+)[` + textx.JSSpace + `]*x[` + textx.JSSpace + `]*([\d.,]+)[` + textx.JSSpace + `]*cm`)
)

func parsePlazas(text string) int {
	m := plazasRe.FindStringSubmatch(norm(text))
	if m == nil {
		return 0
	}
	if n, ok := numWords[m[1]]; ok {
		return n
	}
	n, _ := strconv.Atoi(m[1])
	return n
}

// matchKey detects the same product in both catalogues: the name without the seat count.
func matchKey(name string) string {
	return textx.Trim(textx.CollapseSpaces(plazasRe.ReplaceAllString(norm(name), "")))
}

func slug(s string) string {
	return strings.Trim(nonSlug.ReplaceAllString(norm(s), "-"), "-")
}

// tidyName: "SOFÁ NÓRDICO 3 PLAZAS" -> "Sofá nórdico 3 plazas".
func tidyName(name string) string {
	n := upperPlaza.ReplaceAllStringFunc(textx.Trim(textx.CollapseSpaces(name)), strings.ToLower)
	if n != strings.ToUpper(n) {
		return n
	}
	lower := []rune(strings.ToLower(n))
	if len(lower) == 0 {
		return ""
	}
	return strings.ToUpper(string(lower[0])) + string(lower[1:])
}

// jsNumber parses a decimal with a comma like Number(v.replace(',', '.')) (first comma only).
func jsNumber(v string) (float64, error) {
	return strconv.ParseFloat(strings.Replace(v, ",", ".", 1), 64)
}

// parseMedidasA: "1,50 x 0,60 x 2,00 m" | "160x230x1 cm" -> ancho, fondo, alto in cm.
func parseMedidasA(s string) ([3]float64, error) {
	var out [3]float64
	m := medidasA.FindStringSubmatch(textx.Trim(s))
	if m == nil {
		return out, fmt.Errorf("medidas no reconocidas: %s", s)
	}
	factor := map[string]float64{"m": 100, "cm": 1, "mm": 0.1}[strings.ToLower(m[4])]
	for i := range 3 {
		v, err := jsNumber(m[i+1])
		if err != nil {
			return out, fmt.Errorf("medidas no reconocidas: %s", s)
		}
		out[i] = textx.Round2(v * factor)
	}
	return out, nil
}

func check(value string, allowed []string, what, id string) (string, error) {
	if !slices.Contains(allowed, value) {
		return "", fmt.Errorf("%s: %s desconocido %q", id, what, value)
	}
	return value, nil
}

// ---------- supplier A (CSV, latin-1, ';' separated, decimal comma) ----------

func latin1(b []byte) string {
	r := make([]rune, len(b))
	for i, c := range b {
		r[i] = rune(c)
	}
	return string(r)
}

func nonEmptyLines(text string) []string {
	var out []string
	for _, l := range strings.Split(text, "\n") {
		l = strings.TrimSuffix(l, "\r")
		if textx.Trim(l) != "" {
			out = append(out, l)
		}
	}
	return out
}

func loadA(fsys fs.FS) ([]record, error) {
	raw, err := fs.ReadFile(fsys, "proveedor-a.csv")
	if err != nil {
		return nil, err
	}
	lines := nonEmptyLines(latin1(raw))
	if len(lines) == 0 {
		return nil, fmt.Errorf("proveedor-a.csv vacío")
	}
	cols := strings.Split(lines[0], ";")
	var out []record
	for _, line := range lines[1:] {
		r := map[string]string{}
		for i, v := range strings.Split(line, ";") {
			if i < len(cols) {
				r[cols[i]] = textx.Trim(v)
			}
		}
		id := r["REF"]
		rec := record{id: id, nombre: tidyName(r["DESCRIPCION"])}
		if rec.categoria, err = check(categoriaA[strings.ToUpper(textx.StripAccents(r["FAMILIA"]))], Categorias, "categoria", id); err != nil {
			return nil, err
		}
		pvp, err := jsNumber(strings.ReplaceAll(r["PVP"], ".", ""))
		if err != nil {
			return nil, fmt.Errorf("%s: PVP %q", id, r["PVP"])
		}
		rec.precio = withIva(pvp, r["IVA_INCL"] == "S")
		med, err := parseMedidasA(r["MEDIDAS"])
		if err != nil {
			return nil, fmt.Errorf("%s: %w", id, err)
		}
		rec.ancho, rec.fondo, rec.alto = med[0], med[1], med[2]
		if rec.categoria == "sofa" {
			rec.plazas = parsePlazas(r["DESCRIPCION"])
		}
		if rec.color, err = check(norm(r["COLOR"]), Colores, "color", id); err != nil {
			return nil, err
		}
		if rec.material, err = check(norm(r["ACABADO"]), Materiales, "material", id); err != nil {
			return nil, err
		}
		rec.activo = strings.ToUpper(r["ESTADO"]) == "ACTIVO"
		if rec.actualizado, err = time.Parse("2/1/2006", r["F_ACT"]); err != nil {
			return nil, fmt.Errorf("%s: fecha %q", id, r["F_ACT"])
		}
		out = append(out, rec)
	}
	return out, nil
}

// ---------- supplier B (JSON, English vocab, mixed units) ----------

type productoB struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Category    string  `json:"category"`
	PriceCents  float64 `json:"price_cents"`
	Currency    string  `json:"currency"`
	TaxIncluded bool    `json:"tax_included"`
	Color       string  `json:"color"`
	Material    string  `json:"material"`
	Description string  `json:"description"`
	Dimensions  *struct {
		W, D, H float64
		Unit    string `json:"unit"`
	} `json:"dimensions"`
	Status    string    `json:"status"`
	UpdatedAt time.Time `json:"updated_at"`
}

func loadB(fsys fs.FS) ([]record, error) {
	raw, err := fs.ReadFile(fsys, "proveedor-b.json")
	if err != nil {
		return nil, err
	}
	var doc struct {
		Products []productoB `json:"products"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("proveedor-b.json: %w", err)
	}
	var out []record
	for _, p := range doc.Products {
		id := p.ID
		rec := record{id: id, nombre: textx.Trim(p.Title), descripcion: textx.Trim(p.Description)}
		if rec.categoria, err = check(categoriaB[p.Category], Categorias, "categoria", id); err != nil {
			return nil, err
		}
		if p.Dimensions != nil {
			f, ok := map[string]float64{"mm": 0.1, "cm": 1, "m": 100}[p.Dimensions.Unit]
			if !ok {
				return nil, fmt.Errorf("%s: unidad %q", id, p.Dimensions.Unit)
			}
			rec.ancho, rec.fondo, rec.alto = textx.Round2(p.Dimensions.W*f), textx.Round2(p.Dimensions.D*f), textx.Round2(p.Dimensions.H*f)
		} else {
			m := medidasB.FindStringSubmatch(p.Description)
			if m == nil {
				return nil, fmt.Errorf("%s: sin medidas", id)
			}
			var dims [3]float64
			for i := range 3 {
				if dims[i], err = jsNumber(m[i+1]); err != nil {
					return nil, fmt.Errorf("%s: medidas %q", id, m[0])
				}
			}
			rec.ancho, rec.fondo, rec.alto = dims[0], dims[1], dims[2]
		}
		if p.Currency != "EUR" {
			return nil, fmt.Errorf("%s: moneda %s", id, p.Currency)
		}
		rec.precio = withIva(p.PriceCents/100, p.TaxIncluded)
		if rec.categoria == "sofa" {
			if rec.plazas = parsePlazas(p.Description); rec.plazas == 0 {
				rec.plazas = parsePlazas(p.Title)
			}
		}
		if rec.color, err = check(colorB[p.Color], Colores, "color", id); err != nil {
			return nil, err
		}
		if rec.material, err = check(materialB[p.Material], Materiales, "material", id); err != nil {
			return nil, err
		}
		rec.activo = p.Status == "active"
		rec.actualizado = p.UpdatedAt
		out = append(out, rec)
	}
	return out, nil
}

// ---------- merge ----------

// BuildCatalog merges both suppliers. It returns the sellable products, sorted by category and
// name, and the supplier ids of the discontinued ones.
func BuildCatalog(fsys fs.FS) (productos []Cleaned, descartados [][]string, err error) {
	a, err := loadA(fsys)
	if err != nil {
		return nil, nil, err
	}
	b, err := loadB(fsys)
	if err != nil {
		return nil, nil, err
	}

	var keys []string
	groups := map[string][]record{}
	for _, rec := range append(a, b...) {
		k := matchKey(rec.nombre)
		if _, ok := groups[k]; !ok {
			keys = append(keys, k)
		}
		groups[k] = append(groups[k], rec)
	}

	shouted := func(r record) bool { return r.nombre == tidyName(strings.ToUpper(r.nombre)) }
	usedSkus := map[string]bool{}
	for _, k := range keys {
		recs := groups[k]
		sort.SliceStable(recs, func(i, j int) bool { return recs[i].actualizado.After(recs[j].actualizado) })
		latest := recs[0]
		ids := make([]string, len(recs))
		for i, r := range recs {
			ids[i] = r.id
		}
		sort.Strings(ids)
		if !latest.activo {
			descartados = append(descartados, ids)
			continue
		}
		sku := slug(plazasReCI.ReplaceAllString(latest.nombre, ""))
		for i, base := 2, sku; usedSkus[sku]; i++ {
			sku = fmt.Sprintf("%s-%d", base, i)
		}
		usedSkus[sku] = true

		// Name: newest record, unless it was shouted in capitals and the other supplier has a proper one.
		p := Cleaned{record: latest, SKU: sku, IDsOrigen: ids}
		if shouted(latest) {
			for _, r := range recs {
				if !shouted(r) {
					p.nombre = r.nombre
					break
				}
			}
		}
		if p.descripcion == "" {
			for _, r := range recs {
				if r.descripcion != "" {
					p.descripcion = r.descripcion
					break
				}
			}
		}
		productos = append(productos, p)
	}

	col := collate.New(language.Spanish)
	sort.SliceStable(productos, func(i, j int) bool {
		if c := strings.Compare(productos[i].categoria, productos[j].categoria); c != 0 {
			return c < 0
		}
		return col.CompareString(productos[i].nombre, productos[j].nombre) < 0
	})
	return productos, descartados, nil
}

// venta is one line of historial-ventas.csv.
type venta struct {
	pedido, idOrigen string
	cantidad         int
}

func loadHistorial(fsys fs.FS) ([]venta, error) {
	raw, err := fs.ReadFile(fsys, "historial-ventas.csv")
	if err != nil {
		return nil, err
	}
	lines := nonEmptyLines(string(raw))
	var out []venta
	for _, l := range lines[min(1, len(lines)):] {
		f := strings.Split(l, ",")
		if len(f) < 4 {
			continue
		}
		n, err := strconv.Atoi(textx.Trim(f[3]))
		if err != nil {
			return nil, fmt.Errorf("historial: cantidad %q", f[3])
		}
		out = append(out, venta{pedido: textx.Trim(f[0]), idOrigen: textx.Trim(f[2]), cantidad: n})
	}
	return out, nil
}
