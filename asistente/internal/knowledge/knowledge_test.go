package knowledge

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseCatalogSupportsArrayAndWrappedObject(t *testing.T) {
	arrJSON := []byte(`[{"sku":"s1","name":"Sofá Gris","category":"sofás","price":"649,00 €","plazas":3,"ancho_cm":210,"color":"gris","material":"tela"}]`)
	prods, err := ParseCatalog(arrJSON)
	if err != nil {
		t.Fatalf("ParseCatalog array failed: %v", err)
	}
	if len(prods) != 1 || prods[0].SKU != "s1" || !prods[0].HasPrice || prods[0].Price != 649.0 || prods[0].Plazas != 3 {
		t.Fatalf("unexpected parsed product: %+v", prods)
	}

	objJSON := []byte(`{"productos":[{"id":"m1","nombre":"Mesa Roble","categoria":"mesas","precio_iva":389.5,"ancho":160}]}`)
	prods, err = ParseCatalog(objJSON)
	if err != nil {
		t.Fatalf("ParseCatalog object failed: %v", err)
	}
	if len(prods) != 1 || prods[0].SKU != "m1" || prods[0].Name != "Mesa Roble" || prods[0].AnchoCM != 160 {
		t.Fatalf("unexpected wrapped product: %+v", prods)
	}
}

func TestStoreLoadFromURLAndLocalFallback(t *testing.T) {
	dir := t.TempDir()
	catPath := filepath.Join(dir, "catalogo.json")
	condPath := filepath.Join(dir, "condiciones-de-venta.md")

	if err := os.WriteFile(catPath, []byte(`[{"sku":"l1","name":"Lámpara","price":45}]`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(condPath, []byte("## Envíos\nGratis desde 250 €.\n## Garantía\n3 años."), 0o600); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/catalogo.json" {
			_, _ = w.Write([]byte(`[{"sku":"s1","name":"Sofá URL","category":"sofás","price":599}]`))
			return
		}
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	store := NewStore()
	err := store.Load(context.Background(), Config{
		CatalogURL:     srv.URL + "/catalogo.json",
		CatalogPath:    catPath,
		ConditionsURL:  srv.URL + "/fail.md",
		ConditionsPath: condPath,
	})
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	snap := store.Snapshot()
	if len(snap.Products) != 1 || snap.Products[0].Name != "Sofá URL" {
		t.Fatalf("expected URL catalog product, got %+v", snap.Products)
	}
	if len(snap.Conditions) != 2 {
		t.Fatalf("expected 2 fallback condition sections, got %d", len(snap.Conditions))
	}
}

func TestBuildLocalAnswerCatalogConditionsAndMissing(t *testing.T) {
	store := NewStore()
	prods, err := ParseCatalog([]byte(`[
		{"sku":"sofa-3p","name":"Sofá 3 plazas Nórdico","category":"sofás","price":649,"plazas":3,"ancho_cm":210,"color":"gris","material":"tela"},
		{"sku":"lampara-pie","name":"Lámpara de pie Arco","category":"iluminación","price":45,"color":"negro","material":"metal"}
	]`))
	if err != nil {
		t.Fatal(err)
	}
	store.products = prods
	store.categories = []string{"iluminación", "sofás"}
	store.conditionsRaw = "## Envíos\nEnvío estándar 9,90 €, gratis desde 250 €."
	store.conditions = ParseConditions(store.conditionsRaw)

	snap := store.Snapshot()

	ansCat := snap.BuildLocalAnswer("¿Cuánto cuesta el sofá de 3 plazas?")
	if !strings.Contains(ansCat, "649,00 €") {
		t.Fatalf("expected sofa price in answer, got %q", ansCat)
	}

	ansCond := snap.BuildLocalAnswer("¿Cuánto cuesta el envío?")
	if !strings.Contains(ansCond, "9,90 €") {
		t.Fatalf("expected shipping cost in answer, got %q", ansCond)
	}

	ansMissing := snap.BuildLocalAnswer("¿Vendéis microondas?")
	if !strings.Contains(strings.ToLower(ansMissing), "no consta") {
		t.Fatalf("expected negative answer for missing product, got %q", ansMissing)
	}
}
