package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"stylme/go-backend/internal/config"
	"stylme/go-backend/internal/httpapi"
	livekitgateway "stylme/go-backend/internal/livekit"
	openaiapi "stylme/go-backend/internal/openai"
	"stylme/go-backend/internal/service"
	"stylme/go-backend/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)
	cfg, err := config.Load()
	if err != nil {
		logger.Error("configuration failed", "error", err)
		os.Exit(1)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	data, err := store.New(ctx, cfg.MongoURI, cfg.MongoDatabase)
	if err != nil {
		logger.Error("database startup failed", "error", err)
		os.Exit(1)
	}
	defer func() {
		closeCtx, closeCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer closeCancel()
		_ = data.Close(closeCtx)
	}()
	if err := data.EnsureIndexes(ctx); err != nil {
		logger.Error("index initialization failed", "error", err)
		os.Exit(1)
	}
	if err := data.SeedDefaults(ctx, cfg.OpenAIModel); err != nil {
		logger.Error("default configuration failed", "error", err)
		os.Exit(1)
	}
	ai := openaiapi.New(cfg.OpenAIAPIKey, cfg.OpenAIBaseURL)
	vault := service.NewCredentialVault(data, cfg.CredentialEncryptionKey, map[string]string{
		"openai": cfg.OpenAIAPIKey, "deepgram": cfg.DeepgramAPIKey, "sarvam": cfg.SarvamAPIKey,
	})
	if err := vault.EnsureFallbacks(ctx); err != nil {
		logger.Error("provider credential initialization failed", "error", err)
		os.Exit(1)
	}
	app := service.New(data, ai, service.NewCatalogClient(cfg.PythonAPIBaseURL), livekitgateway.New(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret), vault, cfg.SessionTTL)
	server := &http.Server{Addr: cfg.Address(), Handler: httpapi.NewRouter(app, cfg.JWTSecret, cfg.InternalAPIKey, cfg.CORSOrigins), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 40 * time.Second, WriteTimeout: 40 * time.Second, IdleTimeout: 75 * time.Second}
	if cfg.CallWorkerEnabled {
		go runWorker(ctx, app, cfg.CallWorkerInterval, logger)
	}
	go func() {
		logger.Info("StylMe AI control plane listening", "address", cfg.Address(), "worker", cfg.CallWorkerEnabled)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("http server failed", "error", err)
			cancel()
		}
	}()
	<-ctx.Done()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer shutdownCancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}

func runWorker(ctx context.Context, app *service.Service, interval time.Duration, logger *slog.Logger) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			workerCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			err := app.DispatchOne(workerCtx)
			cancel()
			if err != nil && !errors.Is(err, store.ErrNotFound) {
				logger.Error("call dispatch failed", "error", err)
			}
		}
	}
}
