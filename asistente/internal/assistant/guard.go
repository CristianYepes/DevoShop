package assistant

import (
	"regexp"
	"strings"
	"unicode/utf8"

	"devoshop/asistente/internal/knowledge"
)

const (
	// MaxResponseRunes keeps every answer strictly below the 1,500-character ceiling.
	MaxResponseRunes = 1450
	// MaxResponsePrices guarantees at most 4 prices appear in any assistant response.
	MaxResponsePrices = 4
	// RefusalText is returned for off-topic or prompt-injection attempts.
	RefusalText = "Solo puedo responder consultas sobre los productos del catálogo y las condiciones de venta de DevoShop."
)

var pricePattern = regexp.MustCompile(`(?i)(?:\d{1,3}(?:[.\s]\d{3})*|\d+)(?:[.,]\d{1,2})?\s*(?:€|(?:eur|euros)\b)|(?:€|EUR)\s*\d+(?:[.,]\d{1,2})?`)

var injectionMarkers = []string{
	"ignora las instrucciones",
	"ignora tus instrucciones",
	"ignora todas las instrucciones",
	"ignora lo anterior",
	"ignora el prompt",
	"ignore previous instructions",
	"ignore all instructions",
	"disregard previous",
	"olvida tus instrucciones",
	"olvida todas tus instrucciones",
	"olvida las reglas",
	"system prompt",
	"prompt del sistema",
	"instrucciones internas",
	"instrucciones del sistema",
	"revela tu prompt",
	"muestra tu prompt",
	"dime tu prompt",
	"developer mode",
	"modo desarrollador",
	"jailbreak",
	"clave_equipo",
	"gemini_api_key",
	"variable de entorno",
	"variables de entorno",
	"actua como",
	"finge ser",
	"comportate como",
	"eres ahora",
	"dan mode",
	"<script",
	"drop table",
}

var offTopicMarkers = []string{
	"dime un chiste",
	"cuentame un chiste",
	"escribe un poema",
	"hazme un poema",
	"escribe codigo",
	"programa en",
	"capital de francia",
	"presidente de",
	"receta de",
	"traduce al",
	"resuelve esta ecuacion",
}

// IsInjectionOrOffTopic detects prompt-injection attempts or clearly unrelated non-store requests.
func IsInjectionOrOffTopic(question string, hasStoreIntent bool) bool {
	norm := knowledge.Normalize(question)
	for _, marker := range injectionMarkers {
		if strings.Contains(norm, marker) {
			return true
		}
	}
	if !hasStoreIntent {
		for _, marker := range offTopicMarkers {
			if strings.Contains(norm, marker) {
				return true
			}
		}
	}
	return false
}

// EnforceResponseLimits guarantees in code that every answer has <= 4 prices and < 1,500 chars.
func EnforceResponseLimits(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return "No consta ese producto o dato en el catálogo ni en las condiciones de venta de DevoShop."
	}

	// Strip accidental XML wrapper tags if an LLM echoes prompt delimiters.
	text = strings.ReplaceAll(text, "<pregunta_cliente>", "")
	text = strings.ReplaceAll(text, "</pregunta_cliente>", "")
	text = strings.TrimSpace(text)

	// Enforce at most MaxResponsePrices prices.
	matches := pricePattern.FindAllStringIndex(text, -1)
	if len(matches) > MaxResponsePrices {
		fourthEnd := matches[MaxResponsePrices-1][1]
		fifthStart := matches[MaxResponsePrices][0]

		cut := fourthEnd
		// Prefer cutting cleanly at the end of the line or sentence before the 5th price.
		between := text[fourthEnd:fifthStart]
		if nl := strings.IndexByte(between, '\n'); nl >= 0 {
			cut = fourthEnd + nl
		} else if dot := strings.Index(between, ". "); dot >= 0 {
			cut = fourthEnd + dot + 1
		}
		text = strings.TrimSpace(text[:cut])
		note := "\nHay más opciones disponibles en el catálogo."
		if utf8.RuneCountInString(text)+utf8.RuneCountInString(note) <= MaxResponseRunes {
			text += note
		}
	}

	// Enforce strictly < 1,500 runes.
	if utf8.RuneCountInString(text) > MaxResponseRunes {
		text = truncateRunesCleanly(text, MaxResponseRunes-3) + "..."
	}

	if strings.TrimSpace(text) == "" {
		return RefusalText
	}
	return text
}

func truncateRunesCleanly(s string, maxRunes int) string {
	if maxRunes <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	sub := string(runes[:maxRunes])
	if idx := strings.LastIndexAny(sub, ".\n"); idx > maxRunes/2 {
		return strings.TrimSpace(sub[:idx+1])
	}
	if idx := strings.LastIndexByte(sub, ' '); idx > maxRunes/2 {
		return strings.TrimSpace(sub[:idx])
	}
	return strings.TrimSpace(sub)
}
