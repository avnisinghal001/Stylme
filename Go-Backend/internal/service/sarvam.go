package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	SarvamBulbulV3Model    = "bulbul:v3"
	maxPreviewCharacters   = 500
	maxSarvamResponseBytes = 8 << 20
)

var ErrSarvamCredentialMissing = errors.New("Sarvam API key is not configured")

type SarvamValidationError struct {
	Message string
}

func (e *SarvamValidationError) Error() string {
	return e.Message
}

type SarvamVoice struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Gender string `json:"gender"`
}

type SarvamVoiceCatalog struct {
	Provider  string        `json:"provider"`
	Model     string        `json:"model"`
	Default   string        `json:"default"`
	Items     []SarvamVoice `json:"items"`
	Languages []string      `json:"languages"`
}

type SarvamPreviewInput struct {
	Speaker  string  `json:"speaker"`
	Language string  `json:"language"`
	Text     string  `json:"text"`
	Pace     float64 `json:"pace"`
}

type SarvamPreviewResult struct {
	Audio       []byte
	ContentType string
	RequestID   string
}

type SarvamUpstreamError struct {
	StatusCode int
	cause      error
}

func (e *SarvamUpstreamError) Error() string {
	if e.StatusCode == 429 {
		return "Sarvam preview rate limit reached; try again shortly"
	}
	return "Sarvam could not generate this preview"
}

func (e *SarvamUpstreamError) Unwrap() error {
	return e.cause
}

type sarvamHTTPClient interface {
	Do(*http.Request) (*http.Response, error)
}

type SarvamClient struct {
	baseURL string
	client  sarvamHTTPClient
}

func NewSarvamClient(baseURL string, client sarvamHTTPClient) *SarvamClient {
	if strings.TrimSpace(baseURL) == "" {
		baseURL = "https://api.sarvam.ai"
	}
	if client == nil {
		client = &http.Client{Timeout: 25 * time.Second}
	}
	return &SarvamClient{baseURL: strings.TrimRight(baseURL, "/"), client: client}
}

func SarvamVoices() SarvamVoiceCatalog {
	items := []SarvamVoice{
		{ID: "ritu", Name: "Ritu", Gender: "female"},
		{ID: "priya", Name: "Priya", Gender: "female"},
		{ID: "neha", Name: "Neha", Gender: "female"},
		{ID: "pooja", Name: "Pooja", Gender: "female"},
		{ID: "simran", Name: "Simran", Gender: "female"},
		{ID: "kavya", Name: "Kavya", Gender: "female"},
		{ID: "ishita", Name: "Ishita", Gender: "female"},
		{ID: "shreya", Name: "Shreya", Gender: "female"},
		{ID: "roopa", Name: "Roopa", Gender: "female"},
		{ID: "tanya", Name: "Tanya", Gender: "female"},
		{ID: "shruti", Name: "Shruti", Gender: "female"},
		{ID: "suhani", Name: "Suhani", Gender: "female"},
		{ID: "kavitha", Name: "Kavitha", Gender: "female"},
		{ID: "rupali", Name: "Rupali", Gender: "female"},
		{ID: "shubh", Name: "Shubh", Gender: "male"},
		{ID: "aditya", Name: "Aditya", Gender: "male"},
		{ID: "rahul", Name: "Rahul", Gender: "male"},
		{ID: "rohan", Name: "Rohan", Gender: "male"},
		{ID: "amit", Name: "Amit", Gender: "male"},
		{ID: "dev", Name: "Dev", Gender: "male"},
		{ID: "ratan", Name: "Ratan", Gender: "male"},
		{ID: "varun", Name: "Varun", Gender: "male"},
		{ID: "manan", Name: "Manan", Gender: "male"},
		{ID: "sumit", Name: "Sumit", Gender: "male"},
		{ID: "kabir", Name: "Kabir", Gender: "male"},
		{ID: "aayan", Name: "Aayan", Gender: "male"},
		{ID: "ashutosh", Name: "Ashutosh", Gender: "male"},
		{ID: "advait", Name: "Advait", Gender: "male"},
		{ID: "anand", Name: "Anand", Gender: "male"},
		{ID: "tarun", Name: "Tarun", Gender: "male"},
		{ID: "sunny", Name: "Sunny", Gender: "male"},
		{ID: "mani", Name: "Mani", Gender: "male"},
		{ID: "gokul", Name: "Gokul", Gender: "male"},
		{ID: "vijay", Name: "Vijay", Gender: "male"},
		{ID: "mohit", Name: "Mohit", Gender: "male"},
		{ID: "rehan", Name: "Rehan", Gender: "male"},
		{ID: "soham", Name: "Soham", Gender: "male"},
	}
	return SarvamVoiceCatalog{
		Provider: "sarvam", Model: SarvamBulbulV3Model, Default: "shubh", Items: items,
		Languages: []string{"en-IN", "hi-IN", "bn-IN", "ta-IN", "te-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "pa-IN", "od-IN"},
	}
}

func IsSupportedSarvamVoice(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	for _, voice := range SarvamVoices().Items {
		if voice.ID == value {
			return true
		}
	}
	return false
}

func validateSarvamPreview(input SarvamPreviewInput) error {
	if !IsSupportedSarvamVoice(input.Speaker) {
		return &SarvamValidationError{Message: "speaker is not supported by Sarvam Bulbul v3"}
	}
	if !supportedBulbulLanguages[input.Language] {
		return &SarvamValidationError{Message: "language is not supported by Sarvam Bulbul v3"}
	}
	text := strings.TrimSpace(input.Text)
	if text == "" || len([]rune(text)) > maxPreviewCharacters {
		return &SarvamValidationError{Message: fmt.Sprintf("text must contain 1 to %d characters", maxPreviewCharacters)}
	}
	if input.Pace < 0.5 || input.Pace > 2 {
		return &SarvamValidationError{Message: "pace must be between 0.5 and 2.0"}
	}
	return nil
}

func (c *SarvamClient) Synthesize(ctx context.Context, apiKey string, input SarvamPreviewInput) (SarvamPreviewResult, error) {
	if err := validateSarvamPreview(input); err != nil {
		return SarvamPreviewResult{}, err
	}
	payload, err := json.Marshal(map[string]any{
		"text": strings.TrimSpace(input.Text), "target_language_code": input.Language,
		"speaker": strings.ToLower(strings.TrimSpace(input.Speaker)), "pace": input.Pace,
		"model": SarvamBulbulV3Model, "speech_sample_rate": 22050, "output_audio_codec": "wav",
	})
	if err != nil {
		return SarvamPreviewResult{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/text-to-speech", bytes.NewReader(payload))
	if err != nil {
		return SarvamPreviewResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("api-subscription-key", apiKey)
	response, err := c.client.Do(request)
	if err != nil {
		return SarvamPreviewResult{}, &SarvamUpstreamError{cause: err}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
		return SarvamPreviewResult{}, &SarvamUpstreamError{StatusCode: response.StatusCode}
	}
	var decoded struct {
		RequestID string   `json:"request_id"`
		Audios    []string `json:"audios"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, maxSarvamResponseBytes)).Decode(&decoded); err != nil {
		return SarvamPreviewResult{}, &SarvamUpstreamError{StatusCode: response.StatusCode, cause: err}
	}
	if len(decoded.Audios) == 0 {
		return SarvamPreviewResult{}, &SarvamUpstreamError{StatusCode: response.StatusCode}
	}
	audio, err := base64.StdEncoding.DecodeString(decoded.Audios[0])
	if err != nil || len(audio) == 0 {
		return SarvamPreviewResult{}, &SarvamUpstreamError{StatusCode: response.StatusCode, cause: err}
	}
	return SarvamPreviewResult{Audio: audio, ContentType: "audio/wav", RequestID: decoded.RequestID}, nil
}

func (s *Service) PreviewSarvamVoice(ctx context.Context, input SarvamPreviewInput) (SarvamPreviewResult, error) {
	if err := validateSarvamPreview(input); err != nil {
		return SarvamPreviewResult{}, err
	}
	if s.Credentials == nil || s.Sarvam == nil {
		return SarvamPreviewResult{}, ErrSarvamCredentialMissing
	}
	apiKey, _, err := s.Credentials.Resolve(ctx, "sarvam")
	if err != nil {
		return SarvamPreviewResult{}, err
	}
	if strings.TrimSpace(apiKey) == "" {
		return SarvamPreviewResult{}, ErrSarvamCredentialMissing
	}
	return s.Sarvam.Synthesize(ctx, apiKey, input)
}
