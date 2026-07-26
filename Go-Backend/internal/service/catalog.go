package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"stylme/go-backend/internal/domain"
)

type CatalogClient struct {
	baseURL string
	http    *http.Client
}

func NewCatalogClient(baseURL string) *CatalogClient {
	return &CatalogClient{baseURL: baseURL, http: &http.Client{Timeout: 25 * time.Second}}
}

func (c *CatalogClient) Filters(ctx context.Context) (map[string]any, error) {
	return c.get(ctx, "/filters", "")
}

func (c *CatalogClient) Profile(ctx context.Context, authorization string) (map[string]any, error) {
	if authorization == "" {
		return map[string]any{}, nil
	}
	return c.get(ctx, "/profile", authorization)
}

func (c *CatalogClient) Search(ctx context.Context, query string, plan domain.SearchPlan, profile map[string]any) (map[string]any, error) {
	payload := map[string]any{
		"query": query, "lexicalQuery": plan.LexicalQuery, "page": 1, "pageSize": 8,
		"brand": plan.Brand, "category": plan.Category, "productType": plan.ProductType,
		"colour": plan.Colour, "size": plan.Size, "gender": plan.Gender, "metadata": plan.Metadata,
		"minPrice": plan.MinPrice, "maxPrice": plan.MaxPrice, "sort": plan.Sort, "swoopstyl": plan.SwoopStyl,
	}
	if plan.Pincode != "" {
		payload["pincode"] = plan.Pincode
	}
	copyProfileNumber(payload, profile, "age", "profileAge")
	copyProfileNumber(payload, profile, "heightCm", "profileHeightCm")
	copyProfileNumber(payload, profile, "weightKg", "profileWeightKg")
	if genders, ok := profile["genderKeys"].([]any); ok {
		payload["profileGender"] = genders
	}
	return c.post(ctx, "/search/advanced", payload, "")
}

func (c *CatalogClient) CheckoutRecoveryCandidates(ctx context.Context, limit int, secret string) (map[string]any, error) {
	if limit < 1 || limit > 500 {
		limit = 100
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/public/checkout-recovery/candidates?limit=%d", c.baseURL, limit), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Cron-Secret", secret)
	return c.do(req)
}

func (c *CatalogClient) get(ctx context.Context, path, authorization string) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	if authorization != "" {
		req.Header.Set("authorization", authorization)
	}
	return c.do(req)
}

func (c *CatalogClient) post(ctx context.Context, path string, value any, authorization string) (map[string]any, error) {
	payload, _ := json.Marshal(value)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	if authorization != "" {
		req.Header.Set("authorization", authorization)
	}
	return c.do(req)
}

func (c *CatalogClient) do(req *http.Request) (map[string]any, error) {
	response, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("catalog request: %w", err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 5<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := strings.TrimSpace(string(payload))
		if len(message) > 1200 {
			message = message[:1200]
		}
		return nil, fmt.Errorf("catalog returned %d: %s", response.StatusCode, message)
	}
	var result map[string]any
	if err := json.Unmarshal(payload, &result); err != nil {
		return nil, fmt.Errorf("decode catalog response: %w", err)
	}
	return result, nil
}

func copyProfileNumber(target, profile map[string]any, sourceKey, targetKey string) {
	if value, ok := profile[sourceKey]; ok && value != nil {
		target[targetKey] = value
	}
}
