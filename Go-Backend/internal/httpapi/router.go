package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"stylme/go-backend/internal/domain"
	"stylme/go-backend/internal/service"
	"stylme/go-backend/internal/store"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
)

type Handler struct {
	service     *service.Service
	jwtSecret   []byte
	internalKey string
	corsOrigins map[string]bool
}

type actorKey struct{}
type actor struct {
	UserID string
	Roles  []string
}

func NewRouter(app *service.Service, jwtSecret, internalKey string, origins []string) http.Handler {
	h := &Handler{service: app, jwtSecret: []byte(jwtSecret), internalKey: internalKey, corsOrigins: map[string]bool{}}
	for _, origin := range origins {
		h.corsOrigins[origin] = true
	}
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Recoverer, middleware.Timeout(35*time.Second), h.cors)
	r.Get("/health", h.health)
	r.Route("/v1", func(r chi.Router) {
		r.Get("/public/ai/config", h.publicConfig)
		r.Post("/web/sessions", h.createSession)
		r.Post("/web/sessions/{id}/messages", h.webMessage)
		r.Group(func(r chi.Router) {
			r.Use(h.requireAdmin)
			r.Get("/agents", h.listAgents)
			r.Get("/tools", h.listTools)
			r.Post("/agents", h.saveAgent)
			r.Put("/agents/{id}", h.saveAgent)
			r.Get("/voices/sarvam", h.listSarvamVoices)
			r.Post("/voices/sarvam/preview", h.previewSarvamVoice)
			r.Get("/swarms", h.listSwarms)
			r.Post("/swarms", h.saveSwarm)
			r.Put("/swarms/{id}", h.saveSwarm)
			r.Get("/campaigns", h.listCampaigns)
			r.Post("/campaigns", h.saveCampaign)
			r.Put("/campaigns/{id}", h.saveCampaign)
			r.Post("/campaigns/{id}/schedule", h.scheduleCampaign)
			r.Get("/campaigns/{id}/analytics", h.campaignAnalytics)
			r.Get("/calls", h.listCalls)
			r.Post("/calls/trigger", h.triggerCall)
			r.Get("/calls/{id}", h.getCall)
			r.Get("/credentials", h.listCredentials)
			r.Post("/credentials", h.saveCredential)
			r.Post("/admin/workflows/abandoned-checkout", h.runAbandonedCheckout)
		})
		r.Group(func(r chi.Router) {
			r.Use(h.requireInternal)
			r.Post("/call/trigger", h.triggerCall)
			r.Get("/runtime/swarms/{id}", h.runtimeSwarm)
			r.Post("/runtime/dispatch", h.dispatchOne)
			r.Post("/workflows/abandoned-checkout", h.runAbandonedCheckout)
			r.Post("/runtime/calls/inbound", h.createInboundCall)
			r.Post("/runtime/calls/{id}/handoff", h.recordHandoff)
			r.Post("/runtime/calls/{id}/complete", h.completeCall)
		})
	})
	return r
}

func (h *Handler) health(w http.ResponseWriter, r *http.Request) {
	if err := h.service.Store.Ping(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "stylme-ai-control-plane", "time": time.Now().UTC()})
}

func (h *Handler) publicConfig(w http.ResponseWriter, r *http.Request) {
	agent, err := h.service.Store.GetDefaultAgent(r.Context(), "web")
	if err != nil {
		mapError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"agentId": agent.ID, "name": agent.Name, "greeting": agent.Instructions.Greeting, "starterPrompts": agent.Web.StarterPrompts, "available": h.service.AIAvailable(r.Context())})
}

func (h *Handler) createSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Metadata domain.Metadata `json:"metadata"`
	}
	if err := decodeJSON(r, &body); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	userID := ""
	if value, err := h.authenticate(r); err == nil {
		userID = value.UserID
	}
	session, token, agent, err := h.service.CreateSession(r.Context(), userID, body.Metadata)
	if err != nil {
		mapError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"sessionId": session.ID, "sessionToken": token, "expiresAt": session.ExpiresAt, "agent": map[string]any{"id": agent.ID, "name": agent.Name, "greeting": agent.Instructions.Greeting, "starterPrompts": agent.Web.StarterPrompts}})
}

func (h *Handler) webMessage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text string `json:"text"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	reply, err := h.service.Reply(r.Context(), chi.URLParam(r, "id"), r.Header.Get("X-AI-Session-Token"), body.Text, r.Header.Get("Authorization"))
	if err != nil {
		mapError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, reply)
}

func (h *Handler) listAgents(w http.ResponseWriter, r *http.Request) {
	items, err := h.service.Store.ListAgents(r.Context())
	if err != nil {
		mapError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (h *Handler) listTools(w http.ResponseWriter, _ *http.Request) {
	items := domain.AgentToolCatalog()
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (h *Handler) listSarvamVoices(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, service.SarvamVoices())
}

func (h *Handler) previewSarvamVoice(w http.ResponseWriter, r *http.Request) {
	var body service.SarvamPreviewInput
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	preview, err := h.service.PreviewSarvamVoice(r.Context(), body)
	if err != nil {
		status := sarvamPreviewStatus(err)
		if status >= http.StatusInternalServerError {
			slog.Error("Sarvam preview failed", "error", err)
		}
		writeError(w, status, sarvamPreviewMessage(err))
		return
	}
	w.Header().Set("Content-Type", preview.ContentType)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("Content-Disposition", `inline; filename="sarvam-preview.wav"`)
	if preview.RequestID != "" {
		w.Header().Set("X-Sarvam-Request-ID", preview.RequestID)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(preview.Audio)
}

func sarvamPreviewStatus(err error) int {
	if errors.Is(err, service.ErrSarvamCredentialMissing) {
		return http.StatusServiceUnavailable
	}
	var upstream *service.SarvamUpstreamError
	if errors.As(err, &upstream) {
		if upstream.StatusCode == http.StatusTooManyRequests {
			return http.StatusTooManyRequests
		}
		return http.StatusBadGateway
	}
	var validation *service.SarvamValidationError
	if errors.As(err, &validation) {
		return http.StatusUnprocessableEntity
	}
	return http.StatusInternalServerError
}

func sarvamPreviewMessage(err error) string {
	if errors.Is(err, service.ErrSarvamCredentialMissing) {
		return err.Error()
	}
	var upstream *service.SarvamUpstreamError
	if errors.As(err, &upstream) {
		return upstream.Error()
	}
	var validation *service.SarvamValidationError
	if errors.As(err, &validation) {
		return validation.Error()
	}
	return "Sarvam preview could not be generated"
}

func (h *Handler) listSwarms(w http.ResponseWriter, r *http.Request) {
	items, err := h.service.Store.ListSwarms(r.Context())
	if err != nil {
		mapError(w, err)
		return
	}
	for index := range items {
		items[index] = redactManagedTelephony(items[index])
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}
func (h *Handler) listCampaigns(w http.ResponseWriter, r *http.Request) {
	items, err := h.service.Store.ListCampaigns(r.Context())
	if err != nil {
		mapError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (h *Handler) saveAgent(w http.ResponseWriter, r *http.Request) {
	var value domain.Agent
	if err := decodeJSON(r, &value); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if id := chi.URLParam(r, "id"); id != "" {
		value.ID = id
	}
	saved, err := h.service.SaveAgent(r.Context(), value, currentActor(r).UserID)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func redactManagedTelephony(swarm domain.AgentSwarm) domain.AgentSwarm {
	swarm.Telephony = domain.TelephonyBinding{
		PhoneNumber:        swarm.Telephony.PhoneNumber,
		HumanHandoffNumber: swarm.Telephony.HumanHandoffNumber,
	}
	return swarm
}

func (h *Handler) saveSwarm(w http.ResponseWriter, r *http.Request) {
	var value domain.AgentSwarm
	if err := decodeJSON(r, &value); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if id := chi.URLParam(r, "id"); id != "" {
		value.ID = id
	}
	saved, err := h.service.SaveSwarm(r.Context(), value, currentActor(r).UserID)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, redactManagedTelephony(saved))
}

func (h *Handler) saveCampaign(w http.ResponseWriter, r *http.Request) {
	var value domain.Campaign
	if err := decodeJSON(r, &value); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if id := chi.URLParam(r, "id"); id != "" {
		value.ID = id
	}
	saved, err := h.service.SaveCampaign(r.Context(), value, currentActor(r).UserID)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (h *Handler) scheduleCampaign(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Targets []service.CampaignTarget `json:"targets"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.service.ScheduleCampaign(r.Context(), chi.URLParam(r, "id"), body.Targets, currentActor(r).UserID)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, result)
}

func (h *Handler) campaignAnalytics(w http.ResponseWriter, r *http.Request) {
	period := r.URL.Query().Get("period")
	if period != "month" {
		period = "day"
	}
	campaign, err := h.service.Store.GetCampaign(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		mapError(w, err)
		return
	}
	items, err := h.service.Store.CampaignCallAnalytics(r.Context(), campaign.ID, period, campaign.CallingWindow.Timezone)
	if err != nil {
		mapError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"campaignId": campaign.ID, "period": period, "items": items})
}

func (h *Handler) listCalls(w http.ResponseWriter, r *http.Request) {
	page := queryInt64(r, "page", 1)
	pageSize := queryInt64(r, "pageSize", 20)
	items, total, err := h.service.Store.ListCallsPage(r.Context(), service.CallFilter(r.URL.Query().Get("campaignId"), r.URL.Query().Get("direction"), r.URL.Query().Get("status")), page, pageSize)
	if err != nil {
		mapError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "page": page, "pageSize": pageSize})
}

func (h *Handler) listCredentials(w http.ResponseWriter, r *http.Request) {
	items, err := h.service.Credentials.List(r.Context())
	if err != nil {
		mapError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) saveCredential(w http.ResponseWriter, r *http.Request) {
	var body service.CredentialInput
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	value, err := h.service.Credentials.Save(r.Context(), body, currentActor(r).UserID)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, value)
}

func (h *Handler) getCall(w http.ResponseWriter, r *http.Request) {
	item, err := h.service.Store.GetCall(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		mapError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}
func (h *Handler) runtimeSwarm(w http.ResponseWriter, r *http.Request) {
	value, err := h.service.RuntimeConfig(r.Context(), chi.URLParam(r, "id"), r.URL.Query().Get("callId"))
	if err != nil {
		mapError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (h *Handler) triggerCall(w http.ResponseWriter, r *http.Request) {
	var body service.DirectCallRequest
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	body.FromNumber = callerIDForRequest(currentActor(r).UserID, body.FromNumber)
	result, err := h.service.TriggerCall(r.Context(), body)
	if err != nil {
		status := http.StatusUnprocessableEntity
		if result.CallID != "" {
			status = http.StatusBadGateway
		}
		writeJSON(w, status, map[string]any{
			"call_id": result.CallID, "status": result.Status, "swarm_id": result.SwarmID,
			"agent_id": result.AgentID, "message": err.Error(),
			"error": map[string]any{"code": "call_trigger_failed", "message": err.Error()},
		})
		return
	}
	status := http.StatusAccepted
	if result.Idempotent {
		status = http.StatusOK
	}
	writeJSON(w, status, result)
}

func callerIDForRequest(actorID, requested string) string {
	if actorID != "" {
		return ""
	}
	return requested
}

func (h *Handler) dispatchOne(w http.ResponseWriter, r *http.Request) {
	limit := int(queryInt64(r, "limit", 1))
	count, err := h.service.DispatchBatch(r.Context(), limit)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if count == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"dispatched": false, "count": 0})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"dispatched": true, "count": count})
}

func (h *Handler) runAbandonedCheckout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CampaignID string `json:"campaignId"`
		Limit      int    `json:"limit"`
	}
	if err := decodeJSON(r, &body); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.Limit == 0 {
		body.Limit = 100
	}
	result, err := h.service.RunAbandonedCheckout(r.Context(), body.CampaignID, body.Limit, h.internalKey)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, result)
}

func (h *Handler) createInboundCall(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SwarmID  string          `json:"swarmId"`
		Room     string          `json:"room"`
		From     string          `json:"from"`
		To       string          `json:"to"`
		Context  map[string]any  `json:"context"`
		Metadata domain.Metadata `json:"metadata"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	call, err := h.service.CreateInboundCall(r.Context(), body.SwarmID, body.Room, body.From, body.To, body.Context, body.Metadata)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, call)
}

func (h *Handler) completeCall(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Transcript []domain.TranscriptTurn `json:"transcript"`
		Failure    map[string]any          `json:"failure"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	call, err := h.service.CompleteCall(r.Context(), chi.URLParam(r, "id"), body.Transcript, body.Failure)
	if err != nil {
		mapError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, call)
}

func (h *Handler) recordHandoff(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FromNode string         `json:"fromNode"`
		ToNode   string         `json:"toNode"`
		Reason   string         `json:"reason"`
		Captured map[string]any `json:"captured"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	call, err := h.service.RecordHandoff(r.Context(), chi.URLParam(r, "id"), body.FromNode, body.ToNode, body.Reason, body.Captured)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, call)
}

func (h *Handler) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		value, err := h.authenticate(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "valid bearer authentication is required")
			return
		}
		allowed := false
		for _, role := range value.Roles {
			if role == "owner" || role == "admin" {
				allowed = true
				break
			}
		}
		if !allowed {
			writeError(w, http.StatusForbidden, "owner or admin role is required")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), actorKey{}, value)))
	})
}

func (h *Handler) requireInternal(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		provided := r.Header.Get("X-Internal-Key")
		if provided == "" {
			provided = r.Header.Get("X-API-Key")
		}
		if h.internalKey == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(h.internalKey)) != 1 {
			writeError(w, http.StatusUnauthorized, "valid internal key is required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (h *Handler) authenticate(r *http.Request) (actor, error) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return actor{}, errors.New("missing bearer token")
	}
	raw := strings.TrimSpace(header[len("Bearer "):])
	token, err := jwt.Parse(raw, func(token *jwt.Token) (any, error) {
		if token.Method.Alg() != "HS256" {
			return nil, errors.New("unexpected signing algorithm")
		}
		return h.jwtSecret, nil
	}, jwt.WithIssuer("stylme-api"), jwt.WithExpirationRequired())
	if err != nil || !token.Valid {
		return actor{}, errors.New("invalid token")
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || claims["type"] != "access" {
		return actor{}, errors.New("invalid token claims")
	}
	userID, _ := claims["sub"].(string)
	if userID == "" {
		return actor{}, errors.New("missing token subject")
	}
	roles, err := h.service.Store.UserRoles(r.Context(), userID)
	if err != nil {
		return actor{}, err
	}
	return actor{UserID: userID, Roles: roles}, nil
}

func (h *Handler) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (h.corsOrigins[origin] || h.corsOrigins["*"]) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-AI-Session-Token, X-Internal-Key, X-API-Key")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func currentActor(r *http.Request) actor {
	value, _ := r.Context().Value(actorKey{}).(actor)
	return value
}
func decodeJSON(r *http.Request, target any) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 2<<20))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func queryInt64(r *http.Request, key string, fallback int64) int64 {
	value := strings.TrimSpace(r.URL.Query().Get(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed < 1 {
		return fallback
	}
	return parsed
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("write response", "error", err)
	}
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": http.StatusText(status), "message": message}})
}
func mapError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "resource not found")
		return
	}
	slog.Error("request failed", "error", err)
	writeError(w, http.StatusInternalServerError, "request failed")
}

var _ = fmt.Sprintf
