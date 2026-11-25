package knowledge

import (
	"fmt"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

var spanishStopwords = map[string]bool{
	"a": true, "al": true, "algo": true, "algun": true, "alguna": true, "algunas": true, "algunos": true,
	"ante": true, "como": true, "con": true, "cual": true, "cuales": true, "cuando": true, "cuanto": true,
	"cuanta": true, "cuantas": true, "cuantos": true, "cuesta": true, "cuestan": true, "de": true, "del": true,
	"desde": true, "donde": true, "e": true, "el": true, "ella": true, "ellas": true, "ellos": true,
	"en": true, "entre": true, "era": true, "es": true, "esa": true, "esas": true, "ese": true, "eso": true,
	"esos": true, "esta": true, "estan": true, "estas": true, "este": true, "esto": true, "estos": true,
	"ha": true, "hay": true, "hola": true, "la": true, "las": true, "le": true, "les": true, "lo": true,
	"los": true, "mas": true, "me": true, "mi": true, "mis": true, "mucho": true, "muy": true, "no": true,
	"nos": true, "o": true, "os": true, "para": true, "pero": true, "por": true, "porque": true, "puede": true,
	"pueden": true, "puedo": true, "que": true, "quien": true, "se": true, "ser": true, "si": true, "sin": true,
	"sobre": true, "son": true, "su": true, "sus": true, "te": true, "teneis": true, "tenemos": true,
	"tengo": true, "tiene": true, "tienen": true, "tu": true, "tus": true, "u": true, "un": true, "una": true,
	"unas": true, "uno": true, "unos": true, "vale": true, "valen": true, "vendeis": true, "venden": true,
	"vuestro": true, "vuestra": true, "y": true, "ya": true, "yo": true,
	"tienda": true, "devoshop": true, "producto": true, "productos": true, "articulo": true, "articulos": true,
	"precio": true, "precios": true, "coste": true, "costo": true, "disponible": true, "disponibles": true,
}

var conditionTopicHints = []string{
	"envio", "envios", "enviar", "envian", "entrega", "entregar", "entregas", "plazo", "plazos",
	"transporte", "portes", "envio gratis", "domicilio",
	"montaje", "montar", "montan", "armado", "armar", "desmontado", "instalacion",
	"devolucion", "devoluciones", "devolver", "desistimiento", "reembolso", "cambio", "recogida",
	"garantia", "garantias", "defecto", "defectuoso", "avería", "averia",
	"pago", "pagar", "pagos", "tarjeta", "efectivo", "bizum", "paypal", "transferencia", "invitado", "registro",
	"condicion", "condiciones",
}

// Normalize folds Spanish diacritics and lowercases text for reliable matching.
func Normalize(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range strings.ToLower(s) {
		switch r {
		case 'á', 'à', 'ä', 'â':
			b.WriteByte('a')
		case 'é', 'è', 'ë', 'ê':
			b.WriteByte('e')
		case 'í', 'ì', 'ï', 'î':
			b.WriteByte('i')
		case 'ó', 'ò', 'ö', 'ô':
			b.WriteByte('o')
		case 'ú', 'ù', 'ü', 'û':
			b.WriteByte('u')
		case 'ñ':
			b.WriteByte('n')
		case 'ç':
			b.WriteByte('c')
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Tokenize extracts normalized non-stopword alphanumeric tokens.
func Tokenize(s string) []string {
	norm := Normalize(s)
	fields := strings.FieldsFunc(norm, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	seen := make(map[string]struct{}, len(fields))
	tokens := make([]string, 0, len(fields))
	for _, f := range fields {
		if len(f) <= 1 || spanishStopwords[f] {
			continue
		}
		if _, ok := seen[f]; ok {
			continue
		}
		seen[f] = struct{}{}
		tokens = append(tokens, f)
	}
	return tokens
}

// HasStoreIntent checks if a normalized question mentions store concepts, catalog items, or conditions.
func (snap Snapshot) HasStoreIntent(query string) bool {
	norm := Normalize(query)
	for _, hint := range conditionTopicHints {
		if containsWord(norm, hint) {
			return true
		}
	}
	for _, kw := range []string{"catalogo", "mueble", "muebles", "stock", "medida", "medidas", "ancho", "color", "material", "plazas", "precio", "precios", "comprar", "pedido", "sku", "iva", "euro", "euros"} {
		if containsWord(norm, kw) {
			return true
		}
	}
	tokens := Tokenize(query)
	for _, t := range tokens {
		for _, p := range snap.Products {
			if strings.Contains(p.SearchText, t) {
				return true
			}
		}
	}
	return false
}

// SelectRelevantProducts returns up to limit products ordered by relevance to the query.
// If no specific tokens match, it returns an empty slice and matched=false.
func (snap Snapshot) SelectRelevantProducts(query string, limit int) (matched []Product, anyMatch bool) {
	if limit <= 0 || len(snap.Products) == 0 {
		return nil, false
	}
	tokens := Tokenize(query)
	if len(tokens) == 0 {
		if len(snap.Products) <= limit {
			return snap.Products, false
		}
		return snap.Products[:limit], false
	}

	type scoredProduct struct {
		product Product
		score   int
	}
	var scored []scoredProduct
	for _, p := range snap.Products {
		score := scoreProduct(p, tokens)
		if score > 0 {
			scored = append(scored, scoredProduct{product: p, score: score})
		}
	}
	if len(scored) == 0 {
		return nil, false
	}
	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		return scored[i].product.Name < scored[j].product.Name
	})
	if len(scored) > limit {
		scored = scored[:limit]
	}
	out := make([]Product, len(scored))
	for i, s := range scored {
		out[i] = s.product
	}
	return out, true
}

func scoreProduct(p Product, tokens []string) int {
	nameNorm := Normalize(p.Name)
	catNorm := Normalize(p.Category)
	skuNorm := Normalize(p.SKU)
	score := 0
	for _, t := range tokens {
		stem := singularizeSpanish(t)
		switch {
		case skuNorm == t:
			score += 12
		case containsWord(nameNorm, t) || (stem != t && containsWord(nameNorm, stem)):
			score += 6
		case containsWord(catNorm, t) || (stem != t && containsWord(catNorm, stem)):
			score += 4
		case strings.Contains(p.SearchText, t) || (stem != t && strings.Contains(p.SearchText, stem)):
			score += 2
		}
	}
	return score
}

func singularizeSpanish(token string) string {
	if len(token) > 4 && strings.HasSuffix(token, "es") {
		return strings.TrimSuffix(token, "es")
	}
	if len(token) > 3 && strings.HasSuffix(token, "s") {
		return strings.TrimSuffix(token, "s")
	}
	return token
}

func containsWord(haystack, needle string) bool {
	if needle == "" {
		return false
	}
	offset := 0
	for {
		idx := strings.Index(haystack[offset:], needle)
		if idx < 0 {
			return false
		}
		absIdx := offset + idx
		end := absIdx + len(needle)

		leftOK := absIdx == 0
		if !leftOK {
			prevRune, _ := utf8.DecodeLastRuneInString(haystack[:absIdx])
			leftOK = !isWordChar(prevRune)
		}
		rightOK := end == len(haystack)
		if !rightOK {
			nextRune, _ := utf8.DecodeRuneInString(haystack[end:])
			rightOK = !isWordChar(nextRune)
		}
		if leftOK && rightOK {
			return true
		}
		offset = absIdx + 1
		if offset >= len(haystack) {
			return false
		}
	}
}

func isWordChar(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r)
}

// SelectRelevantConditions returns condition sections scored against the query.
func (snap Snapshot) SelectRelevantConditions(query string) []ConditionSection {
	tokens := Tokenize(query)
	normQuery := Normalize(query)

	type scoredSection struct {
		section ConditionSection
		score   int
	}
	var scored []scoredSection
	for _, sec := range snap.Conditions {
		s := 0
		titleNorm := Normalize(sec.Title)
		for _, t := range tokens {
			stem := singularizeSpanish(t)
			if strings.Contains(titleNorm, t) || (stem != t && strings.Contains(titleNorm, stem)) {
				s += 5
			} else if strings.Contains(sec.SearchText, t) || (stem != t && strings.Contains(sec.SearchText, stem)) {
				s += 2
			}
		}
		if strings.Contains(normQuery, "envi") && strings.Contains(titleNorm, "envi") {
			s += 6
		}
		if strings.Contains(normQuery, "mont") && strings.Contains(titleNorm, "mont") {
			s += 6
		}
		if (strings.Contains(normQuery, "devol") || strings.Contains(normQuery, "desist")) && strings.Contains(titleNorm, "devol") {
			s += 6
		}
		if strings.Contains(normQuery, "garant") && strings.Contains(titleNorm, "garant") {
			s += 6
		}
		if strings.Contains(normQuery, "pag") && strings.Contains(titleNorm, "pag") {
			s += 6
		}
		if s > 0 {
			scored = append(scored, scoredSection{section: sec, score: s})
		}
	}
	sort.SliceStable(scored, func(i, j int) bool {
		return scored[i].score > scored[j].score
	})
	out := make([]ConditionSection, len(scored))
	for i, item := range scored {
		out[i] = item.section
	}
	return out
}

// FormatProductLine renders one compact line with all factual attributes of a product.
func FormatProductLine(p Product) string {
	var parts []string
	if p.SKU != "" {
		parts = append(parts, "["+p.SKU+"] "+p.Name)
	} else {
		parts = append(parts, p.Name)
	}
	if p.Category != "" {
		parts = append(parts, "categoría: "+p.Category)
	}
	if p.HasPrice {
		parts = append(parts, "precio (IVA incl.): "+FormatPrice(p.Price))
	}
	if p.Plazas > 0 {
		parts = append(parts, fmt.Sprintf("%d plazas", p.Plazas))
	}
	if p.AnchoCM > 0 {
		parts = append(parts, "ancho: "+FormatNumber(p.AnchoCM)+" cm")
	}
	if p.Dimensions != "" {
		parts = append(parts, "medidas: "+p.Dimensions)
	}
	if p.Color != "" {
		parts = append(parts, "color: "+p.Color)
	}
	if p.Material != "" {
		parts = append(parts, "material: "+p.Material)
	}
	if p.Description != "" {
		parts = append(parts, p.Description)
	}
	return "- " + strings.Join(parts, " | ")
}

// BuildLocalAnswer generates a grounded deterministic answer without calling an external LLM.
func (snap Snapshot) BuildLocalAnswer(query string) string {
	conds := snap.SelectRelevantConditions(query)
	prods, matchedProds := snap.SelectRelevantProducts(query, 4)

	if len(conds) > 0 && (!matchedProds || isConditionsQuery(query)) {
		var sb strings.Builder
		limit := len(conds)
		if limit > 2 {
			limit = 2
		}
		for i := 0; i < limit; i++ {
			if i > 0 {
				sb.WriteString("\n")
			}
			sb.WriteString(conds[i].Title)
			sb.WriteString(": ")
			sb.WriteString(conds[i].Body)
		}
		return sb.String()
	}

	if matchedProds && len(prods) > 0 {
		var sb strings.Builder
		sb.WriteString("En el catálogo de DevoShop tenemos:\n")
		for _, p := range prods {
			sb.WriteString(FormatProductLine(p))
			sb.WriteByte('\n')
		}
		return strings.TrimSpace(sb.String())
	}

	if isCatalogOverviewQuery(query) && len(snap.Products) > 0 {
		var sb strings.Builder
		if len(snap.Categories) > 0 {
			sb.WriteString("Disponemos de las categorías: ")
			sb.WriteString(strings.Join(snap.Categories, ", "))
			sb.WriteString(". Algunos productos:\n")
		} else {
			sb.WriteString("Algunos productos de nuestro catálogo:\n")
		}
		limit := len(snap.Products)
		if limit > 4 {
			limit = 4
		}
		for i := 0; i < limit; i++ {
			sb.WriteString(FormatProductLine(snap.Products[i]))
			sb.WriteByte('\n')
		}
		return strings.TrimSpace(sb.String())
	}

	return "No consta ese producto o dato en el catálogo ni en las condiciones de venta de DevoShop."
}

func isConditionsQuery(query string) bool {
	norm := Normalize(query)
	for _, hint := range []string{"envi", "montaj", "devol", "desist", "garant", "pag", "condicion"} {
		if strings.Contains(norm, hint) {
			return true
		}
	}
	return false
}

func isCatalogOverviewQuery(query string) bool {
	norm := Normalize(query)
	for _, hint := range []string{"que vendeis", "que teneis", "catalogo", "categorias", "que productos"} {
		if strings.Contains(norm, hint) {
			return true
		}
	}
	return false
}
