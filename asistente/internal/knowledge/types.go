package knowledge

import "sync"

// Product represents a normalized item from catalogo.json.
type Product struct {
	SKU         string
	Name        string
	Category    string
	Price       float64
	HasPrice    bool
	Plazas      int
	AnchoCM     float64
	Color       string
	Material    string
	Dimensions  string
	Description string
	Extra       map[string]string
	SearchText  string
}

// ConditionSection represents a heading and body block from condiciones-de-venta.md.
type ConditionSection struct {
	Title      string
	Body       string
	SearchText string
}

// Config specifies where catalog and sales conditions are loaded from.
type Config struct {
	CatalogPath    string
	CatalogURL     string
	ConditionsPath string
	ConditionsURL  string
}

// Store holds the in-memory catalog and sales conditions safely for concurrent reads.
type Store struct {
	mu            sync.RWMutex
	products      []Product
	categories    []string
	conditionsRaw string
	conditions    []ConditionSection
}

// Snapshot is an immutable view of the store's data at a point in time.
type Snapshot struct {
	Products      []Product
	Categories    []string
	ConditionsRaw string
	Conditions    []ConditionSection
}

// NewStore creates an empty Store.
func NewStore() *Store {
	return &Store{}
}

// Snapshot returns a safe copy of slices/strings for read-only request handling.
func (s *Store) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	products := make([]Product, len(s.products))
	copy(products, s.products)

	categories := make([]string, len(s.categories))
	copy(categories, s.categories)

	conditions := make([]ConditionSection, len(s.conditions))
	copy(conditions, s.conditions)

	return Snapshot{
		Products:      products,
		Categories:    categories,
		ConditionsRaw: s.conditionsRaw,
		Conditions:    conditions,
	}
}
