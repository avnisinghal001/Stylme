package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"stylme/go-backend/internal/domain"
)

func TestSarvamVoiceCatalogMatchesCurrentBulbulV3Contract(t *testing.T) {
	catalog := SarvamVoices()
	if catalog.Model != "bulbul:v3" || len(catalog.Items) != 37 {
		t.Fatalf("expected 37 bulbul:v3 voices, got model=%q count=%d", catalog.Model, len(catalog.Items))
	}
	seen := map[string]bool{}
	genderCounts := map[string]int{}
	for _, voice := range catalog.Items {
		if voice.ID == "" || voice.Name == "" || seen[voice.ID] {
			t.Fatalf("invalid or duplicate voice: %#v", voice)
		}
		seen[voice.ID] = true
		genderCounts[voice.Gender]++
	}
	if genderCounts["female"] != 14 || genderCounts["male"] != 23 {
		t.Fatalf("unexpected voice gender counts: %#v", genderCounts)
	}
	for _, id := range []string{"shubh", "rupali", "anand", "tarun", "soham"} {
		if !seen[id] {
			t.Fatalf("current Sarvam voice %q is missing", id)
		}
	}
	for _, deprecated := range []string{"amelia", "sophia"} {
		if seen[deprecated] {
			t.Fatalf("voice %q is not in Sarvam's current documented catalog", deprecated)
		}
	}
}

func TestValidateSarvamPreviewRejectsUnsupportedConfiguration(t *testing.T) {
	cases := []SarvamPreviewInput{
		{Speaker: "not-a-voice", Language: "en-IN", Text: "Hello", Pace: 1},
		{Speaker: "shubh", Language: "fr-FR", Text: "Hello", Pace: 1},
		{Speaker: "shubh", Language: "en-IN", Text: "", Pace: 1},
		{Speaker: "shubh", Language: "en-IN", Text: "Hello", Pace: 2.1},
	}
	for _, input := range cases {
		if err := validateSarvamPreview(input); err == nil {
			t.Fatalf("expected validation error for %#v", input)
		} else {
			var validation *SarvamValidationError
			if !errors.As(err, &validation) {
				t.Fatalf("expected typed validation error, got %T", err)
			}
		}
	}
}

type sarvamHTTPClientFunc func(*http.Request) (*http.Response, error)

func (f sarvamHTTPClientFunc) Do(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestSarvamClientClassifiesTransportFailureAsUpstream(t *testing.T) {
	client := NewSarvamClient("https://sarvam.invalid", sarvamHTTPClientFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("dial failed with internal detail")
	}))
	_, err := client.Synthesize(context.Background(), "server-secret", SarvamPreviewInput{
		Speaker: "shubh", Language: "en-IN", Text: "Hello", Pace: 1,
	})
	var upstream *SarvamUpstreamError
	if !errors.As(err, &upstream) || upstream.StatusCode != 0 {
		t.Fatalf("expected safe upstream error, got %T: %v", err, err)
	}
}

func TestSarvamClientSynthesizesWavWithoutLeakingCredential(t *testing.T) {
	wav := []byte("RIFF-test-wave")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/text-to-speech" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("api-subscription-key"); got != "server-secret" {
			t.Fatalf("missing server-side Sarvam credential, got %q", got)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["speaker"] != "priya" || body["target_language_code"] != "hi-IN" || body["model"] != "bulbul:v3" {
			t.Fatalf("unexpected Sarvam payload: %#v", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req-1", "audios": []string{base64.StdEncoding.EncodeToString(wav)}})
	}))
	defer server.Close()

	client := NewSarvamClient(server.URL, server.Client())
	result, err := client.Synthesize(context.Background(), "server-secret", SarvamPreviewInput{
		Speaker: "priya", Language: "hi-IN", Text: "Namaste", Pace: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(result.Audio) != string(wav) || result.RequestID != "req-1" || result.ContentType != "audio/wav" {
		t.Fatalf("unexpected preview result: %#v", result)
	}
}

func TestSaveAgentRejectsSpeakerOutsideSarvamCatalog(t *testing.T) {
	app := &Service{}
	_, err := app.SaveAgent(context.Background(), domain.Agent{
		Key: "voice-agent", Name: "Voice agent", Channels: []string{"voice"},
		Instructions: domain.Instructions{System: "Help the caller."},
		Model:        domain.ModelConfig{Provider: "openai"},
		Voice: &domain.VoiceConfig{
			Language: "en-IN", STTProvider: "deepgram", STTModel: "nova-3",
			TTSProvider: "sarvam", TTSModel: "bulbul:v3", Speaker: "not-a-voice", Pace: 1,
		},
	}, "admin")
	if err == nil {
		t.Fatal("expected unsupported Sarvam speaker to be rejected before persistence")
	}
}
