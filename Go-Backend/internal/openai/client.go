package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"stylme/go-backend/internal/domain"
)

type Client struct {
	apiKey  string
	baseURL string
	http    *http.Client
}

type metadataFilter struct {
	Key    string   `json:"key"`
	Values []string `json:"values"`
}

type structuredPlan struct {
	AssistantMessage   string           `json:"assistantMessage"`
	NeedsClarification bool             `json:"needsClarification"`
	ClarifyingQuestion string           `json:"clarifyingQuestion"`
	LexicalQuery       string           `json:"lexicalQuery"`
	Brand              []string         `json:"brand"`
	Category           []string         `json:"category"`
	ProductType        []string         `json:"productType"`
	Colour             []string         `json:"colour"`
	Size               []string         `json:"size"`
	Gender             []string         `json:"gender"`
	MetadataFilters    []metadataFilter `json:"metadataFilters"`
	MinPrice           *float64         `json:"minPrice"`
	MaxPrice           *float64         `json:"maxPrice"`
	Pincode            string           `json:"pincode"`
	SwoopStyl          bool             `json:"swoopstyl"`
	Sort               string           `json:"sort"`
	ProfileProposal    []metadataFilter `json:"profileProposal"`
}

func New(apiKey, baseURL string) *Client {
	return &Client{apiKey: apiKey, baseURL: strings.TrimRight(baseURL, "/"), http: &http.Client{Timeout: 28 * time.Second}}
}

func (c *Client) WithAPIKey(apiKey string) *Client {
	return &Client{apiKey: strings.TrimSpace(apiKey), baseURL: c.baseURL, http: c.http}
}

func (c *Client) Available() bool { return strings.TrimSpace(c.apiKey) != "" }

func (c *Client) Plan(ctx context.Context, agent domain.Agent, history []domain.ChatMessage, userText string, filters, profile map[string]any) (domain.SearchPlan, error) {
	if !c.Available() {
		return domain.SearchPlan{}, errors.New("OPENAI_API_KEY is not configured")
	}
	filterJSON, _ := json.Marshal(filters)
	profileJSON, _ := json.Marshal(profile)
	if len(filterJSON) > 70_000 {
		filterJSON = filterJSON[:70_000]
	}
	if len(profileJSON) > 12_000 {
		profileJSON = profileJSON[:12_000]
	}
	system := agent.Instructions.System + "\n\n" + strings.Join(agent.Instructions.Guardrails, "\n") + `

SEARCH CONTRACT
- Output only exact filter keys and values present in AVAILABLE_FILTERS. Unknown values stay in lexicalQuery.
- OR within a facet, AND across facets. INR prices are rupees, not paise.
- SwoopStyl=true requires a six-digit pincode. Never promise delivery yourself.
- profileProposal may contain only durable, explicitly stated style preferences. It is a proposal, never a write.
- If enough context exists, set needsClarification=false and prepare the search immediately.

AVAILABLE_FILTERS:
` + string(filterJSON) + "\n\nPROFILE_RANKING_CONTEXT:\n" + string(profileJSON)
	messages := []map[string]string{{"role": "system", "content": system}}
	maxHistory := 12
	if agent.Web != nil && agent.Web.MaxHistoryMessages > 0 {
		maxHistory = agent.Web.MaxHistoryMessages
	}
	if len(history) > maxHistory {
		history = history[len(history)-maxHistory:]
	}
	for _, item := range history {
		if item.Role == "user" || item.Role == "assistant" {
			messages = append(messages, map[string]string{"role": item.Role, "content": item.Text})
		}
	}
	messages = append(messages, map[string]string{"role": "user", "content": userText})
	body := map[string]any{
		"model":                 agent.Model.Name,
		"messages":              messages,
		"response_format":       map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "stylme_search_plan", "strict": true, "schema": searchPlanSchema()}},
		"max_completion_tokens": agent.Model.MaxOutputTokens,
	}
	if agent.Model.ReasoningEffort != "" {
		body["reasoning_effort"] = agent.Model.ReasoningEffort
	}
	payload, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return domain.SearchPlan{}, err
	}
	req.Header.Set("authorization", "Bearer "+c.apiKey)
	req.Header.Set("content-type", "application/json")
	response, err := c.http.Do(req)
	if err != nil {
		return domain.SearchPlan{}, fmt.Errorf("openai request: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return domain.SearchPlan{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return domain.SearchPlan{}, fmt.Errorf("openai returned %d: %s", response.StatusCode, safeProviderError(raw))
	}
	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
				Refusal string `json:"refusal"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return domain.SearchPlan{}, fmt.Errorf("decode openai response: %w", err)
	}
	if len(result.Choices) == 0 {
		return domain.SearchPlan{}, errors.New("openai returned no choices")
	}
	if result.Choices[0].Message.Refusal != "" {
		return domain.SearchPlan{}, fmt.Errorf("openai refused the request")
	}
	var proposed structuredPlan
	if err := json.Unmarshal([]byte(result.Choices[0].Message.Content), &proposed); err != nil {
		return domain.SearchPlan{}, fmt.Errorf("decode structured search plan: %w", err)
	}
	metadata := map[string][]string{}
	for _, item := range proposed.MetadataFilters {
		if item.Key != "" && len(item.Values) > 0 {
			metadata[item.Key] = unique(item.Values)
		}
	}
	profileProposal := map[string]any{}
	for _, item := range proposed.ProfileProposal {
		if item.Key != "" && len(item.Values) > 0 {
			profileProposal[item.Key] = unique(item.Values)
		}
	}
	return domain.SearchPlan{
		AssistantMessage: proposed.AssistantMessage, NeedsClarification: proposed.NeedsClarification, ClarifyingQuestion: proposed.ClarifyingQuestion,
		LexicalQuery: proposed.LexicalQuery, Brand: unique(proposed.Brand), Category: unique(proposed.Category), ProductType: unique(proposed.ProductType), Colour: unique(proposed.Colour), Size: unique(proposed.Size), Gender: unique(proposed.Gender), Metadata: metadata,
		MinPrice: proposed.MinPrice, MaxPrice: proposed.MaxPrice, Pincode: proposed.Pincode, SwoopStyl: proposed.SwoopStyl, Sort: normalizeSort(proposed.Sort), ProfileProposal: profileProposal,
	}, nil
}

func (c *Client) Disposition(ctx context.Context, agent domain.Agent, transcript []domain.TranscriptTurn) (domain.Disposition, error) {
	if !c.Available() {
		return domain.Disposition{}, errors.New("OPENAI_API_KEY is not configured")
	}
	transcriptJSON, _ := json.Marshal(transcript)
	captureJSON, _ := json.Marshal(agent.Capture.Fields)
	system := `You extract a factual post-call disposition. Use only the transcript. Do not infer values that were not stated. Each requested capture field must appear either in capturedData or missingFields. The summary must be concise and must not include hidden reasoning.`
	input := "CAPTURE CONTRACT:\n" + string(captureJSON) + "\n\nTRANSCRIPT:\n" + string(transcriptJSON)
	schema := map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{
		"code": map[string]any{"type": "string"}, "summary": map[string]any{"type": "string"},
		"capturedData":  map[string]any{"type": "array", "items": map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"key": map[string]any{"type": "string"}, "value": map[string]any{"type": "string"}}, "required": []string{"key", "value"}}},
		"missingFields": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}, "nextAction": map[string]any{"type": "string"}, "confidence": map[string]any{"type": "number", "minimum": 0, "maximum": 1},
	}, "required": []string{"code", "summary", "capturedData", "missingFields", "nextAction", "confidence"}}
	body := map[string]any{"model": agent.Model.Name, "messages": []map[string]string{{"role": "system", "content": system}, {"role": "user", "content": input}}, "response_format": map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "stylme_call_disposition", "strict": true, "schema": schema}}, "max_completion_tokens": 700}
	if agent.Model.ReasoningEffort != "" {
		body["reasoning_effort"] = agent.Model.ReasoningEffort
	}
	var response struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := c.chat(ctx, body, &response); err != nil {
		return domain.Disposition{}, err
	}
	if len(response.Choices) == 0 {
		return domain.Disposition{}, errors.New("openai returned no disposition")
	}
	var raw struct {
		Code         string `json:"code"`
		Summary      string `json:"summary"`
		CapturedData []struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		} `json:"capturedData"`
		MissingFields []string `json:"missingFields"`
		NextAction    string   `json:"nextAction"`
		Confidence    float64  `json:"confidence"`
	}
	if err := json.Unmarshal([]byte(response.Choices[0].Message.Content), &raw); err != nil {
		return domain.Disposition{}, fmt.Errorf("decode disposition: %w", err)
	}
	captured := map[string]any{}
	for _, item := range raw.CapturedData {
		if item.Key != "" {
			captured[item.Key] = item.Value
		}
	}
	now := time.Now().UTC()
	return domain.Disposition{Code: raw.Code, Summary: raw.Summary, CapturedData: captured, MissingFields: unique(raw.MissingFields), NextAction: raw.NextAction, Confidence: raw.Confidence, GeneratedAt: &now}, nil
}

func (c *Client) chat(ctx context.Context, body map[string]any, target any) error {
	payload, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("authorization", "Bearer "+c.apiKey)
	req.Header.Set("content-type", "application/json")
	response, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("openai request: %w", err)
	}
	defer response.Body.Close()
	payload, err = io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("openai returned %d: %s", response.StatusCode, safeProviderError(payload))
	}
	if err := json.Unmarshal(payload, target); err != nil {
		return fmt.Errorf("decode openai response: %w", err)
	}
	return nil
}

func searchPlanSchema() map[string]any {
	stringArray := map[string]any{"type": "array", "items": map[string]any{"type": "string"}}
	nullableNumber := map[string]any{"anyOf": []any{map[string]any{"type": "number"}, map[string]any{"type": "null"}}}
	metadata := map[string]any{"type": "array", "items": map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"key": map[string]any{"type": "string"}, "values": stringArray}, "required": []string{"key", "values"}}}
	properties := map[string]any{
		"assistantMessage": map[string]any{"type": "string"}, "needsClarification": map[string]any{"type": "boolean"}, "clarifyingQuestion": map[string]any{"type": "string"},
		"lexicalQuery": map[string]any{"type": "string"}, "brand": stringArray, "category": stringArray, "productType": stringArray, "colour": stringArray, "size": stringArray, "gender": stringArray,
		"metadataFilters": metadata, "minPrice": nullableNumber, "maxPrice": nullableNumber, "pincode": map[string]any{"type": "string"}, "swoopstyl": map[string]any{"type": "boolean"},
		"sort": map[string]any{"type": "string", "enum": []string{"recommended", "newest", "price-low", "price-high", "rating"}}, "profileProposal": metadata,
	}
	return map[string]any{"type": "object", "additionalProperties": false, "properties": properties, "required": []string{"assistantMessage", "needsClarification", "clarifyingQuestion", "lexicalQuery", "brand", "category", "productType", "colour", "size", "gender", "metadataFilters", "minPrice", "maxPrice", "pincode", "swoopstyl", "sort", "profileProposal"}}
}

func normalizeSort(value string) string {
	switch value {
	case "newest", "price-low", "price-high", "rating":
		return value
	default:
		return "recommended"
	}
}

func unique(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func safeProviderError(raw []byte) string {
	var value struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &value) == nil && value.Error.Message != "" {
		return value.Error.Message
	}
	return "provider request failed"
}
