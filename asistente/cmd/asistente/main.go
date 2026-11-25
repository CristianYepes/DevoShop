package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"devoshop/asistente/internal/assistant"
	"devoshop/asistente/internal/knowledge"
	"devoshop/asistente/internal/server"
)

func main() {
	port := envOrDefault("PORT", "8080")
	cfg := knowledge.Config{
		CatalogPath:    envOrDefault("CATALOG_PATH", "data/catalogo.json"),
		CatalogURL:     strings.TrimSpace(os.Getenv("CATALOG_URL")),
		ConditionsPath: envOrDefault("CONDITIONS_PATH", "data/condiciones-de-venta.md"),
		ConditionsURL:  strings.TrimSpace(os.Getenv("CONDITIONS_URL")),
	}

	store := knowledge.NewStore()
	if err := store.Load(context.Background(), cfg); err != nil {
		log.Fatalf("failed to load store knowledge: %v", err)
	}
	snap := store.Snapshot()
	log.Printf("loaded %d products and %d condition sections", len(snap.Products), len(snap.Conditions))

	timeoutMs := envIntOrDefault("LLM_TIMEOUT_MS", 4500)
	cacheTTLSec := envIntOrDefault("CACHE_TTL_SECONDS", 300)
	refreshSec := envIntOrDefault("DATA_REFRESH_SECONDS", 0)

	llm := assistant.NewGeminiClient(
		os.Getenv("GEMINI_API_KEY"),
		envOrDefault("GEMINI_MODEL", "gemini-2.5-flash-lite"),
		os.Getenv("GEMINI_BASE_URL"),
		time.Duration(timeoutMs)*time.Millisecond,
	)
	if llm.Enabled() {
		log.Printf("assistant running with Gemini model %s", envOrDefault("GEMINI_MODEL", "gemini-2.5-flash-lite"))
	} else {
		log.Printf("GEMINI_API_KEY not set; assistant running in deterministic local fallback mode")
	}

	svc := assistant.NewService(store, llm, time.Duration(cacheTTLSec)*time.Second)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if refreshSec > 0 && (cfg.CatalogURL != "" || cfg.ConditionsURL != "") {
		go runRefreshLoop(ctx, store, svc, cfg, time.Duration(refreshSec)*time.Second)
	}

	httpServer := &http.Server{
		Addr:              ":" + port,
		Handler:           server.NewHandler(svc),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Printf("DevoShop assistant listening on :%s", port)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown error: %v", err)
	}
}

func runRefreshLoop(ctx context.Context, store *knowledge.Store, svc *assistant.Service, cfg knowledge.Config, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := store.Load(ctx, cfg); err != nil {
				log.Printf("knowledge refresh failed: %v", err)
				continue
			}
			svc.ClearCache()
		}
	}
}

func envOrDefault(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envIntOrDefault(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}
