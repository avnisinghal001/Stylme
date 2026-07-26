package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port                    string
	MongoURI                string
	MongoDatabase           string
	JWTSecret               string
	JWTAlgorithm            string
	InternalAPIKey          string
	CredentialEncryptionKey string
	CORSOrigins             []string
	PythonAPIBaseURL        string
	OpenAIAPIKey            string
	OpenAIModel             string
	OpenAIBaseURL           string
	DeepgramAPIKey          string
	SarvamAPIKey            string
	LiveKitURL              string
	LiveKitAPIKey           string
	LiveKitAPISecret        string
	CallWorkerEnabled       bool
	CallWorkerInterval      time.Duration
	SessionTTL              time.Duration
	ShutdownTimeout         time.Duration
}

func Load() (Config, error) {
	loadRootEnv()
	cfg := Config{
		Port: env("GO_API_PORT", env("PORT", "8081")), MongoURI: env("MIGRATE_DESTINATION_MONGO_URI", env("MONGODB_URL", "")), MongoDatabase: env("MONGODB_DB_NAME", "StylMe"),
		JWTSecret: env("JWT_SECRET", ""), JWTAlgorithm: env("JWT_ALGORITHM", "HS256"), InternalAPIKey: env("AI_INTERNAL_API_KEY", env("CRON_SECRET", "")),
		CredentialEncryptionKey: env("CREDENTIAL_ENCRYPTION_KEY", env("JWT_SECRET", "")),
		CORSOrigins: splitCSV(env(
			"GO_CORS_ORIGINS",
			env("CORS_ORIGINS", "http://localhost:3000,https://fitstylme.vercel.app,https://stylme-swoopstyl.vercel.app"),
		)),
		PythonAPIBaseURL: strings.TrimRight(env("PYTHON_API_BASE_URL", env("NEXT_PUBLIC_API_BASE_URL", "http://localhost:8000/api/v1")), "/"),
		OpenAIAPIKey:     env("OPENAI_API_KEY", ""), OpenAIModel: env("AI_OPENAI_MODEL", "gpt-5.6-luna"), OpenAIBaseURL: strings.TrimRight(env("OPENAI_BASE_URL", "https://api.openai.com/v1"), "/"),
		DeepgramAPIKey: env("DEEPGRAM_API_KEY", ""), SarvamAPIKey: env("SARVAM_API_KEY", ""),
		LiveKitURL: env("LIVEKIT_URL", ""), LiveKitAPIKey: env("LIVEKIT_API_KEY", ""), LiveKitAPISecret: env("LIVEKIT_API_SECRET", ""),
		CallWorkerEnabled: envBool("CALL_WORKER_ENABLED", false), CallWorkerInterval: envDuration("CALL_WORKER_INTERVAL", 2*time.Second),
		SessionTTL: envDuration("AI_SESSION_TTL", 24*time.Hour), ShutdownTimeout: envDuration("SHUTDOWN_TIMEOUT", 10*time.Second),
	}
	if cfg.MongoURI == "" {
		return Config{}, errors.New("MONGODB_URL is required in the root .env or process environment")
	}
	if cfg.JWTSecret == "" {
		return Config{}, errors.New("JWT_SECRET is required so the Go service can share FastAPI authentication")
	}
	return cfg, nil
}

func loadRootEnv() {
	if explicit := strings.TrimSpace(os.Getenv("STYLME_ENV_FILE")); explicit != "" {
		_ = loadEnvFile(explicit)
		return
	}
	current, err := os.Getwd()
	if err != nil {
		return
	}
	for i := 0; i < 5; i++ {
		candidate := filepath.Join(current, ".env")
		if _, err := os.Stat(candidate); err == nil {
			_ = loadEnvFile(candidate)
			return
		}
		parent := filepath.Dir(current)
		if parent == current {
			return
		}
		current = parent
	}
}

func loadEnvFile(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(strings.TrimPrefix(key, "export "))
		if key == "" {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && ((value[0] == '\'' && value[len(value)-1] == '\'') || (value[0] == '"' && value[len(value)-1] == '"')) {
			value = value[1 : len(value)-1]
		}
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, value)
		}
	}
	return scanner.Err()
}

func env(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	value, ok := os.LookupEnv(key)
	if !ok {
		return fallback
	}
	parsed, err := strconv.ParseBool(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	return parsed
}

func envDuration(key string, fallback time.Duration) time.Duration {
	value, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	return parsed
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func (c Config) Address() string { return fmt.Sprintf(":%s", c.Port) }
