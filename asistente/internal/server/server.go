package server

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

const maxRequestBodyBytes = 16 * 1024

//go:embed static/*
var staticFS embed.FS

// Answerer defines the assistant backend used by the HTTP handler.
type Answerer interface {
	Answer(ctx context.Context, question string) string
}

type assistantRequest struct {
	Pregunta *string `json:"pregunta"`
}

type assistantResponse struct {
	Respuesta string `json:"respuesta"`
}

type errorResponse struct {
	Error string `json:"error"`
}

// NewHandler builds the HTTP router wrapped with mandatory DevoShop security headers.
func NewHandler(svc Answerer) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/asistente", handleAssistant(svc))
	mux.HandleFunc("/healthz", handleHealth)
	mux.HandleFunc("/static/", handleStatic)
	mux.HandleFunc("/", handleHome)

	return withSecurityHeaders(mux)
}

func withSecurityHeaders(next http.Handler) http.Handler {
	const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
		"object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Content-Security-Policy", csp)
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

func handleAssistant(svc Answerer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			writeJSON(w, r, http.StatusMethodNotAllowed, errorResponse{Error: "Usa POST"})
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				writeJSON(w, r, http.StatusRequestEntityTooLarge, errorResponse{Error: "Petición demasiado grande"})
				return
			}
			writeJSON(w, r, http.StatusBadRequest, errorResponse{Error: "Petición no válida"})
			return
		}

		var req assistantRequest
		if err := json.Unmarshal(body, &req); err != nil {
			writeJSON(w, r, http.StatusBadRequest, errorResponse{Error: "JSON no válido"})
			return
		}
		if req.Pregunta == nil || strings.TrimSpace(*req.Pregunta) == "" {
			writeJSON(w, r, http.StatusBadRequest, errorResponse{Error: `Falta "pregunta"`})
			return
		}

		answer := svc.Answer(r.Context(), *req.Pregunta)
		writeJSON(w, r, http.StatusOK, assistantResponse{Respuesta: answer})
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeJSON(w, r, http.StatusMethodNotAllowed, errorResponse{Error: "Método no permitido"})
		return
	}
	writeJSON(w, r, http.StatusOK, map[string]string{"status": "ok"})
}

func handleHome(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		writeNotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeErrorPage(w, r, http.StatusMethodNotAllowed, "Método no permitido")
		return
	}
	data, err := staticFS.ReadFile("static/index.html")
	if err != nil {
		writeErrorPage(w, r, http.StatusInternalServerError, "Error interno")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(data)
	}
}

func handleStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeErrorPage(w, r, http.StatusMethodNotAllowed, "Método no permitido")
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/static/")
	var contentType string
	switch name {
	case "styles.css":
		contentType = "text/css; charset=utf-8"
	case "app.js":
		contentType = "text/javascript; charset=utf-8"
	default:
		writeNotFound(w, r)
		return
	}
	data, err := staticFS.ReadFile("static/" + name)
	if err != nil {
		writeNotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(data)
	}
}

func writeNotFound(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeJSON(w, r, http.StatusNotFound, errorResponse{Error: "Ruta no encontrada"})
		return
	}
	writeErrorPage(w, r, http.StatusNotFound, "Página no encontrada")
}

func writeErrorPage(w http.ResponseWriter, r *http.Request, status int, msg string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write([]byte(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>` +
		msg + ` | DevoShop</title><meta name="description" content="Página de error de DevoShop."><link rel="stylesheet" href="/static/styles.css"></head><body><main><h1>` +
		msg + `</h1><p><a href="/">Volver al asistente</a></p></main></body></html>`))
}

func writeJSON(w http.ResponseWriter, r *http.Request, status int, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusInternalServerError)
		if r.Method != http.MethodHead {
			_, _ = w.Write([]byte(`{"error":"Error interno"}`))
		}
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = w.Write(data)
	}
}
