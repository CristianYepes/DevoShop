// Package web is the DevoShop HTTP server: pages, cart, checkout, /catalogo.json and the
// assistant API. It uses only the standard library's net/http, adds the security headers to
// every response itself (Cloud Run does not) and never announces a framework or version.
package web

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/CristianYepes/DevoShop/internal/assistant"
	"github.com/CristianYepes/DevoShop/internal/cart"
	"github.com/CristianYepes/DevoShop/internal/catalog"
	"github.com/CristianYepes/DevoShop/internal/order"
	"github.com/CristianYepes/DevoShop/internal/textx"
)

const maxBodyBytes = 16 * 1024

var securityHeaders = map[string]string{
	"Strict-Transport-Security": "max-age=31536000; includeSubDomains",
	"X-Content-Type-Options":    "nosniff",
	// No inline scripts or styles anywhere: all JS/CSS lives in /static.
	"Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
		"object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
	"Referrer-Policy": "strict-origin-when-cross-origin",
}

var staticTypes = map[string]string{
	".css":  "text/css; charset=utf-8",
	".js":   "text/javascript; charset=utf-8",
	".svg":  "image/svg+xml",
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".webp": "image/webp",
	".ico":  "image/x-icon",
}

const (
	htmlType = "text/html; charset=utf-8"
	jsonType = "application/json; charset=utf-8"
)

// Config is the server configuration. Empty fields are fine: see New.
type Config struct {
	MailboxURL string        // BUZON_URL; defaults to the hackathon mailbox
	TeamKey    string        // CLAVE_EQUIPO; without it no order can be sent
	Secret     string        // CARRITO_SECRETO; signs the cart and receipt cookies
	Retry      time.Duration // base wait between mailbox attempts (default 1.5 s)
}

// Server serves the store.
type Server struct {
	cat     *catalog.Catalog
	pages   *pages
	asst    *assistant.Assistant
	mailbox *order.Mailbox
	secret  string
	static  fs.FS
	cached  map[string][]byte // pre-rendered pages that only depend on the catalog
	errors  map[int][]byte
}

// New builds the server. Pages that only depend on the catalog are rendered once here, so the
// home and product pages cost a map lookup per request.
func New(cfg Config, cat *catalog.Catalog, static fs.FS) (*Server, error) {
	css, err := fs.ReadFile(static, "styles.css")
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(css)
	if cfg.MailboxURL == "" {
		cfg.MailboxURL = order.DefaultMailboxURL
	}
	if cfg.Retry == 0 {
		cfg.Retry = 1500 * time.Millisecond
	}
	if cfg.Secret == "" {
		// Without a shared secret each instance signs carts differently: fine locally, not on several instances.
		var b [32]byte
		_, _ = rand.Read(b[:])
		cfg.Secret = hex.EncodeToString(b[:])
		log.Print("CARRITO_SECRETO no configurado: se usa uno aleatorio (los carritos no sobreviven a un reinicio ni a otra instancia).")
	}
	if cfg.TeamKey == "" {
		log.Print("CLAVE_EQUIPO no configurada: los pedidos no se podrán enviar al buzón.")
	}

	s := &Server{
		cat:     cat,
		pages:   newPages(cat, hex.EncodeToString(sum[:])[:10]),
		asst:    assistant.New(cat),
		mailbox: &order.Mailbox{URL: cfg.MailboxURL, Key: cfg.TeamKey, Retry: cfg.Retry, Client: &http.Client{Timeout: 5 * time.Second}},
		secret:  cfg.Secret,
		static:  static,
		cached:  map[string][]byte{},
		errors:  map[int][]byte{},
	}
	s.cached["/"] = []byte(s.pages.home())
	s.cached["/mas-vendidos"] = []byte(s.pages.offers())
	s.cached["/ofertas"] = s.cached["/mas-vendidos"]
	s.cached["/packs"] = []byte(s.pages.packs())
	for i := range catalog.Categories {
		c := &catalog.Categories[i]
		s.cached["/categoria/"+c.Slug] = []byte(s.pages.category(c, cat.InCategory(c.Slug)))
	}
	for _, p := range cat.All() {
		s.cached["/producto/"+p.SKU] = []byte(s.pages.product(p))
	}
	for status := range errorText {
		s.errors[status] = []byte(s.pages.errorPage(status))
	}
	return s, nil
}

// ---------- responses ----------

func (s *Server) send(w http.ResponseWriter, status int, body []byte, contentType string, extra ...[2]string) {
	h := w.Header()
	for k, v := range securityHeaders {
		h.Set(k, v)
	}
	h.Set("Content-Type", contentType)
	for _, kv := range extra {
		h.Add(kv[0], kv[1])
	}
	w.WriteHeader(status)
	_, _ = w.Write(body) // net/http drops the body for HEAD
}

func (s *Server) html(w http.ResponseWriter, status int, body string, extra ...[2]string) {
	s.send(w, status, []byte(body), htmlType, extra...)
}

func (s *Server) sendJSON(w http.ResponseWriter, status int, v any) {
	b, _ := catalog.MarshalJSON(v)
	s.send(w, status, b, jsonType)
}

func (s *Server) errorPage(w http.ResponseWriter, status int, extra ...[2]string) {
	body, ok := s.errors[status]
	if !ok {
		body = []byte(s.pages.errorPage(status))
	}
	s.send(w, status, body, htmlType, extra...)
}

func (s *Server) redirect(w http.ResponseWriter, location string, cookies ...string) {
	h := w.Header()
	for k, v := range securityHeaders {
		h.Set(k, v)
	}
	h.Set("Location", location)
	h.Set("Content-Type", "text/plain; charset=utf-8")
	for _, c := range cookies {
		h.Add("Set-Cookie", c)
	}
	w.WriteHeader(http.StatusSeeOther)
}

var sessionRe = regexp.MustCompile(`(?:^|;[` + textx.JSSpace + `]*)hk_sesion=[^;]+`)

// session sets hk_sesion on the first visit only; an existing session is never overwritten.
func session(r *http.Request) [][2]string {
	if sessionRe.MatchString(r.Header.Get("Cookie")) {
		return nil
	}
	var b [16]byte
	_, _ = rand.Read(b[:])
	return [][2]string{{"Set-Cookie", "hk_sesion=" + hex.EncodeToString(b[:]) + "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400"}}
}

// cookie reads a raw cookie value (the first one with that name).
func cookie(r *http.Request, name string) string {
	for _, part := range strings.Split(strings.Join(r.Header.Values("Cookie"), "; "), ";") {
		k, v, ok := strings.Cut(strings.TrimLeftFunc(part, textx.IsJSSpace), "=")
		if ok && k == name && v != "" {
			return v
		}
	}
	return ""
}

// ---------- request bodies ----------

type httpError struct{ status int }

func (e httpError) Error() string { return http.StatusText(e.status) }

func readBody(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		return nil, httpError{http.StatusRequestEntityTooLarge}
	}
	if err != nil {
		return nil, httpError{http.StatusBadRequest}
	}
	return b, nil
}

// readForm parses an urlencoded body; for a repeated field the last value wins.
func readForm(w http.ResponseWriter, r *http.Request) (map[string]string, error) {
	b, err := readBody(w, r)
	if err != nil {
		return nil, err
	}
	values, _ := url.ParseQuery(string(b))
	form := make(map[string]string, len(values))
	for k, v := range values {
		form[k] = v[len(v)-1]
	}
	return form, nil
}

// ---------- routing ----------

var (
	categoryRe = regexp.MustCompile(`^/categoria/([a-z0-9_-]+)/?$`)
	productRe  = regexp.MustCompile(`^/producto/([^/]+)/?$`)
	orderRe    = regexp.MustCompile(`^/pedido/([0-9a-f-]{36})$`)
)

// ServeHTTP routes the request. Any panic becomes a generic error page: details only go to
// the logs (Cloud Run), never to the client.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if v := recover(); v != nil {
			if v == http.ErrAbortHandler {
				panic(v)
			}
			log.Printf("%s %s failed: %v", r.Method, r.URL.RequestURI(), v)
			s.fail(w, r, http.StatusInternalServerError)
		}
	}()
	if err := s.route(w, r); err != nil {
		status := http.StatusInternalServerError
		var he httpError
		if errors.As(err, &he) {
			status = he.status
		}
		if status >= 500 {
			log.Printf("%s %s failed: %v", r.Method, r.URL.RequestURI(), err)
		}
		s.fail(w, r, status)
	}
}

func (s *Server) fail(w http.ResponseWriter, r *http.Request, status int) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		s.sendJSON(w, status, map[string]string{"error": "Petición no válida"})
		return
	}
	s.errorPage(w, status)
}

// cleanPath resolves "." and ".." segments the way a browser does (on the still-encoded path,
// so an encoded slash stays inside its segment) and then decodes it.
func cleanPath(escaped string) (string, error) {
	escaped = strings.ReplaceAll(escaped, `\`, "/")
	segs := strings.Split(escaped, "/")
	var out []string
	for i, seg := range segs {
		if i == 0 {
			continue // before the leading slash
		}
		last := i == len(segs)-1
		switch strings.ToLower(seg) {
		case ".", "%2e":
			if last {
				out = append(out, "")
			}
		case "..", ".%2e", "%2e.", "%2e%2e":
			if len(out) > 0 {
				out = out[:len(out)-1]
			}
			if last {
				out = append(out, "")
			}
		default:
			out = append(out, seg)
		}
	}
	return url.PathUnescape("/" + strings.Join(out, "/"))
}

func (s *Server) route(w http.ResponseWriter, r *http.Request) error {
	p, err := cleanPath(r.URL.EscapedPath())
	if err != nil {
		s.errorPage(w, http.StatusBadRequest)
		return nil
	}
	r.URL.Path = p // so fail() sees the clean path

	if p == "/api/asistente" {
		return s.assistantAPI(w, r)
	}
	if r.Method == http.MethodPost && strings.HasPrefix(p, "/carrito/") {
		return s.cartAction(w, r, p)
	}
	if p == "/checkout" && r.Method == http.MethodPost {
		return s.placeOrder(w, r)
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		s.errorPage(w, http.StatusMethodNotAllowed, [2]string{"Allow", "GET, HEAD"})
		return nil
	}

	switch p {
	case "/catalogo.json":
		s.send(w, http.StatusOK, s.cat.CatalogJSON(), jsonType)
		return nil
	case "/carrito":
		lines := cart.Read(s.secret, cookie(r, cart.CookieName), s.cat)
		s.html(w, http.StatusOK, s.pages.cart(cart.Summarize(lines, s.cat)), session(r)...)
		return nil
	case "/checkout":
		lines := cart.Read(s.secret, cookie(r, cart.CookieName), s.cat)
		if len(lines) == 0 {
			s.html(w, http.StatusOK, s.pages.emptyCheckout())
		} else {
			s.html(w, http.StatusOK, s.pages.checkout(cart.Summarize(lines, s.cat), order.NewUUID(), nil, nil, ""))
		}
		return nil
	case "/buscar":
		q := textx.Truncate(textx.Trim(r.URL.Query().Get("q")), 100)
		s.html(w, http.StatusOK, s.pages.search(q, s.cat.Search(q)), session(r)...)
		return nil
	}
	if m := orderRe.FindStringSubmatch(p); m != nil {
		if rc, ok := s.readReceipt(cookie(r, "hk_pedido")); ok && rc.ID == m[1] {
			s.html(w, http.StatusOK, s.pages.confirmation(rc))
		} else {
			s.errorPage(w, http.StatusNotFound)
		}
		return nil
	}
	if strings.HasPrefix(p, "/static/") && s.serveStatic(w, p) {
		return nil
	}
	// Home, best sellers, packs, categories and products are pre-rendered.
	key := p
	if m := categoryRe.FindStringSubmatch(p); m != nil {
		key = "/categoria/" + m[1]
	} else if m := productRe.FindStringSubmatch(p); m != nil {
		key = "/producto/" + m[1]
	}
	if body, ok := s.cached[key]; ok {
		s.send(w, http.StatusOK, body, htmlType, session(r)...)
		return nil
	}
	s.errorPage(w, http.StatusNotFound)
	return nil
}

// serveStatic serves files from the embedded public/ only. ".." can never leave it.
func (s *Server) serveStatic(w http.ResponseWriter, p string) bool {
	typ, ok := staticTypes[path.Ext(p)]
	if !ok {
		return false
	}
	name := strings.TrimPrefix(p, "/static/")
	if !fs.ValidPath(name) {
		return false
	}
	data, err := fs.ReadFile(s.static, name)
	if err != nil {
		return false
	}
	s.send(w, http.StatusOK, data, typ, [2]string{"Cache-Control", "public, max-age=3600"})
	return true
}

func (s *Server) assistantAPI(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		s.sendJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Usa POST"})
		return nil
	}
	b, err := readBody(w, r)
	if err != nil {
		return err
	}
	var body any
	if json.Unmarshal(b, &body) != nil {
		return httpError{http.StatusBadRequest}
	}
	obj, _ := body.(map[string]any)
	pregunta, _ := obj["pregunta"].(string)
	if textx.Trim(pregunta) == "" {
		s.sendJSON(w, http.StatusBadRequest, map[string]string{"error": `Falta "pregunta"`})
		return nil
	}
	s.sendJSON(w, http.StatusOK, map[string]string{"respuesta": s.asst.Answer(textx.Truncate(pregunta, 2000))})
	return nil
}

func (s *Server) cartAction(w http.ResponseWriter, r *http.Request, p string) error {
	form, err := readForm(w, r)
	if err != nil {
		return err
	}
	lines := cart.Read(s.secret, cookie(r, cart.CookieName), s.cat)
	switch p {
	case "/carrito/anadir":
		qty := 1
		if v, ok := form["cantidad"]; ok {
			qty = max(cart.ValidQty(v), 1)
		}
		lines = cart.Add(lines, form["sku"], qty, s.cat)
	case "/carrito/cantidad":
		lines = cart.SetQty(lines, form["sku"], cart.ValidQty(form["cantidad"]))
	case "/carrito/anadir-pack":
		if pack := s.cat.GetPack(form["pack"]); pack != nil {
			for _, l := range pack.Lines {
				lines = cart.Add(lines, l.Product.SKU, l.Quantity, s.cat)
			}
		}
	default:
		s.errorPage(w, http.StatusNotFound)
		return nil
	}
	s.redirect(w, "/carrito", cart.Cookie(s.secret, lines))
	return nil
}

func (s *Server) placeOrder(w http.ResponseWriter, r *http.Request) error {
	form, err := readForm(w, r)
	if err != nil {
		return err
	}
	lines := cart.Read(s.secret, cookie(r, cart.CookieName), s.cat)
	if len(lines) == 0 {
		s.redirect(w, "/carrito")
		return nil
	}
	orderID := form["order_id"]
	if !order.IsUUIDv4(orderID) {
		orderID = order.NewUUID()
	}
	summary := cart.Summarize(lines, s.cat)
	errs, customer := order.ValidateCustomer(form)
	if len(errs) > 0 {
		s.html(w, http.StatusBadRequest, s.pages.checkout(summary, orderID, form, errs, ""))
		return nil
	}
	o := order.Build(lines, customer, orderID, time.Now(), s.cat)
	// The order reaches the mailbox BEFORE the customer sees a confirmation.
	if res := s.mailbox.Send(r.Context(), o); !res.OK {
		s.html(w, http.StatusBadGateway, s.pages.orderError(summary, orderID, form))
		return nil
	}
	// Confirmed by the mailbox: empty the cart and keep a signed copy of the order to show it.
	raw, _ := catalog.MarshalJSON(receipt{ID: orderID, Items: o.Items, Total: o.Total, Name: customer.Name})
	data := base64.RawURLEncoding.EncodeToString(raw)
	s.redirect(w, "/pedido/"+orderID,
		cart.Cookie(s.secret, nil),
		"hk_pedido="+data+"."+s.signReceipt(data)+"; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400",
	)
	return nil
}

func (s *Server) signReceipt(data string) string { return cart.Sign(s.secret, "recibo:"+data) }

func (s *Server) readReceipt(value string) (receipt, bool) {
	var rc receipt
	parts := strings.Split(value, ".")
	if len(parts) < 2 || parts[0] == "" || !hmac.Equal([]byte(parts[1]), []byte(s.signReceipt(parts[0]))) {
		return rc, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(raw, &rc) != nil {
		return rc, false
	}
	return rc, true
}
