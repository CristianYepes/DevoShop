// Command devoshop runs the DevoShop store. It listens on $PORT (Cloud Run sets 8080).
//
// Environment:
//
//	PORT             port to listen on (default 8080)
//	CLAVE_EQUIPO     team key for the order mailbox (never in the code or the repo)
//	CARRITO_SECRETO  secret that signs the cart cookie; the same on every instance
//	BUZON_URL        order mailbox URL (defaults to the hackathon mailbox)
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	devoshop "github.com/CristianYepes/DevoShop"
	"github.com/CristianYepes/DevoShop/internal/catalog"
	"github.com/CristianYepes/DevoShop/internal/web"
)

func main() {
	log.SetFlags(0) // Cloud Run already timestamps every line

	cat, err := catalog.Load(devoshop.DataFS())
	if err != nil {
		log.Fatalf("catálogo: %v", err)
	}
	srv, err := web.New(web.Config{
		MailboxURL: os.Getenv("BUZON_URL"),
		TeamKey:    os.Getenv("CLAVE_EQUIPO"),
		Secret:     os.Getenv("CARRITO_SECRETO"),
	}, cat, devoshop.PublicFS())
	if err != nil {
		log.Fatalf("servidor: %v", err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	httpServer := &http.Server{
		Addr:              ":" + port,
		Handler:           srv,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		// Checkout can wait for the mailbox (3 attempts with back-off).
		WriteTimeout:   30 * time.Second,
		IdleTimeout:    120 * time.Second,
		MaxHeaderBytes: 16 << 10,
		ErrorLog:       log.New(os.Stderr, "http: ", 0),
	}

	// Cloud Run sends SIGTERM before stopping an instance: finish in-flight requests first.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()

	log.Printf("DevoShop listening on %s (%d productos)", port, len(cat.All()))
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
