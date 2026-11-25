package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type stubAnswerer struct {
	fn func(ctx context.Context, q string) string
}

func (s stubAnswerer) Answer(ctx context.Context, q string) string {
	return s.fn(ctx, q)
}

func assertSecurityHeaders(t *testing.T, res *http.Response, label string) {
	t.Helper()
	hsts := res.Header.Get("Strict-Transport-Security")
	if !strings.Contains(hsts, "max-age=31536000") {
		t.Fatalf("%s: expected HSTS >= 1 year, got %q", label, hsts)
	}
	if res.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("%s: missing nosniff", label)
	}
	csp := res.Header.Get("Content-Security-Policy")
	if !strings.Contains(csp, "default-src 'self'") || !strings.Contains(csp, "script-src 'self'") ||
		strings.Contains(csp, "unsafe-inline") || strings.Contains(csp, "unsafe-eval") || strings.Contains(csp, "*") {
		t.Fatalf("%s: invalid CSP %q", label, csp)
	}
	if res.Header.Get("Server") != "" || res.Header.Get("X-Powered-By") != "" {
		t.Fatalf("%s: unexpected server/framework header", label)
	}
}

func TestAssistantEndpointAndErrors(t *testing.T) {
	handler := NewHandler(stubAnswerer{
		fn: func(_ context.Context, q string) string {
			return "Respuesta para: " + q
		},
	})
	srv := httptest.NewServer(handler)
	defer srv.Close()

	// Valid POST
	res, err := http.Post(srv.URL+"/api/asistente", "application/json", strings.NewReader(`{"pregunta":"¿Cuánto cuesta el envío?"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.StatusCode)
	}
	assertSecurityHeaders(t, res, "POST /api/asistente")

	var out assistantResponse
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Respuesta != "Respuesta para: ¿Cuánto cuesta el envío?" {
		t.Fatalf("unexpected response: %+v", out)
	}

	// Wrong method
	resGet, err := http.Get(srv.URL + "/api/asistente")
	if err != nil {
		t.Fatal(err)
	}
	resGet.Body.Close()
	if resGet.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", resGet.StatusCode)
	}
	assertSecurityHeaders(t, resGet, "GET /api/asistente")

	// Empty pregunta
	resEmpty, err := http.Post(srv.URL+"/api/asistente", "application/json", strings.NewReader(`{"pregunta":"   "}`))
	if err != nil {
		t.Fatal(err)
	}
	resEmpty.Body.Close()
	if resEmpty.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resEmpty.StatusCode)
	}

	// Invalid JSON
	resBad, err := http.Post(srv.URL+"/api/asistente", "application/json", strings.NewReader(`{bad`))
	if err != nil {
		t.Fatal(err)
	}
	resBad.Body.Close()
	if resBad.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resBad.StatusCode)
	}
	assertSecurityHeaders(t, resBad, "invalid json")

	// Oversized payload (> 16 KiB)
	bigPayload := `{"pregunta":"` + strings.Repeat("a", 17*1024) + `"}`
	resBig, err := http.Post(srv.URL+"/api/asistente", "application/json", strings.NewReader(bigPayload))
	if err != nil {
		t.Fatal(err)
	}
	resBig.Body.Close()
	if resBig.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", resBig.StatusCode)
	}
}

func TestHomeStaticAndHealthRoutes(t *testing.T) {
	handler := NewHandler(stubAnswerer{fn: func(context.Context, string) string { return "ok" }})
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resHome, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	resHome.Body.Close()
	if resHome.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 on /, got %d", resHome.StatusCode)
	}
	assertSecurityHeaders(t, resHome, "home")

	resCSS, err := http.Get(srv.URL + "/static/styles.css")
	if err != nil {
		t.Fatal(err)
	}
	resCSS.Body.Close()
	if resCSS.StatusCode != http.StatusOK || !strings.Contains(resCSS.Header.Get("Content-Type"), "text/css") {
		t.Fatalf("unexpected css response: %d %s", resCSS.StatusCode, resCSS.Header.Get("Content-Type"))
	}

	res404, err := http.Get(srv.URL + "/no-existe")
	if err != nil {
		t.Fatal(err)
	}
	res404.Body.Close()
	if res404.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", res404.StatusCode)
	}
	assertSecurityHeaders(t, res404, "404")

	resHealth, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	resHealth.Body.Close()
	if resHealth.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 on /healthz, got %d", resHealth.StatusCode)
	}
}
