package service

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"stylme/go-backend/internal/domain"
	"stylme/go-backend/internal/store"
)

var supportedCredentialProviders = map[string]bool{
	"openai": true, "deepgram": true, "sarvam": true,
}

var credentialProviderPriority = []string{"openai", "deepgram", "sarvam"}

type credentialStore interface {
	ListCredentials(context.Context) ([]domain.ProviderCredential, error)
	GetActiveCredential(context.Context, string, time.Time) (domain.ProviderCredential, error)
	UpsertCredential(context.Context, domain.ProviderCredential) error
	DeactivateProviderCredentials(context.Context, string, string) error
}

type CredentialVault struct {
	store    credentialStore
	key      [32]byte
	fallback map[string]string
}

type CredentialInput struct {
	Provider  string          `json:"provider"`
	Label     string          `json:"label"`
	APIKey    string          `json:"apiKey"`
	ExpiresAt *time.Time      `json:"expiresAt"`
	Metadata  domain.Metadata `json:"metadata"`
}

type CredentialStatus struct {
	Provider   string     `json:"provider"`
	Configured bool       `json:"configured"`
	Source     string     `json:"source"`
	KeyHint    string     `json:"keyHint,omitempty"`
	Status     string     `json:"status"`
	ExpiresAt  *time.Time `json:"expiresAt,omitempty"`
	UpdatedAt  *time.Time `json:"updatedAt,omitempty"`
}

func NewCredentialVault(data credentialStore, encryptionKey string, fallback map[string]string) *CredentialVault {
	return &CredentialVault{store: data, key: sha256.Sum256([]byte(encryptionKey)), fallback: fallback}
}

func (v *CredentialVault) Save(ctx context.Context, input CredentialInput, actor string) (CredentialStatus, error) {
	provider := strings.ToLower(strings.TrimSpace(input.Provider))
	secret := strings.TrimSpace(input.APIKey)
	if !supportedCredentialProviders[provider] {
		return CredentialStatus{}, errors.New("provider must be openai, deepgram, or sarvam")
	}
	if len(secret) < 8 || len(secret) > 4096 {
		return CredentialStatus{}, errors.New("apiKey must contain 8 to 4096 characters")
	}
	if input.ExpiresAt != nil && !input.ExpiresAt.After(time.Now().UTC()) {
		return CredentialStatus{}, errors.New("expiresAt must be in the future")
	}
	ciphertext, err := v.encrypt(secret)
	if err != nil {
		return CredentialStatus{}, err
	}
	now := time.Now().UTC()
	credential := domain.ProviderCredential{
		ID: providerCredentialID(provider), Provider: provider, Label: strings.TrimSpace(input.Label),
		Ciphertext: ciphertext, KeyHint: maskHint(secret), Status: "active", ExpiresAt: input.ExpiresAt,
		Metadata: input.Metadata, CreatedBy: actor, UpdatedBy: actor, CreatedAt: now, UpdatedAt: now,
	}
	if credential.Label == "" {
		credential.Label = strings.Title(provider) + " runtime key"
	}
	if credential.Metadata == nil {
		credential.Metadata = domain.Metadata{}
	}
	if err := v.store.UpsertCredential(ctx, credential); err != nil {
		return CredentialStatus{}, err
	}
	if err := v.store.DeactivateProviderCredentials(ctx, provider, credential.ID); err != nil {
		return CredentialStatus{}, err
	}
	return statusFromCredential(credential), nil
}

// EnsureFallbacks persists deployment-provided keys into the encrypted Mongo
// vault only when the provider has no current database credential. This gives
// all serverless instances one shared source of truth without overwriting a
// key that an administrator rotated in Agent Studio.
func (v *CredentialVault) EnsureFallbacks(ctx context.Context) error {
	for priority, provider := range credentialProviderPriority {
		secret := strings.TrimSpace(v.fallback[provider])
		if secret == "" {
			continue
		}
		if _, err := v.store.GetActiveCredential(ctx, provider, time.Now().UTC()); err == nil {
			continue
		} else if !errors.Is(err, store.ErrNotFound) {
			return fmt.Errorf("check %s credential: %w", provider, err)
		}
		_, err := v.Save(ctx, CredentialInput{
			Provider: provider,
			Label:    strings.Title(provider) + " deployment key",
			APIKey:   secret,
			Metadata: domain.Metadata{"source": "environment-bootstrap", "priority": priority + 1},
		}, "environment-bootstrap")
		if err != nil {
			return fmt.Errorf("bootstrap %s credential: %w", provider, err)
		}
	}
	return nil
}

func (v *CredentialVault) List(ctx context.Context) ([]CredentialStatus, error) {
	stored, err := v.store.ListCredentials(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	byProvider := map[string]domain.ProviderCredential{}
	for _, item := range stored {
		if _, exists := byProvider[item.Provider]; !exists && item.Status == "active" && (item.ExpiresAt == nil || item.ExpiresAt.After(now)) {
			byProvider[item.Provider] = item
		}
	}
	result := make([]CredentialStatus, 0, len(credentialProviderPriority))
	for _, provider := range credentialProviderPriority {
		if item, ok := byProvider[provider]; ok {
			result = append(result, statusFromCredential(item))
			continue
		}
		fallback := strings.TrimSpace(v.fallback[provider])
		status := CredentialStatus{Provider: provider, Configured: fallback != "", Source: "none", Status: "missing"}
		if fallback != "" {
			status.Source, status.Status, status.KeyHint = "environment", "active", maskHint(fallback)
		}
		result = append(result, status)
	}
	return result, nil
}

func (v *CredentialVault) Resolve(ctx context.Context, provider string) (string, string, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if !supportedCredentialProviders[provider] {
		return "", "none", errors.New("unsupported credential provider")
	}
	credential, err := v.store.GetActiveCredential(ctx, provider, time.Now().UTC())
	if err == nil {
		secret, decryptErr := v.decrypt(credential.Ciphertext)
		if decryptErr != nil {
			return "", "database", fmt.Errorf("decrypt %s credential: %w", provider, decryptErr)
		}
		return secret, "database", nil
	}
	if !errors.Is(err, store.ErrNotFound) {
		return "", "none", err
	}
	if fallback := strings.TrimSpace(v.fallback[provider]); fallback != "" {
		return fallback, "environment", nil
	}
	return "", "none", nil
}

func (v *CredentialVault) Runtime(ctx context.Context) (map[string]string, error) {
	result := map[string]string{}
	for _, provider := range credentialProviderPriority {
		secret, _, err := v.Resolve(ctx, provider)
		if err != nil {
			return nil, err
		}
		if secret != "" {
			result[provider] = secret
		}
	}
	return result, nil
}

func providerCredentialID(provider string) string {
	return "credential_" + strings.ToLower(strings.TrimSpace(provider))
}

func (v *CredentialVault) encrypt(value string) (string, error) {
	block, err := aes.NewCipher(v.key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(value), []byte("stylme-provider-credential-v1"))
	return base64.RawURLEncoding.EncodeToString(sealed), nil
}

func (v *CredentialVault) decrypt(value string) (string, error) {
	sealed, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(v.key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(sealed) < gcm.NonceSize() {
		return "", errors.New("encrypted credential is truncated")
	}
	plain, err := gcm.Open(nil, sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():], []byte("stylme-provider-credential-v1"))
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func statusFromCredential(value domain.ProviderCredential) CredentialStatus {
	updated := value.UpdatedAt
	return CredentialStatus{Provider: value.Provider, Configured: true, Source: "database", KeyHint: value.KeyHint, Status: value.Status, ExpiresAt: value.ExpiresAt, UpdatedAt: &updated}
}

func maskHint(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 4 {
		return "••••"
	}
	return "••••" + value[len(value)-4:]
}
