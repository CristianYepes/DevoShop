package knowledge

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

const maxRemoteBytes = 10 * 1024 * 1024 // 10 MiB safety limit for catalog/markdown downloads

// Load loads catalog and sales conditions into the Store.
// If a URL is configured, it is tried first; if it fails and a local path exists, it falls back to the file.
func (s *Store) Load(ctx context.Context, cfg Config) error {
	catBytes, err := readSource(ctx, cfg.CatalogURL, cfg.CatalogPath)
	if err != nil {
		return fmt.Errorf("load catalog: %w", err)
	}
	products, err := ParseCatalog(catBytes)
	if err != nil {
		return fmt.Errorf("parse catalog: %w", err)
	}

	condBytes, err := readSource(ctx, cfg.ConditionsURL, cfg.ConditionsPath)
	if err != nil {
		return fmt.Errorf("load conditions: %w", err)
	}
	condRaw := strings.TrimSpace(string(condBytes))
	sections := ParseConditions(condRaw)

	catSet := make(map[string]struct{})
	for _, p := range products {
		if p.Category != "" {
			catSet[p.Category] = struct{}{}
		}
	}
	categories := make([]string, 0, len(catSet))
	for c := range catSet {
		categories = append(categories, c)
	}
	sort.Strings(categories)

	s.mu.Lock()
	s.products = products
	s.categories = categories
	s.conditionsRaw = condRaw
	s.conditions = sections
	s.mu.Unlock()
	return nil
}

func readSource(ctx context.Context, urlStr, filePath string) ([]byte, error) {
	if strings.TrimSpace(urlStr) != "" {
		data, err := fetchURL(ctx, strings.TrimSpace(urlStr))
		if err == nil {
			return data, nil
		}
		if strings.TrimSpace(filePath) == "" {
			return nil, err
		}
		// Fall back to local file when remote source is unavailable at startup.
		localData, localErr := os.ReadFile(strings.TrimSpace(filePath))
		if localErr == nil {
			return localData, nil
		}
		return nil, fmt.Errorf("url failed (%w) and file failed (%v)", err, localErr)
	}
	if strings.TrimSpace(filePath) == "" {
		return nil, fmt.Errorf("no path or url configured")
	}
	return os.ReadFile(strings.TrimSpace(filePath))
}

func fetchURL(ctx context.Context, urlStr string) ([]byte, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, urlStr, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("unexpected HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, maxRemoteBytes))
}

// ParseCatalog parses catalogo.json whether it is a JSON array or an object wrapping a product list.
func ParseCatalog(data []byte) ([]Product, error) {
	var raw any
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}

	var list []any
	switch v := raw.(type) {
	case []any:
		list = v
	case map[string]any:
		for _, key := range []string{"products", "productos", "items", "catalogo", "catalog", "data"} {
			if arr, ok := findKeyCaseInsensitive(v, key).([]any); ok {
				list = arr
				break
			}
		}
		if list == nil {
			return nil, fmt.Errorf("catalog JSON object does not contain a product array")
		}
	default:
		return nil, fmt.Errorf("catalog JSON must be an array or object")
	}

	products := make([]Product, 0, len(list))
	for _, item := range list {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		products = append(products, normalizeProduct(m))
	}
	return products, nil
}

func normalizeProduct(m map[string]any) Product {
	p := Product{
		SKU:         firstString(m, "sku", "id", "codigo", "code", "ref"),
		Name:        firstString(m, "name", "nombre", "title", "titulo", "producto"),
		Category:    firstString(m, "category", "categoria", "tipo", "type"),
		Color:       firstString(m, "color", "colour"),
		Material:    firstString(m, "material", "materials", "materiales"),
		Dimensions:  firstString(m, "dimensions", "dimensiones", "medidas", "size", "tamano"),
		Description: firstString(m, "description", "descripcion", "detalle", "detalles"),
		Extra:       make(map[string]string),
	}

	if price, ok := firstFloat(m, "price", "precio", "precio_iva", "precio_con_iva", "unit_price", "pvp"); ok {
		p.Price = price
		p.HasPrice = true
	}
	if plazas, ok := firstFloat(m, "plazas", "seats", "num_plazas"); ok {
		p.Plazas = int(plazas)
	}
	if ancho, ok := firstFloat(m, "ancho_cm", "ancho", "width_cm", "width"); ok {
		p.AnchoCM = ancho
	}

	known := map[string]bool{
		"sku": true, "id": true, "codigo": true, "code": true, "ref": true,
		"name": true, "nombre": true, "title": true, "titulo": true, "producto": true,
		"category": true, "categoria": true, "tipo": true, "type": true,
		"price": true, "precio": true, "precio_iva": true, "precio_con_iva": true, "unit_price": true, "pvp": true,
		"plazas": true, "seats": true, "num_plazas": true,
		"ancho_cm": true, "ancho": true, "width_cm": true, "width": true,
		"color": true, "colour": true,
		"material": true, "materials": true, "materiales": true,
		"dimensions": true, "dimensiones": true, "medidas": true, "size": true, "tamano": true,
		"description": true, "descripcion": true, "detalle": true, "detalles": true,
	}

	var extraSearch []string
	for k, v := range m {
		if known[strings.ToLower(k)] || v == nil {
			continue
		}
		str := scalarToString(v)
		if str != "" {
			p.Extra[k] = str
			extraSearch = append(extraSearch, k+" "+str)
		}
	}

	var sb strings.Builder
	for _, part := range []string{
		p.SKU, p.Name, p.Category, p.Color, p.Material, p.Dimensions, p.Description,
	} {
		if part != "" {
			sb.WriteString(part)
			sb.WriteByte(' ')
		}
	}
	if p.Plazas > 0 {
		sb.WriteString(strconv.Itoa(p.Plazas))
		sb.WriteString(" plazas ")
	}
	if p.AnchoCM > 0 {
		sb.WriteString(FormatNumber(p.AnchoCM))
		sb.WriteString(" cm ")
	}
	for _, e := range extraSearch {
		sb.WriteString(e)
		sb.WriteByte(' ')
	}
	p.SearchText = Normalize(sb.String())
	return p
}

func findKeyCaseInsensitive(m map[string]any, target string) any {
	for k, v := range m {
		if strings.EqualFold(k, target) {
			return v
		}
	}
	return nil
}

func firstString(m map[string]any, keys ...string) string {
	for _, k := range keys {
		v := findKeyCaseInsensitive(m, k)
		if v == nil {
			continue
		}
		s := strings.TrimSpace(scalarToString(v))
		if s != "" {
			return s
		}
	}
	return ""
}

func firstFloat(m map[string]any, keys ...string) (float64, bool) {
	for _, k := range keys {
		v := findKeyCaseInsensitive(m, k)
		if v == nil {
			continue
		}
		switch n := v.(type) {
		case float64:
			return n, true
		case int:
			return float64(n), true
		case string:
			clean := strings.TrimSpace(n)
			clean = strings.TrimSuffix(clean, "€")
			clean = strings.TrimSuffix(clean, "EUR")
			clean = strings.TrimSpace(clean)
			clean = strings.ReplaceAll(clean, ",", ".")
			if f, err := strconv.ParseFloat(clean, 64); err == nil {
				return f, true
			}
		}
	}
	return 0, false
}

func scalarToString(v any) string {
	switch val := v.(type) {
	case string:
		return val
	case float64:
		return FormatNumber(val)
	case bool:
		if val {
			return "sí"
		}
		return "no"
	default:
		b, err := json.Marshal(val)
		if err != nil {
			return ""
		}
		return string(b)
	}
}

// ParseConditions splits a markdown document into heading-delimited sections.
func ParseConditions(md string) []ConditionSection {
	lines := strings.Split(strings.ReplaceAll(md, "\r\n", "\n"), "\n")
	var sections []ConditionSection
	var currentTitle string
	var bodyLines []string

	flush := func() {
		body := strings.TrimSpace(strings.Join(bodyLines, "\n"))
		if currentTitle != "" || body != "" {
			title := currentTitle
			if title == "" {
				title = "Condiciones generales"
			}
			sections = append(sections, ConditionSection{
				Title:      title,
				Body:       body,
				SearchText: Normalize(title + " " + body),
			})
		}
		bodyLines = nil
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			flush()
			currentTitle = strings.TrimSpace(strings.TrimLeft(trimmed, "#"))
			continue
		}
		bodyLines = append(bodyLines, line)
	}
	flush()
	return sections
}

// FormatPrice formats a EUR price using Spanish decimal comma when fractional, or clean decimals.
func FormatPrice(price float64) string {
	s := fmt.Sprintf("%.2f", price)
	s = strings.ReplaceAll(s, ".", ",")
	return s + " €"
}

// FormatNumber formats a float without unnecessary trailing zeros.
func FormatNumber(n float64) string {
	return strconv.FormatFloat(n, 'f', -1, 64)
}
