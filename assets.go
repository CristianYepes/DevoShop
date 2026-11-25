// Package devoshop embeds the files the Go server needs at runtime: the supplier data
// (the catalog is built from it at startup) and the public static assets.
//
// Embedding them in the binary means the container holds no loose files at all, so there
// is nothing on disk that a path-traversal request could ever reach.
package devoshop

import (
	"embed"
	"io/fs"
)

//go:embed db/data/proveedor-a.csv db/data/proveedor-b.json db/data/historial-ventas.csv
var data embed.FS

//go:embed public
var public embed.FS

// DataFS holds proveedor-a.csv, proveedor-b.json and historial-ventas.csv at its root.
func DataFS() fs.FS {
	sub, err := fs.Sub(data, "db/data")
	if err != nil {
		panic(err)
	}
	return sub
}

// PublicFS holds the contents of public/ (styles.css, favicon.svg, img/...).
func PublicFS() fs.FS {
	sub, err := fs.Sub(public, "public")
	if err != nil {
		panic(err)
	}
	return sub
}
