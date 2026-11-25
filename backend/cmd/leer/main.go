// Reads the DevoShop catalogue from BigQuery and prints it.
//
//	go run ./cmd/leer                 # every product
//	go run ./cmd/leer sofa-nordico    # one product + what is bought with it
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"cloud.google.com/go/bigquery"

	store "devoteam/backend"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client, err := store.NewClient(ctx)
	if err != nil {
		log.Fatalf("bigquery: %v", err)
	}
	defer client.Close()

	if len(os.Args) > 1 {
		showProduct(ctx, client, os.Args[1])
		return
	}

	productos, err := store.Productos(ctx, client)
	if err != nil {
		log.Fatalf("productos: %v", err)
	}
	for _, p := range productos {
		fmt.Printf("%-45s %-14s %10s €\n", p.SKU, p.Categoria, p.Precio.FloatString(2))
	}
	fmt.Printf("\n%d productos\n", len(productos))
}

func showProduct(ctx context.Context, client *bigquery.Client, sku string) {
	p, err := store.GetProducto(ctx, client, sku)
	if err != nil {
		log.Fatalf("producto: %v", err)
	}
	if p == nil {
		log.Fatalf("no existe el producto %q", sku)
	}
	fmt.Printf("%s (%s)\n  precio:   %s €\n  color:    %s\n  material: %s\n",
		p.Nombre, p.SKU, p.Precio.FloatString(2), p.Color, p.Material)
	if p.Plazas.Valid {
		fmt.Printf("  plazas:   %d\n", p.Plazas.Int64)
	}
	if p.Stock.Valid {
		fmt.Printf("  stock:    %d\n", p.Stock.Int64)
	}

	junto, err := store.CompradoJunto(ctx, client, sku)
	if err != nil {
		log.Fatalf("comprado junto: %v", err)
	}
	fmt.Println("\nSe compra junto con:")
	for _, s := range junto {
		fmt.Println("  -", s)
	}
}
