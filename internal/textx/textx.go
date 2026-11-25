// Package textx holds the small text helpers shared by the catalog, the search and the
// assistant. They reproduce the JavaScript behaviour the store was first written with
// (String.prototype.trim, the \s class, NFD accent stripping, number formatting), so the
// Go server publishes exactly the same catalog, prices and answers.
package textx

import (
	"math"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// JSSpace is the body of a regexp character class matching what JavaScript's \s matches.
// Go's \s is ASCII-only, and prices are formatted with a no-break space (U+00A0).
const JSSpace = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

// IsJSSpace reports whether r is whitespace for JavaScript's trim() and \s.
func IsJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// Trim is JavaScript's String.prototype.trim.
func Trim(s string) string { return strings.TrimFunc(s, IsJSSpace) }

// CollapseSpaces replaces every run of whitespace with one space (JS: s.replace(/\s+/g, ' ')).
func CollapseSpaces(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	inSpace := false
	for _, r := range s {
		if IsJSSpace(r) {
			if !inSpace {
				b.WriteByte(' ')
			}
			inSpace = true
			continue
		}
		inSpace = false
		b.WriteRune(r)
	}
	return b.String()
}

// StripAccents decomposes (NFD) and drops the combining marks: "Lámpara" -> "Lampara".
func StripAccents(s string) string {
	out, _, err := transform.String(transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn))), s)
	if err != nil {
		return s
	}
	return out
}

// Fold lower-cases and strips accents: "Sofá NÓRDICO" -> "sofa nordico".
func Fold(s string) string { return StripAccents(strings.ToLower(s)) }

// Truncate keeps the first n characters (JS: s.slice(0, n)).
func Truncate(s string, n int) string {
	if n <= 0 {
		return ""
	}
	i := 0
	for pos := range s {
		if i == n {
			return s[:pos]
		}
		i++
	}
	return s
}

// RuneLen is the length in characters.
func RuneLen(s string) int { return len([]rune(s)) }

// Num formats a number the way JavaScript prints it in a template literal: 150, 60.5, 1076.9.
func Num(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

// Round2 is Math.round(n * 100) / 100 (half rounds up, like JavaScript).
func Round2(n float64) float64 { return math.Floor(n*100+0.5) / 100 }

// Cents converts euros to integer cents (JS: Math.round(n * 100)).
func Cents(n float64) int64 { return int64(math.Floor(n*100 + 0.5)) }

// EUR formats a price like Intl.NumberFormat('es-ES', {style: 'currency', currency: 'EUR',
// useGrouping: 'always'}): "1.698,00 €", with a no-break space before the euro sign.
func EUR(n float64) string {
	c := Cents(n)
	sign := ""
	if c < 0 {
		sign, c = "-", -c
	}
	euros := strconv.FormatInt(c/100, 10)
	var b strings.Builder
	for i, d := range euros {
		if i > 0 && (len(euros)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(d)
	}
	cents := c % 100
	return sign + b.String() + "," + string(rune('0'+cents/10)) + string(rune('0'+cents%10)) + " €"
}

// Stem drops a plural ending (JS: w.replace(/(es|s)$/, ”)).
func Stem(w string) string {
	if strings.HasSuffix(w, "es") {
		return w[:len(w)-2]
	}
	return strings.TrimSuffix(w, "s")
}

// Tokens folds s and splits it on anything that is not [a-z0-9].
func Tokens(s string) []string {
	return strings.FieldsFunc(Fold(s), func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9')
	})
}
