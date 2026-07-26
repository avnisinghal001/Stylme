package service

import (
	"context"
	"testing"
	"time"

	"stylme/go-backend/internal/domain"
	"stylme/go-backend/internal/store"
)

type memoryCredentialStore struct {
	items   map[string]domain.ProviderCredential
	upserts int
}

func newMemoryCredentialStore() *memoryCredentialStore {
	return &memoryCredentialStore{items: map[string]domain.ProviderCredential{}}
}

func (s *memoryCredentialStore) ListCredentials(context.Context) ([]domain.ProviderCredential, error) {
	items := make([]domain.ProviderCredential, 0, len(s.items))
	for _, item := range s.items {
		items = append(items, item)
	}
	return items, nil
}

func (s *memoryCredentialStore) GetActiveCredential(_ context.Context, provider string, now time.Time) (domain.ProviderCredential, error) {
	var selected domain.ProviderCredential
	found := false
	for _, item := range s.items {
		if item.Provider != provider || item.Status != "active" || (item.ExpiresAt != nil && !item.ExpiresAt.After(now)) {
			continue
		}
		if !found || item.UpdatedAt.After(selected.UpdatedAt) {
			selected, found = item, true
		}
	}
	if !found {
		return domain.ProviderCredential{}, store.ErrNotFound
	}
	return selected, nil
}

func (s *memoryCredentialStore) UpsertCredential(_ context.Context, credential domain.ProviderCredential) error {
	if existing, ok := s.items[credential.ID]; ok {
		credential.CreatedAt = existing.CreatedAt
		credential.CreatedBy = existing.CreatedBy
	}
	s.items[credential.ID] = credential
	s.upserts++
	return nil
}

func (s *memoryCredentialStore) DeactivateProviderCredentials(_ context.Context, provider, exceptID string) error {
	for id, item := range s.items {
		if item.Provider == provider && item.Status == "active" && id != exceptID {
			item.Status = "superseded"
			s.items[id] = item
		}
	}
	return nil
}

func TestCredentialEncryptionRoundTrip(t *testing.T) {
	vault := NewCredentialVault(nil, "a-test-only-encryption-key", nil)
	ciphertext, err := vault.encrypt("sarvam-secret-value")
	if err != nil {
		t.Fatal(err)
	}
	if ciphertext == "sarvam-secret-value" {
		t.Fatal("credential was stored as plaintext")
	}
	plain, err := vault.decrypt(ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if plain != "sarvam-secret-value" {
		t.Fatalf("unexpected decrypted value %q", plain)
	}
}

func TestCredentialHintDoesNotExposeSecret(t *testing.T) {
	if hint := maskHint("secret-12345678"); hint != "••••5678" {
		t.Fatalf("unexpected hint %q", hint)
	}
}

func TestCredentialSaveUpsertsOneStableProviderDocument(t *testing.T) {
	data := newMemoryCredentialStore()
	vault := NewCredentialVault(data, "a-test-only-encryption-key", nil)
	ctx := context.Background()
	if _, err := vault.Save(ctx, CredentialInput{Provider: "openai", APIKey: "first-secret-key"}, "owner-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := vault.Save(ctx, CredentialInput{Provider: "openai", APIKey: "second-secret-key"}, "owner-2"); err != nil {
		t.Fatal(err)
	}
	if len(data.items) != 1 {
		t.Fatalf("expected one provider document, got %d", len(data.items))
	}
	if _, ok := data.items["credential_openai"]; !ok {
		t.Fatalf("stable OpenAI document was not upserted: %#v", data.items)
	}
	secret, source, err := vault.Resolve(ctx, "openai")
	if err != nil {
		t.Fatal(err)
	}
	if secret != "second-secret-key" || source != "database" {
		t.Fatalf("unexpected resolved credential source=%q secret=%q", source, secret)
	}
}

func TestEnsureFallbacksBootstrapsMongoOnceWithOpenAIFirst(t *testing.T) {
	data := newMemoryCredentialStore()
	vault := NewCredentialVault(data, "a-test-only-encryption-key", map[string]string{
		"openai": "openai-environment-secret",
		"sarvam": "sarvam-environment-secret",
	})
	ctx := context.Background()
	if err := vault.EnsureFallbacks(ctx); err != nil {
		t.Fatal(err)
	}
	if data.upserts != 2 {
		t.Fatalf("expected two initial upserts, got %d", data.upserts)
	}
	if err := vault.EnsureFallbacks(ctx); err != nil {
		t.Fatal(err)
	}
	if data.upserts != 2 {
		t.Fatalf("active Mongo credentials should not be overwritten, got %d upserts", data.upserts)
	}
	statuses, err := vault.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(statuses) != 3 || statuses[0].Provider != "openai" {
		t.Fatalf("OpenAI must be first in credential status: %#v", statuses)
	}
	if statuses[0].Source != "database" {
		t.Fatalf("expected Mongo-backed OpenAI key, got %#v", statuses[0])
	}
	if priority := data.items["credential_openai"].Metadata["priority"]; priority != 1 {
		t.Fatalf("expected OpenAI priority 1, got %#v", priority)
	}
}
