package assistant

import (
	"context"
	"log"
	"strings"
	"sync"
	"time"

	"devoshop/asistente/internal/knowledge"
)

type cacheEntry struct {
	answer    string
	expiresAt time.Time
}

// Service coordinates caching, injection guards, Gemini calls, and deterministic fallback.
type Service struct {
	store    *knowledge.Store
	llm      *GeminiClient
	cacheTTL time.Duration
	mu       sync.RWMutex
	cache    map[string]cacheEntry
	maxCache int
}

// NewService creates an assistant Service backed by the given knowledge Store and optional GeminiClient.
func NewService(store *knowledge.Store, llm *GeminiClient, cacheTTL time.Duration) *Service {
	if cacheTTL < 0 {
		cacheTTL = 0
	}
	return &Service{
		store:    store,
		llm:      llm,
		cacheTTL: cacheTTL,
		cache:    make(map[string]cacheEntry),
		maxCache: 1000,
	}
}

// Answer responds to a customer question using cached results, guards, Gemini, and local fallback.
func (s *Service) Answer(ctx context.Context, question string) string {
	trimmed := strings.TrimSpace(question)
	if trimmed == "" {
		return "Por favor, escribe una pregunta sobre nuestros productos o condiciones de venta."
	}

	key := cacheKey(trimmed)
	if cached, ok := s.getCached(key); ok {
		return cached
	}

	snap := s.store.Snapshot()
	if IsInjectionOrOffTopic(trimmed, snap.HasStoreIntent(trimmed)) {
		ans := EnforceResponseLimits(RefusalText)
		s.putCached(key, ans)
		return ans
	}

	var rawAnswer string
	if s.llm != nil && s.llm.Enabled() {
		ans, err := s.llm.Ask(ctx, snap, trimmed)
		if err != nil {
			// Log only the safe error summary; never log secrets or stack traces.
			log.Printf("assistant llm fallback: %v", err)
		} else {
			rawAnswer = ans
		}
	}

	if strings.TrimSpace(rawAnswer) == "" {
		rawAnswer = snap.BuildLocalAnswer(trimmed)
	}

	finalAnswer := EnforceResponseLimits(rawAnswer)
	s.putCached(key, finalAnswer)
	return finalAnswer
}

// ClearCache clears cached assistant answers (e.g. after reloading catalog/conditions).
func (s *Service) ClearCache() {
	s.mu.Lock()
	clear(s.cache)
	s.mu.Unlock()
}

func cacheKey(q string) string {
	return strings.Join(strings.Fields(knowledge.Normalize(q)), " ")
}

func (s *Service) getCached(key string) (string, bool) {
	if s.cacheTTL <= 0 {
		return "", false
	}
	now := time.Now()
	s.mu.RLock()
	entry, ok := s.cache[key]
	s.mu.RUnlock()
	if !ok || now.After(entry.expiresAt) {
		return "", false
	}
	return entry.answer, true
}

func (s *Service) putCached(key, answer string) {
	if s.cacheTTL <= 0 {
		return
	}
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.cache) >= s.maxCache {
		for k, v := range s.cache {
			if now.After(v.expiresAt) {
				delete(s.cache, k)
			}
		}
		if len(s.cache) >= s.maxCache {
			clear(s.cache)
		}
	}
	s.cache[key] = cacheEntry{
		answer:    answer,
		expiresAt: now.Add(s.cacheTTL),
	}
}
