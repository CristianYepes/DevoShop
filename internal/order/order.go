// Package order builds the v1.0 order from the cart (catalog names and prices only) and sends
// it to the hackathon mailbox from the server, before the confirmation page is shown.
package order

import (
	"bytes"
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"time"

	"github.com/CristianYepes/DevoShop/internal/cart"
	"github.com/CristianYepes/DevoShop/internal/catalog"
	"github.com/CristianYepes/DevoShop/internal/textx"
)

// DefaultMailboxURL is the hackathon order mailbox.
const DefaultMailboxURL = "https://hk-buzon-168798369712.europe-southwest1.run.app/api/pedido"

var (
	uuidV4    = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	emailRe   = regexp.MustCompile(`^[^` + textx.JSSpace + `@]+@[^` + textx.JSSpace + `@]+\.[^` + textx.JSSpace + `@]+$`)
	duplicate = regexp.MustCompile(`(?i)repetid|duplicad|ya existe`)
)

// IsUUIDv4 reports whether s is a lower-case UUID v4.
func IsUUIDv4(s string) bool { return uuidV4.MatchString(s) }

// NewUUID returns a random UUID v4.
func NewUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// Customer is the "customer" object of the order.
type Customer struct {
	Name    string `json:"name"`
	Email   string `json:"email"`
	Address string `json:"address"`
}

// Item is one order line.
type Item struct {
	SKU       string  `json:"sku"`
	Name      string  `json:"name"`
	Quantity  int     `json:"quantity"`
	UnitPrice float64 `json:"unit_price"`
}

// Order is the v1.0 order format.
type Order struct {
	SchemaVersion string   `json:"schema_version"`
	OrderID       string   `json:"order_id"`
	CreatedAt     string   `json:"created_at"`
	Customer      Customer `json:"customer"`
	Items         []Item   `json:"items"`
	Currency      string   `json:"currency"`
	Total         float64  `json:"total"`
}

// ValidateCustomer checks the guest form (fields nombre, email, direccion). The returned map
// has one message per invalid field.
func ValidateCustomer(form map[string]string) (map[string]string, Customer) {
	c := Customer{
		Name:    textx.Truncate(textx.Trim(form["nombre"]), 200),
		Email:   textx.Truncate(textx.Trim(form["email"]), 200),
		Address: textx.Truncate(textx.Trim(form["direccion"]), 300),
	}
	errs := map[string]string{}
	if c.Name == "" {
		errs["nombre"] = "Escribe tu nombre y apellidos."
	}
	if !emailRe.MatchString(c.Email) {
		errs["email"] = "Escribe un email válido, por ejemplo nombre@dominio.com."
	}
	if c.Address == "" {
		errs["direccion"] = "Escribe la dirección de envío."
	}
	return errs, c
}

// Build makes the order from the cart lines. Names and prices come from the catalog only.
func Build(lines []cart.Entry, c Customer, orderID string, now time.Time, cat *catalog.Catalog) Order {
	s := cart.Summarize(lines, cat)
	items := make([]Item, len(s.Items))
	for i, l := range s.Items {
		items[i] = Item{SKU: l.Product.SKU, Name: l.Product.Name, Quantity: l.Quantity, UnitPrice: l.Product.Price}
	}
	return Order{
		SchemaVersion: "1.0",
		OrderID:       orderID,
		CreatedAt:     now.UTC().Format("2006-01-02T15:04:05Z"),
		Customer:      c,
		Items:         items,
		Currency:      "EUR",
		Total:         s.Total,
	}
}

// Mailbox sends orders to the hackathon mailbox.
type Mailbox struct {
	URL    string
	Key    string        // team key (CLAVE_EQUIPO), never in the code
	Retry  time.Duration // base wait between attempts
	Client *http.Client
}

// Result is the outcome of a send.
type Result struct {
	OK     bool
	Status int
	Detail string
}

// Send POSTs the order. It retries 429/502/503 and network errors (3 attempts). A 422
// "repetido" means an earlier attempt with the same order_id already got through, so it counts
// as accepted.
func (m *Mailbox) Send(ctx context.Context, o Order) Result {
	if m.Key == "" {
		return Result{Detail: "CLAVE_EQUIPO no configurada"}
	}
	body, err := catalog.MarshalJSON(o)
	if err != nil {
		return Result{Detail: err.Error()}
	}
	client := m.Client
	if client == nil {
		client = http.DefaultClient
	}
	last := Result{Detail: "sin respuesta"}
	for attempt := 1; attempt <= 3; attempt++ {
		res, retry := m.post(ctx, client, body)
		if res.OK {
			return res
		}
		last = res
		if !retry {
			break
		}
		if attempt < 3 {
			select {
			case <-time.After(m.Retry * time.Duration(attempt)):
			case <-ctx.Done():
				attempt = 3
			}
		}
	}
	log.Printf("buzón: pedido %s rechazado (%d): %s", o.OrderID, last.Status, last.Detail)
	return last
}

func (m *Mailbox) post(ctx context.Context, client *http.Client, body []byte) (Result, bool) {
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.URL, bytes.NewReader(body))
	if err != nil {
		return Result{Detail: err.Error()}, false
	}
	req.Header.Set("x-clave", m.Key)
	req.Header.Set("content-type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return Result{Detail: err.Error()}, true
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	detail := string(raw)
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return Result{true, resp.StatusCode, detail}, false
	}
	if resp.StatusCode == http.StatusUnprocessableEntity && duplicate.MatchString(detail) {
		return Result{true, resp.StatusCode, detail}, false
	}
	switch resp.StatusCode {
	case http.StatusTooManyRequests, http.StatusBadGateway, http.StatusServiceUnavailable:
		return Result{false, resp.StatusCode, detail}, true
	}
	return Result{false, resp.StatusCode, detail}, false
}
