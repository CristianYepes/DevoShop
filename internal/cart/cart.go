// Package cart stores the cart in an HMAC-signed cookie: it works across Cloud Run instances
// with no database. It only holds [sku, quantity]; names and prices always come from the
// catalog.
package cart

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math"
	"strings"

	"github.com/CristianYepes/DevoShop/internal/catalog"
	"github.com/CristianYepes/DevoShop/internal/textx"
)

const (
	// MaxLines keeps the cookie well under 4 KB.
	MaxLines = 40
	// MaxQty is the most units of one product per line.
	MaxQty = 20
	// CookieName is the cart cookie.
	CookieName = "hk_carrito"
)

// Entry is one cart line as stored in the cookie.
type Entry struct {
	SKU string
	Qty int
}

var b64 = base64.RawURLEncoding

// Sign is the base64url HMAC-SHA256 of data.
func Sign(secret, data string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(data))
	return b64.EncodeToString(m.Sum(nil))
}

// Read decodes the cookie value. An unsigned, tampered or malformed cookie is an empty cart.
func Read(secret, value string, cat *catalog.Catalog) []Entry {
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ".")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return nil
	}
	data, mac := parts[0], parts[1]
	if !hmac.Equal([]byte(Sign(secret, data)), []byte(mac)) {
		return nil
	}
	raw, err := b64.DecodeString(data)
	if err != nil {
		return nil
	}
	var doc struct {
		L [][]json.RawMessage `json:"l"`
	}
	if json.Unmarshal(raw, &doc) != nil {
		return nil
	}
	var out []Entry
	for _, pair := range doc.L {
		if len(pair) < 2 {
			continue
		}
		var sku string
		var q float64
		if json.Unmarshal(pair[0], &sku) != nil || json.Unmarshal(pair[1], &q) != nil {
			continue
		}
		if cat.Get(sku) != nil && q == math.Trunc(q) && q > 0 && q <= MaxQty {
			out = append(out, Entry{sku, int(q)})
		}
	}
	return out[:min(len(out), MaxLines)]
}

// Cookie is the Set-Cookie value for these lines.
func Cookie(secret string, lines []Entry) string {
	pairs := make([][]any, len(lines))
	for i, l := range lines {
		pairs[i] = []any{l.SKU, l.Qty}
	}
	raw, _ := catalog.MarshalJSON(map[string]any{"l": pairs})
	data := b64.EncodeToString(raw)
	return CookieName + "=" + data + "." + Sign(secret, data) + "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400"
}

// ValidQty parses a form quantity like parseInt and clamps it to 0..MaxQty; garbage is 1.
func ValidQty(v string) int {
	s := strings.TrimLeftFunc(v, textx.IsJSSpace)
	neg := false
	if s != "" && (s[0] == '+' || s[0] == '-') {
		neg = s[0] == '-'
		s = s[1:]
	}
	n, digits := 0, 0
	for _, r := range s {
		if r < '0' || r > '9' {
			break
		}
		digits++
		if n <= MaxQty {
			n = n*10 + int(r-'0')
		}
	}
	if digits == 0 {
		return 1
	}
	if neg {
		return 0
	}
	return min(n, MaxQty)
}

// Add adds quantity to a sku, merging lines. Unknown skus are ignored.
func Add(lines []Entry, sku string, qty int, cat *catalog.Catalog) []Entry {
	if cat.Get(sku) == nil || qty < 1 {
		return lines
	}
	out := append([]Entry(nil), lines...)
	for i := range out {
		if out[i].SKU == sku {
			out[i].Qty = min(out[i].Qty+qty, MaxQty)
			return out
		}
	}
	if len(out) >= MaxLines {
		return out
	}
	return append(out, Entry{sku, min(qty, MaxQty)})
}

// SetQty sets the quantity of a sku; 0 removes the line.
func SetQty(lines []Entry, sku string, qty int) []Entry {
	var out []Entry
	for _, l := range lines {
		if l.SKU == sku {
			if qty < 1 {
				continue
			}
			l.Qty = qty
		}
		out = append(out, l)
	}
	return out
}

// Summary is the cart with catalog data and the total, computed in integer cents.
type Summary struct {
	Items []catalog.Line
	Total float64
	Units int
}

// Summarize resolves the lines against the catalog.
func Summarize(lines []Entry, cat *catalog.Catalog) Summary {
	var s Summary
	for _, l := range lines {
		if p := cat.Get(l.SKU); p != nil {
			s.Items = append(s.Items, catalog.Line{Product: p, Quantity: l.Qty})
			s.Units += l.Qty
		}
	}
	s.Total = catalog.LinesTotal(s.Items)
	return s
}
