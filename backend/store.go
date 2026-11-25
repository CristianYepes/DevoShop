package store

import (
	"context"
	"fmt"
	"math/big"
	"os"

	"cloud.google.com/go/bigquery"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

const location = "europe-southwest1"

type Producto struct {
	SKU       string             `bigquery:"sku"`
	Nombre    string             `bigquery:"nombre"`
	Categoria string             `bigquery:"categoria"`
	Precio    *big.Rat           `bigquery:"precio"` // NUMERIC → *big.Rat (exact, no float rounding)
	Plazas    bigquery.NullInt64 `bigquery:"plazas"` // nullable columns use Null* types
	Stock     bigquery.NullInt64 `bigquery:"stock"`
	Color     string             `bigquery:"color"`
	Material  string             `bigquery:"material"`
}

// NewClient connects with Application Default Credentials (the service account on
// Cloud Run, `gcloud auth application-default login` locally). The project comes from
// GOOGLE_CLOUD_PROJECT, or is detected from the credentials when it is not set.
// With BIGQUERY_EMULATOR_HOST=localhost:9050 it talks to a local emulator instead.
func NewClient(ctx context.Context) (*bigquery.Client, error) {
	project := os.Getenv("GOOGLE_CLOUD_PROJECT")
	if project == "" {
		project = bigquery.DetectProjectID
	}
	if host := os.Getenv("BIGQUERY_EMULATOR_HOST"); host != "" {
		return bigquery.NewClient(ctx, project,
			option.WithEndpoint("http://"+host), option.WithoutAuthentication())
	}
	c, err := bigquery.NewClient(ctx, project)
	if err != nil && project == bigquery.DetectProjectID {
		return nil, fmt.Errorf("%w\n  set the project: export GOOGLE_CLOUD_PROJECT=devoteam-515814", err)
	}
	return c, err
}

func query(c *bigquery.Client, sql string, params ...bigquery.QueryParameter) *bigquery.Query {
	q := c.Query(sql)
	q.Location = location
	q.Parameters = params
	return q
}

// The exact /catalogo.json body, already built by the view.
func CatalogoJSON(ctx context.Context, c *bigquery.Client) (string, error) {
	it, err := query(c, "SELECT catalogo FROM devoshop.catalogo_json").Read(ctx)
	if err != nil {
		return "", err
	}
	var row struct {
		Catalogo string `bigquery:"catalogo"`
	}
	if err := it.Next(&row); err != nil {
		return "", err
	}
	return row.Catalogo, nil
}

// Productos returns every product for sale, ordered like the catalogue.
func Productos(ctx context.Context, c *bigquery.Client) ([]Producto, error) {
	it, err := query(c,
		`SELECT sku, nombre, categoria, precio, plazas, stock, color, material
		   FROM devoshop.productos ORDER BY categoria, nombre`).Read(ctx)
	if err != nil {
		return nil, err
	}
	var out []Producto
	for {
		var p Producto
		if err := it.Next(&p); err == iterator.Done {
			return out, nil
		} else if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
}

// GetProducto returns nil, nil when the sku does not exist.
func GetProducto(ctx context.Context, c *bigquery.Client, sku string) (*Producto, error) {
	it, err := query(c,
		`SELECT sku, nombre, categoria, precio, plazas, stock, color, material
		   FROM devoshop.productos WHERE sku = @sku`,
		bigquery.QueryParameter{Name: "sku", Value: sku}, // always parameters, never string concat
	).Read(ctx)
	if err != nil {
		return nil, err
	}
	var p Producto
	if err := it.Next(&p); err == iterator.Done {
		return nil, nil // not found
	} else if err != nil {
		return nil, err
	}
	return &p, nil
}

func CompradoJunto(ctx context.Context, c *bigquery.Client, sku string) ([]string, error) {
	it, err := query(c,
		`SELECT sku_junto FROM devoshop.comprado_junto
		  WHERE sku = @sku ORDER BY pedidos DESC LIMIT 4`,
		bigquery.QueryParameter{Name: "sku", Value: sku},
	).Read(ctx)
	if err != nil {
		return nil, err
	}
	var out []string
	for {
		var r struct {
			SkuJunto string `bigquery:"sku_junto"`
		}
		if err := it.Next(&r); err == iterator.Done {
			return out, nil
		} else if err != nil {
			return nil, err
		}
		out = append(out, r.SkuJunto)
	}
}
