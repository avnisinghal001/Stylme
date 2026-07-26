package handler

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"stylme/go-backend/internal/config"
	"stylme/go-backend/internal/httpapi"
	livekitgateway "stylme/go-backend/internal/livekit"
	openaiapi "stylme/go-backend/internal/openai"
	"stylme/go-backend/internal/service"
	"stylme/go-backend/internal/store"
)

var (
	appMu sync.Mutex
	app   http.Handler
)

// Handler is the Vercel Go entrypoint. Long-running call dispatch is not
// started here; an external scheduler invokes POST /v1/runtime/dispatch.
func Handler(w http.ResponseWriter, r *http.Request) {
	if app == nil {
		appMu.Lock()
		if app == nil {
			initialized, err := initialize()
			if err != nil {
				appMu.Unlock()
				http.Error(w, "control plane initialization failed", http.StatusServiceUnavailable)
				return
			}
			app = initialized
		}
		appMu.Unlock()
	}
	app.ServeHTTP(w, r)
}

func initialize() (http.Handler, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	data, err := store.New(ctx, cfg.MongoURI, cfg.MongoDatabase)
	if err != nil {
		return nil, err
	}
	if err := data.EnsureIndexes(ctx); err != nil {
		return nil, fmt.Errorf("initialize indexes: %w", err)
	}
	if err := data.SeedDefaults(ctx, cfg.OpenAIModel); err != nil {
		return nil, fmt.Errorf("seed defaults: %w", err)
	}
	ai := openaiapi.New(cfg.OpenAIAPIKey, cfg.OpenAIBaseURL)
	vault := service.NewCredentialVault(data, cfg.CredentialEncryptionKey, map[string]string{
		"openai": cfg.OpenAIAPIKey, "deepgram": cfg.DeepgramAPIKey, "sarvam": cfg.SarvamAPIKey,
	})
	if err := vault.EnsureFallbacks(ctx); err != nil {
		return nil, fmt.Errorf("initialize provider credentials: %w", err)
	}
	application := service.New(
		data,
		ai,
		service.NewCatalogClient(cfg.PythonAPIBaseURL),
		livekitgateway.New(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret),
		vault,
		cfg.SessionTTL,
	)
	return httpapi.NewRouter(application, cfg.JWTSecret, cfg.InternalAPIKey, cfg.CORSOrigins), nil
}
