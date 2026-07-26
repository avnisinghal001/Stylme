package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"stylme/go-backend/internal/domain"
	livekitgateway "stylme/go-backend/internal/livekit"
	openaiapi "stylme/go-backend/internal/openai"
	"stylme/go-backend/internal/store"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

var e164Pattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)
var supportedBulbulLanguages = map[string]bool{
	"en-IN": true, "hi-IN": true, "bn-IN": true, "ta-IN": true, "te-IN": true,
	"gu-IN": true, "kn-IN": true, "ml-IN": true, "mr-IN": true, "pa-IN": true, "od-IN": true,
}

type Service struct {
	Store       *store.MongoStore
	AI          *openaiapi.Client
	Catalog     *CatalogClient
	Sarvam      *SarvamClient
	Telephony   livekitgateway.Gateway
	Credentials *CredentialVault
	SessionTTL  time.Duration
}

func New(data *store.MongoStore, ai *openaiapi.Client, catalog *CatalogClient, gateway livekitgateway.Gateway, credentials *CredentialVault, sessionTTL time.Duration) *Service {
	return &Service{Store: data, AI: ai, Catalog: catalog, Sarvam: NewSarvamClient("", nil), Telephony: gateway, Credentials: credentials, SessionTTL: sessionTTL}
}

func (s *Service) SaveAgent(ctx context.Context, value domain.Agent, actor string) (domain.Agent, error) {
	if strings.TrimSpace(value.Key) == "" || strings.TrimSpace(value.Name) == "" {
		return value, errors.New("key and name are required")
	}
	if len(value.Channels) == 0 {
		return value, errors.New("at least one channel is required")
	}
	if value.Instructions.System == "" {
		return value, errors.New("system instructions are required")
	}
	if value.Model.Provider == "" {
		value.Model.Provider = "openai"
	}
	if value.Model.Provider != "openai" {
		return value, errors.New("only the openai model provider is supported")
	}
	if value.Model.Name == "" {
		value.Model.Name = "gpt-5.6-luna"
	}
	if value.Model.MaxOutputTokens <= 0 {
		value.Model.MaxOutputTokens = 900
	}
	if value.Status == "" {
		value.Status = "draft"
	}
	if !contains([]string{"draft", "active", "paused", "archived"}, value.Status) {
		return value, errors.New("agent status is invalid")
	}
	if value.Direction == "" {
		return value, errors.New("agent direction is required")
	}
	if value.Direction == "interactive" && !contains(value.Channels, "web") {
		return value, errors.New("interactive agents require the web channel")
	}
	if contains([]string{"inbound", "outbound"}, value.Direction) && !contains(value.Channels, "voice") {
		return value, errors.New("inbound and outbound agents require the voice channel")
	}
	if !contains([]string{"interactive", "inbound", "outbound"}, value.Direction) {
		return value, errors.New("agent direction is invalid")
	}
	if value.Model.Temperature < 0 || value.Model.Temperature > 2 {
		return value, errors.New("model temperature must be between 0 and 2")
	}
	if contains(value.Channels, "voice") && value.Voice == nil {
		return value, errors.New("voice agents require voice configuration")
	}
	if contains(value.Channels, "web") && value.Web == nil {
		return value, errors.New("web agents require web configuration")
	}
	if err := validateAgentTools(value); err != nil {
		return value, err
	}
	if err := validateCaptureContract(value.Capture); err != nil {
		return value, err
	}
	if value.Voice != nil && (value.Voice.STTProvider != "deepgram" || value.Voice.TTSProvider != "sarvam") {
		return value, errors.New("voice agents require deepgram STT and sarvam TTS")
	}
	if value.Voice != nil {
		value.Voice.Speaker = strings.ToLower(strings.TrimSpace(value.Voice.Speaker))
		if value.Voice.TTSModel != SarvamBulbulV3Model {
			return value, errors.New("voice agents require Sarvam bulbul:v3")
		}
		if !IsSupportedSarvamVoice(value.Voice.Speaker) {
			return value, errors.New("speaker is not supported by Sarvam bulbul:v3")
		}
		if value.Voice.Language != "multi" && !supportedBulbulLanguages[value.Voice.Language] {
			return value, errors.New("voice language is not supported by Sarvam bulbul:v3")
		}
		if value.Voice.Pace < 0.5 || value.Voice.Pace > 2 {
			return value, errors.New("voice pace must be between 0.5 and 2.0")
		}
		if value.Voice.EndCallAfterSec < 30 || value.Voice.EndCallAfterSec > 3600 {
			return value, errors.New("maximum call duration must be between 30 and 3600 seconds")
		}
	}
	if value.Web != nil {
		if value.Web.MaxHistoryMessages < 1 || value.Web.MaxHistoryMessages > 50 {
			return value, errors.New("web history messages must be between 1 and 50")
		}
		if value.Web.ResultLimit < 1 || value.Web.ResultLimit > 50 {
			return value, errors.New("web result limit must be between 1 and 50")
		}
	}
	now := time.Now().UTC()
	if value.ID == "" {
		value.ID = randomID("agent")
		value.CreatedAt = now
		value.Revision = 1
		value.CreatedBy = actor
	} else if existing, err := s.Store.GetAgent(ctx, value.ID); err == nil {
		value.CreatedAt = existing.CreatedAt
		value.CreatedBy = existing.CreatedBy
		value.Revision = existing.Revision + 1
	} else if !errors.Is(err, store.ErrNotFound) {
		return value, err
	} else {
		value.CreatedAt = now
		value.CreatedBy = actor
		value.Revision = 1
	}
	if value.Metadata == nil {
		value.Metadata = domain.Metadata{}
	}
	value.UpdatedAt, value.UpdatedBy = now, actor
	if value.IsDefault {
		if err := s.Store.ClearAgentDefaults(ctx, value.ID, value.Channels, value.Direction); err != nil {
			return value, err
		}
	}
	return value, s.Store.SaveAgent(ctx, value)
}

func (s *Service) SaveSwarm(ctx context.Context, value domain.AgentSwarm, actor string) (domain.AgentSwarm, error) {
	if strings.TrimSpace(value.Key) == "" || strings.TrimSpace(value.Name) == "" {
		return value, errors.New("key and name are required")
	}
	if err := domain.ValidateGraph(value.Graph); err != nil {
		return value, err
	}
	nodeAgents := map[string]domain.Agent{}
	for _, node := range value.Graph.Nodes {
		agent, err := s.Store.GetAgent(ctx, node.AgentID)
		if err != nil {
			return value, fmt.Errorf("node %s references unavailable agent: %w", node.Key, err)
		}
		if !sharesValue(value.Channels, agent.Channels) || !contains(value.Directions, agent.Direction) {
			return value, fmt.Errorf("node %s agent is incompatible with the workflow channel or direction", node.Key)
		}
		nodeAgents[node.Key] = agent
	}
	for _, edge := range value.Graph.Edges {
		if !agentToolEnabled(nodeAgents[edge.From], "handoff") {
			return value, fmt.Errorf("node %s needs the handoff tool enabled before it can route to another agent", edge.From)
		}
	}
	if value.Status == "" {
		value.Status = "draft"
	}
	if len(value.Channels) == 0 {
		return value, errors.New("at least one channel is required")
	}
	if len(value.Directions) == 0 {
		return value, errors.New("at least one direction is required")
	}
	humanHandoffNumber, err := normalizeHumanHandoffNumber(value.Telephony.HumanHandoffNumber)
	if err != nil {
		return value, err
	}
	value.Telephony.HumanHandoffNumber = humanHandoffNumber
	now := time.Now().UTC()
	if value.ID == "" {
		// SIP trunks, dispatch rules, and worker names are provisioned through the
		// server-side telephony CLI. The human destination is intentionally the
		// only telephony value an admin can configure from the browser.
		value.Telephony = domain.TelephonyBinding{HumanHandoffNumber: humanHandoffNumber}
		value.ID = randomID("swarm")
		value.CreatedAt = now
		value.CreatedBy = actor
		value.Revision = 1
	} else if existing, err := s.Store.GetSwarm(ctx, value.ID); err == nil {
		value.Telephony = preserveManagedTelephony(value.Telephony, existing.Telephony)
		value.CreatedAt = existing.CreatedAt
		value.CreatedBy = existing.CreatedBy
		value.Revision = existing.Revision + 1
	} else if !errors.Is(err, store.ErrNotFound) {
		return value, err
	} else {
		value.CreatedAt = now
		value.CreatedBy = actor
		value.Revision = 1
	}
	if value.Metadata == nil {
		value.Metadata = domain.Metadata{}
	}
	value.UpdatedAt, value.UpdatedBy = now, actor
	if value.IsDefault {
		if err := s.Store.ClearSwarmDefaults(ctx, value.ID, value.Channels, value.Directions); err != nil {
			return value, err
		}
	}
	return value, s.Store.SaveSwarm(ctx, value)
}

func preserveManagedTelephony(proposed, stored domain.TelephonyBinding) domain.TelephonyBinding {
	if normalized, err := normalizeHumanHandoffNumber(proposed.HumanHandoffNumber); err == nil && normalized != "" {
		stored.HumanHandoffNumber = normalized
	}
	return stored
}

func normalizeHumanHandoffNumber(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", nil
	}
	var normalized strings.Builder
	for index, character := range trimmed {
		switch {
		case character >= '0' && character <= '9':
			normalized.WriteRune(character)
		case character == '+' && index == 0:
			normalized.WriteRune(character)
		case character == ' ' || character == '-' || character == '(' || character == ')':
			continue
		default:
			return "", errors.New("human handoff number must be a valid phone number")
		}
	}
	result := normalized.String()
	if !strings.HasPrefix(result, "+") {
		if len(result) == 10 {
			result = "+91" + result
		} else {
			result = "+" + result
		}
	}
	if !e164Pattern.MatchString(result) {
		return "", errors.New("human handoff number must use E.164 format or a 10-digit Indian number")
	}
	return result, nil
}

func (s *Service) SaveCampaign(ctx context.Context, value domain.Campaign, actor string) (domain.Campaign, error) {
	if value.Name == "" || value.SwarmID == "" {
		return value, errors.New("name and swarmId are required")
	}
	swarm, err := s.Store.GetSwarm(ctx, value.SwarmID)
	if err != nil {
		return value, fmt.Errorf("swarm is unavailable: %w", err)
	}
	if value.Direction == "" {
		value.Direction = "outbound"
	}
	if value.Direction != "outbound" {
		return value, errors.New("campaign direction must be outbound")
	}
	value.FromNumber = managedCampaignFromNumber(value.FromNumber, swarm.Telephony.PhoneNumber)
	if value.FromNumber != "" && !e164Pattern.MatchString(value.FromNumber) {
		return value, errors.New("managed swarm phone number must use E.164 format")
	}
	if value.EntryNodeKey == "" {
		value.EntryNodeKey = swarm.Graph.EntryNodeKey
	}
	if _, err := graphAgentID(swarm.Graph, value.EntryNodeKey); err != nil {
		return value, errors.New("entryNodeKey must identify a node in the selected swarm")
	}
	if value.Kind == "" {
		value.Kind = "custom"
	}
	if value.Language == "" {
		value.Language = "en-IN"
	}
	if !supportedBulbulLanguages[value.Language] {
		return value, errors.New("language must be one of Bulbul v3's 11 supported language codes")
	}
	if strings.TrimSpace(value.Instructions.Objective) == "" {
		return value, errors.New("campaign instructions.objective is required")
	}
	if value.Status == "" {
		value.Status = "draft"
	}
	if value.MaxConcurrency <= 0 {
		value.MaxConcurrency = 2
	}
	if value.CallsPerSecond <= 0 {
		value.CallsPerSecond = 1
	}
	if value.RetryPolicy.MaxAttempts <= 0 {
		value.RetryPolicy.MaxAttempts = 1
	}
	if value.CallingWindow.Timezone == "" {
		value.CallingWindow = domain.CallingWindow{Timezone: "Asia/Kolkata", Start: "10:00", End: "19:00"}
	}
	now := time.Now().UTC()
	if value.ID == "" {
		value.ID = randomID("campaign")
		value.CreatedAt = now
		value.CreatedBy = actor
	} else if existing, err := s.Store.GetCampaign(ctx, value.ID); err == nil {
		value.CreatedAt = existing.CreatedAt
		value.CreatedBy = existing.CreatedBy
	} else if !errors.Is(err, store.ErrNotFound) {
		return value, err
	} else {
		value.CreatedAt = now
		value.CreatedBy = actor
	}
	if value.Metadata == nil {
		value.Metadata = domain.Metadata{}
	}
	if value.Counts == nil {
		value.Counts = map[string]int64{}
	}
	value.UpdatedAt, value.UpdatedBy = now, actor
	return value, s.Store.SaveCampaign(ctx, value)
}

func managedCampaignFromNumber(_, swarmPhoneNumber string) string {
	return swarmPhoneNumber
}

type CampaignTarget struct {
	ExternalID  string          `json:"externalId"`
	Phone       string          `json:"phone"`
	Participant map[string]any  `json:"participant"`
	Context     map[string]any  `json:"context"`
	Metadata    domain.Metadata `json:"metadata"`
}

// DirectCallRequest intentionally keeps Samora's snake_case trigger contract.
// Optional swarm/context fields make the endpoint reusable outside that source.
type DirectCallRequest struct {
	AgentID        string          `json:"agent_id"`
	SwarmID        string          `json:"swarm_id"`
	ToNumber       string          `json:"to_number"`
	FromNumber     string          `json:"from_number"`
	ExternalID     string          `json:"external_id"`
	IdempotencyKey string          `json:"idempotency_key"`
	Participant    map[string]any  `json:"participant"`
	Context        map[string]any  `json:"context"`
	Metadata       domain.Metadata `json:"metadata"`
}

type DirectCallResult struct {
	CallID     string `json:"call_id"`
	Status     string `json:"status"`
	Idempotent bool   `json:"idempotent"`
	SwarmID    string `json:"swarm_id"`
	AgentID    string `json:"agent_id"`
}

func (s *Service) TriggerCall(ctx context.Context, request DirectCallRequest) (DirectCallResult, error) {
	payload, err := json.Marshal(request)
	if err != nil {
		return DirectCallResult{}, errors.New("request contains unsupported metadata")
	}
	if len(payload) > 16*1024 {
		return DirectCallResult{}, errors.New("call payload exceeds 16 KiB")
	}
	request.AgentID = strings.TrimSpace(request.AgentID)
	request.SwarmID = strings.TrimSpace(request.SwarmID)
	request.ToNumber = strings.TrimSpace(request.ToNumber)
	request.FromNumber = strings.TrimSpace(request.FromNumber)
	request.ExternalID = strings.TrimSpace(request.ExternalID)
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	if !e164Pattern.MatchString(request.ToNumber) {
		return DirectCallResult{}, errors.New("to_number must use E.164 format")
	}
	var swarm domain.AgentSwarm
	if request.SwarmID != "" {
		swarm, err = s.Store.GetSwarm(ctx, request.SwarmID)
	} else if request.AgentID != "" {
		swarm, err = s.Store.GetOutboundSwarmForAgent(ctx, request.AgentID)
	} else {
		swarm, err = s.Store.GetDefaultSwarm(ctx, "voice", "outbound")
	}
	if err != nil {
		return DirectCallResult{}, fmt.Errorf("resolve outbound swarm: %w", err)
	}
	if swarm.Status != "active" || !contains(swarm.Channels, "voice") || !contains(swarm.Directions, "outbound") {
		return DirectCallResult{}, errors.New("selected swarm is not an active outbound voice swarm")
	}
	agentID, err := directCallAgentID(swarm, request.AgentID)
	if err != nil {
		return DirectCallResult{}, err
	}
	if _, err := s.Store.GetAgent(ctx, agentID); err != nil {
		return DirectCallResult{}, fmt.Errorf("resolve agent: %w", err)
	}
	fromNumber := request.FromNumber
	if fromNumber == "" {
		fromNumber = strings.TrimSpace(swarm.Telephony.PhoneNumber)
	}
	if !e164Pattern.MatchString(fromNumber) {
		return DirectCallResult{}, errors.New("from_number must use E.164 format or be configured on the swarm")
	}
	if request.Metadata == nil {
		request.Metadata = domain.Metadata{}
	}
	if request.IdempotencyKey == "" {
		if value, ok := request.Metadata["idempotency_key"].(string); ok {
			request.IdempotencyKey = strings.TrimSpace(value)
		}
	}
	if request.IdempotencyKey == "" {
		request.IdempotencyKey = randomID("direct")
	}
	idempotencyKey := "direct:" + request.IdempotencyKey
	if existing, findErr := s.Store.GetCallByIdempotencyKey(ctx, idempotencyKey); findErr == nil {
		return DirectCallResult{CallID: existing.ID, Status: existing.Status, Idempotent: true, SwarmID: existing.SwarmID, AgentID: agentID}, nil
	} else if !errors.Is(findErr, store.ErrNotFound) {
		return DirectCallResult{}, findErr
	}
	now := time.Now().UTC()
	contextData := cloneMap(request.Context)
	if contextData == nil {
		contextData = map[string]any{}
	}
	contextData["trigger_metadata"] = request.Metadata
	call := domain.Call{
		ID: randomID("call"), TenantID: "stylme", SwarmID: swarm.ID,
		Direction: "outbound", Status: "dispatching", ExternalID: request.ExternalID,
		IdempotencyKey: idempotencyKey, From: fromNumber, To: request.ToNumber,
		Attempt: 1, MaxAttempts: 1, ScheduledAt: now, GraphSnapshot: swarm.Graph,
		CurrentNodeKey: swarm.Graph.EntryNodeKey, Participant: cloneMap(request.Participant),
		Context: contextData, LiveKit: map[string]string{}, Transcript: []domain.TranscriptTurn{},
		AgentTrace: []domain.AgentTrace{}, Metadata: request.Metadata, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.Store.SaveCall(ctx, call); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			existing, findErr := s.Store.GetCallByIdempotencyKey(ctx, idempotencyKey)
			if findErr == nil {
				return DirectCallResult{CallID: existing.ID, Status: existing.Status, Idempotent: true, SwarmID: existing.SwarmID, AgentID: agentID}, nil
			}
		}
		return DirectCallResult{}, err
	}
	if err := s.dispatchCall(ctx, call, swarm); err != nil {
		return DirectCallResult{CallID: call.ID, Status: "failed", SwarmID: swarm.ID, AgentID: agentID}, err
	}
	return DirectCallResult{CallID: call.ID, Status: "accepted", SwarmID: swarm.ID, AgentID: agentID}, nil
}

func (s *Service) ScheduleCampaign(ctx context.Context, campaignID string, targets []CampaignTarget, actor string) (map[string]any, error) {
	if len(targets) == 0 || len(targets) > 500 {
		return nil, errors.New("targets must contain 1 to 500 records")
	}
	campaign, err := s.Store.GetCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	if campaign.Status == "completed" || campaign.Status == "cancelled" {
		return nil, errors.New("terminal campaigns cannot accept calls")
	}
	swarm, err := s.Store.GetSwarm(ctx, campaign.SwarmID)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	graph := swarm.Graph
	graph.EntryNodeKey = campaign.EntryNodeKey
	snapshot := &domain.CampaignSnapshot{
		ID: campaign.ID, Name: campaign.Name, Kind: campaign.Kind, EntryNodeKey: campaign.EntryNodeKey,
		Language: campaign.Language, Instructions: campaign.Instructions, Capture: campaign.Capture,
	}
	calls := make([]domain.Call, 0, len(targets))
	invalid := []map[string]any{}
	for index, target := range targets {
		target.Phone = strings.TrimSpace(target.Phone)
		if !e164Pattern.MatchString(target.Phone) {
			invalid = append(invalid, map[string]any{"index": index, "externalId": target.ExternalID, "error": "phone must use E.164 format"})
			continue
		}
		if target.ExternalID == "" {
			target.ExternalID = target.Phone
		}
		idempotency := campaign.ID + ":" + target.ExternalID
		calls = append(calls, domain.Call{ID: randomID("call"), TenantID: "stylme", CampaignID: campaign.ID, SwarmID: swarm.ID, Direction: "outbound", Status: "pending", ExternalID: target.ExternalID, IdempotencyKey: idempotency, From: campaign.FromNumber, To: target.Phone, MaxAttempts: campaign.RetryPolicy.MaxAttempts, ScheduledAt: now, GraphSnapshot: graph, CampaignSnapshot: snapshot, CurrentNodeKey: graph.EntryNodeKey, Participant: target.Participant, Context: target.Context, LiveKit: map[string]string{}, Transcript: []domain.TranscriptTurn{}, AgentTrace: []domain.AgentTrace{}, Metadata: target.Metadata, CreatedAt: now, UpdatedAt: now})
	}
	inserted, err := s.Store.InsertCalls(ctx, calls)
	if err != nil {
		return nil, err
	}
	campaign.Status = "running"
	campaign.UpdatedAt = now
	campaign.UpdatedBy = actor
	if campaign.Counts == nil {
		campaign.Counts = map[string]int64{}
	}
	campaign.Counts["scheduled"] += int64(inserted)
	if err := s.Store.SaveCampaign(ctx, campaign); err != nil {
		return nil, err
	}
	return map[string]any{"campaignId": campaign.ID, "received": len(targets), "scheduled": inserted, "duplicates": len(calls) - inserted, "invalid": invalid}, nil
}

func (s *Service) RunAbandonedCheckout(ctx context.Context, campaignID string, limit int, internalKey string) (map[string]any, error) {
	var campaign domain.Campaign
	var err error
	if strings.TrimSpace(campaignID) != "" {
		campaign, err = s.Store.GetCampaign(ctx, campaignID)
	} else {
		campaign, err = s.Store.GetCampaignByKind(ctx, "abandoned_checkout")
	}
	if err != nil {
		return nil, fmt.Errorf("resolve abandoned-checkout campaign: %w", err)
	}
	feed, err := s.Catalog.CheckoutRecoveryCandidates(ctx, limit, internalKey)
	if err != nil {
		return nil, err
	}
	rawItems, _ := feed["items"].([]any)
	targets := make([]CampaignTarget, 0, len(rawItems))
	for _, raw := range rawItems {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		targets = append(targets, CampaignTarget{
			ExternalID: stringValue(item["externalId"]), Phone: stringValue(item["phone"]),
			Participant: mapValue(item["participant"]), Context: mapValue(item["context"]),
			Metadata: domain.Metadata(mapValue(item["metadata"])),
		})
	}
	if len(targets) == 0 {
		return map[string]any{"campaignId": campaign.ID, "fetched": feed["fetched"], "eligible": 0, "scheduled": 0, "dispatched": 0, "errors": feed["errors"]}, nil
	}
	scheduled, err := s.ScheduleCampaign(ctx, campaign.ID, targets, "checkout-recovery-cron")
	if err != nil {
		return nil, err
	}
	dispatched, dispatchErr := s.DispatchBatch(ctx, minInt(5, campaign.MaxConcurrency))
	if dispatchErr != nil {
		return nil, dispatchErr
	}
	scheduled["fetched"] = feed["fetched"]
	scheduled["eligible"] = len(targets)
	scheduled["dispatched"] = dispatched
	scheduled["sourceErrors"] = feed["errors"]
	return scheduled, nil
}

func (s *Service) CreateSession(ctx context.Context, userID string, metadata domain.Metadata) (domain.AISession, string, domain.Agent, error) {
	agent, err := s.Store.GetDefaultAgent(ctx, "web")
	if err != nil {
		return domain.AISession{}, "", domain.Agent{}, err
	}
	token := randomToken(32)
	now := time.Now().UTC()
	session := domain.AISession{ID: randomID("session"), AccessTokenHash: tokenHash(token), UserID: userID, AgentID: agent.ID, Status: "active", Messages: []domain.ChatMessage{}, ProfileContext: map[string]any{}, Metadata: metadata, ExpiresAt: now.Add(s.SessionTTL), CreatedAt: now, UpdatedAt: now}
	if err := s.Store.SaveSession(ctx, session); err != nil {
		return domain.AISession{}, "", domain.Agent{}, err
	}
	return session, token, agent, nil
}

type WebReply struct {
	SessionID string             `json:"sessionId"`
	Message   domain.ChatMessage `json:"message"`
	Plan      domain.SearchPlan  `json:"plan"`
	Search    map[string]any     `json:"search,omitempty"`
}

func (s *Service) Reply(ctx context.Context, sessionID, token, text, authorization string) (WebReply, error) {
	text = strings.TrimSpace(text)
	if text == "" || len([]rune(text)) > 600 {
		return WebReply{}, errors.New("message must contain 1 to 600 characters")
	}
	session, err := s.Store.GetSession(ctx, sessionID)
	if err != nil {
		return WebReply{}, err
	}
	if subtle.ConstantTimeCompare([]byte(session.AccessTokenHash), []byte(tokenHash(token))) != 1 {
		return WebReply{}, errors.New("invalid session token")
	}
	agent, err := s.Store.GetAgent(ctx, session.AgentID)
	if err != nil {
		return WebReply{}, err
	}
	filters, err := s.Catalog.Filters(ctx)
	if err != nil {
		return WebReply{}, fmt.Errorf("load filter contract: %w", err)
	}
	profile := session.ProfileContext
	if remote, profileErr := s.Catalog.Profile(ctx, authorization); profileErr == nil && len(remote) > 0 {
		profile = remote
	}
	ai, err := s.aiClient(ctx)
	if err != nil {
		return WebReply{}, err
	}
	plan, err := ai.Plan(ctx, agent, session.Messages, text, filters, profile)
	if err != nil {
		return WebReply{}, err
	}
	plan = sanitizePlan(plan, filters)
	components := []domain.UIComponent{}
	var searchResult map[string]any
	messageText := plan.AssistantMessage
	if plan.NeedsClarification {
		if plan.ClarifyingQuestion != "" {
			messageText = plan.ClarifyingQuestion
		}
		components = append(components, domain.UIComponent{Type: "clarification", Data: map[string]any{"question": messageText}})
	} else {
		searchResult, err = s.Catalog.Search(ctx, text, plan, profile)
		if err != nil {
			return WebReply{}, fmt.Errorf("search catalog: %w", err)
		}
		components = append(components, domain.UIComponent{Type: "filter_summary", Data: planSummary(plan)})
		components = append(components, domain.UIComponent{Type: "product_grid", Data: map[string]any{"items": searchResult["items"], "total": searchResult["total"], "queryParams": searchResult["queryParams"]}})
	}
	if len(plan.ProfileProposal) > 0 && agent.Web != nil && agent.Web.AllowProfileProposal && agentToolEnabled(agent, "propose_profile_update") {
		components = append(components, domain.UIComponent{Type: "profile_proposal", Data: map[string]any{"changes": plan.ProfileProposal, "requiresConfirmation": true}})
	}
	now := time.Now().UTC()
	userMessage := domain.ChatMessage{Role: "user", Text: text, CreatedAt: now}
	assistantMessage := domain.ChatMessage{Role: "assistant", Text: messageText, Components: components, CreatedAt: now}
	session.Messages = append(session.Messages, userMessage, assistantMessage)
	maxStored := 24
	if agent.Web != nil && agent.Web.MaxHistoryMessages > 0 {
		maxStored = agent.Web.MaxHistoryMessages * 2
	}
	if len(session.Messages) > maxStored {
		session.Messages = session.Messages[len(session.Messages)-maxStored:]
	}
	session.ProfileContext, session.UpdatedAt, session.ExpiresAt = profile, now, now.Add(s.SessionTTL)
	if err := s.Store.SaveSession(ctx, session); err != nil {
		return WebReply{}, err
	}
	return WebReply{SessionID: session.ID, Message: assistantMessage, Plan: plan, Search: searchResult}, nil
}

func (s *Service) RuntimeConfig(ctx context.Context, swarmID, callID string) (map[string]any, error) {
	swarm, err := s.Store.GetSwarm(ctx, swarmID)
	if err != nil {
		return nil, err
	}
	var call *domain.Call
	if callID != "" {
		stored, getErr := s.Store.GetCall(ctx, callID)
		if getErr != nil {
			return nil, getErr
		}
		if stored.SwarmID != swarm.ID {
			return nil, errors.New("call does not belong to the requested swarm")
		}
		call = &stored
		// Calls execute the immutable graph captured when they were scheduled.
		swarm.Graph = stored.GraphSnapshot
	}
	agents := make([]domain.Agent, 0, len(swarm.Graph.Nodes))
	for _, node := range swarm.Graph.Nodes {
		agent, err := s.Store.GetAgent(ctx, node.AgentID)
		if err != nil {
			return nil, err
		}
		agents = append(agents, agent)
	}
	result := map[string]any{"swarm": swarm, "agents": agents}
	if s.Credentials != nil {
		credentials, credentialErr := s.Credentials.Runtime(ctx)
		if credentialErr != nil {
			return nil, credentialErr
		}
		result["credentials"] = credentials
	}
	if call != nil {
		result["call"] = map[string]any{
			"id": call.ID, "direction": call.Direction, "from": call.From, "to": call.To,
			"externalId": call.ExternalID, "participant": call.Participant,
			"context": call.Context, "metadata": call.Metadata, "campaign": call.CampaignSnapshot,
		}
	}
	return result, nil
}

func (s *Service) CreateInboundCall(ctx context.Context, swarmID, room, from, to string, contextData map[string]any, metadata domain.Metadata) (domain.Call, error) {
	swarm, err := s.Store.GetSwarm(ctx, swarmID)
	if err != nil {
		return domain.Call{}, err
	}
	if room == "" {
		return domain.Call{}, errors.New("room is required")
	}
	if existing, findErr := s.Store.GetCallByRoom(ctx, room); findErr == nil {
		return existing, nil
	} else if !errors.Is(findErr, store.ErrNotFound) {
		return domain.Call{}, findErr
	}
	now := time.Now().UTC()
	entryAgentID, err := graphAgentID(swarm.Graph, swarm.Graph.EntryNodeKey)
	if err != nil {
		return domain.Call{}, err
	}
	call := domain.Call{ID: randomID("call"), TenantID: "stylme", SwarmID: swarm.ID, Direction: "inbound", Status: "active", IdempotencyKey: "inbound:" + room, From: from, To: to, Attempt: 1, MaxAttempts: 1, ScheduledAt: now, GraphSnapshot: swarm.Graph, CurrentNodeKey: swarm.Graph.EntryNodeKey, Context: contextData, Participant: map[string]any{}, LiveKit: map[string]string{"room_name": room}, Transcript: []domain.TranscriptTurn{}, AgentTrace: []domain.AgentTrace{{NodeKey: swarm.Graph.EntryNodeKey, AgentID: entryAgentID, EnteredAt: now}}, Metadata: metadata, StartedAt: &now, AnsweredAt: &now, CreatedAt: now, UpdatedAt: now}
	if err := s.Store.SaveCall(ctx, call); err != nil {
		return domain.Call{}, err
	}
	return call, nil
}

func (s *Service) RecordHandoff(ctx context.Context, callID, fromNode, toNode, reason string, captured map[string]any) (domain.Call, error) {
	call, err := s.Store.GetCall(ctx, callID)
	if err != nil {
		return call, err
	}
	if call.Status == "completed" || call.Status == "failed" || call.Status == "cancelled" {
		return call, errors.New("terminal calls cannot be handed off")
	}
	if call.CurrentNodeKey != fromNode {
		return call, errors.New("handoff source does not match the active graph node")
	}
	allowed := false
	for _, edge := range call.GraphSnapshot.Edges {
		if edge.From == fromNode && edge.To == toNode {
			allowed = true
			break
		}
	}
	if !allowed {
		return call, errors.New("handoff is not an edge in the call graph snapshot")
	}
	toAgentID, err := graphAgentID(call.GraphSnapshot, toNode)
	if err != nil {
		return call, err
	}
	now := time.Now().UTC()
	if len(call.AgentTrace) == 0 {
		fromAgentID, findErr := graphAgentID(call.GraphSnapshot, fromNode)
		if findErr != nil {
			return call, findErr
		}
		call.AgentTrace = append(call.AgentTrace, domain.AgentTrace{NodeKey: fromNode, AgentID: fromAgentID, EnteredAt: now})
	}
	last := &call.AgentTrace[len(call.AgentTrace)-1]
	if last.ExitedAt == nil {
		last.ExitedAt = &now
		last.Reason = strings.TrimSpace(reason)
	}
	call.AgentTrace = append(call.AgentTrace, domain.AgentTrace{NodeKey: toNode, AgentID: toAgentID, EnteredAt: now})
	call.CurrentNodeKey = toNode
	if call.Context == nil {
		call.Context = map[string]any{}
	}
	if len(captured) > 0 {
		call.Context["captured"] = captured
	}
	call.UpdatedAt = now
	return call, s.Store.SaveCall(ctx, call)
}

func (s *Service) CompleteCall(ctx context.Context, callID string, transcript []domain.TranscriptTurn, failure map[string]any) (domain.Call, error) {
	call, err := s.Store.GetCall(ctx, callID)
	if err != nil {
		return call, err
	}
	now := time.Now().UTC()
	call.Transcript = transcript
	call.EndedAt = &now
	call.UpdatedAt = now
	call.LeaseUntil = nil
	if failure != nil {
		call.Status = "failed"
		call.Failure = failure
	} else {
		call.Status = "completed"
	}
	if len(call.AgentTrace) > 0 && call.AgentTrace[len(call.AgentTrace)-1].ExitedAt == nil {
		call.AgentTrace[len(call.AgentTrace)-1].ExitedAt = &now
	}
	if len(transcript) > 0 {
		if dispositionAgent, agentErr := s.dispositionAgent(ctx, call); agentErr == nil {
			ai, credentialErr := s.aiClient(ctx)
			if credentialErr != nil {
				call.Failure = mergeFailure(call.Failure, "disposition", credentialErr.Error())
			} else if disposition, dispositionErr := ai.Disposition(ctx, dispositionAgent, transcript); dispositionErr == nil {
				call.Disposition = &disposition
			} else {
				call.Failure = mergeFailure(call.Failure, "disposition", dispositionErr.Error())
			}
		}
	}
	if err := s.Store.SaveCall(ctx, call); err != nil {
		return call, err
	}
	_ = s.Store.IncrementCampaignCount(ctx, call.CampaignID, call.Status, 1)
	return call, nil
}

func (s *Service) aiClient(ctx context.Context) (*openaiapi.Client, error) {
	if s.Credentials == nil {
		return s.AI, nil
	}
	key, _, err := s.Credentials.Resolve(ctx, "openai")
	if err != nil {
		return nil, err
	}
	return s.AI.WithAPIKey(key), nil
}

func (s *Service) AIAvailable(ctx context.Context) bool {
	client, err := s.aiClient(ctx)
	return err == nil && client.Available()
}

func (s *Service) DispatchOne(ctx context.Context) error {
	now := time.Now().UTC()
	call, err := s.Store.ClaimPendingCall(ctx, now, 90*time.Second)
	if err != nil {
		return err
	}
	if call.CampaignID != "" {
		campaign, campaignErr := s.Store.GetCampaign(ctx, call.CampaignID)
		if campaignErr != nil {
			return s.failDispatch(ctx, call, campaignErr)
		}
		switch campaign.Status {
		case "completed", "cancelled":
			return s.cancelUndispatchedCall(ctx, call, "campaign is "+campaign.Status)
		case "running":
			// Continue through the calling-window and concurrency gates below.
		default:
			return s.deferDispatch(ctx, call, now.Add(time.Minute))
		}
		if !withinCallingWindow(campaign.CallingWindow, now) {
			return s.deferDispatch(ctx, call, nextCallingWindow(campaign.CallingWindow, now))
		}
		active, countErr := s.Store.CountActiveCampaignCalls(ctx, campaign.ID, call.ID)
		if countErr != nil {
			return s.failDispatch(ctx, call, countErr)
		}
		if active >= int64(campaign.MaxConcurrency) {
			return s.deferDispatch(ctx, call, now.Add(30*time.Second))
		}
	}
	swarm, err := s.Store.GetSwarm(ctx, call.SwarmID)
	if err != nil {
		return s.failDispatch(ctx, call, err)
	}
	return s.dispatchCall(ctx, call, swarm)
}

func (s *Service) DispatchBatch(ctx context.Context, limit int) (int, error) {
	if limit < 1 {
		limit = 1
	}
	if limit > 10 {
		limit = 10
	}
	dispatched := 0
	for dispatched < limit {
		err := s.DispatchOne(ctx)
		if errors.Is(err, store.ErrNotFound) {
			return dispatched, nil
		}
		if err != nil {
			return dispatched, err
		}
		dispatched++
	}
	return dispatched, nil
}

func (s *Service) dispatchCall(ctx context.Context, call domain.Call, swarm domain.AgentSwarm) error {
	room, err := s.Telephony.DispatchOutbound(ctx, call, swarm)
	if err != nil {
		return s.failDispatch(ctx, call, err)
	}
	now := time.Now().UTC()
	call.Status = "ringing"
	call.StartedAt = &now
	call.UpdatedAt = now
	call.LeaseUntil = nil
	if call.LiveKit == nil {
		call.LiveKit = map[string]string{}
	}
	call.LiveKit["room_name"] = room
	if len(call.AgentTrace) == 0 {
		if agentID, findErr := graphAgentID(call.GraphSnapshot, call.CurrentNodeKey); findErr == nil {
			call.AgentTrace = append(call.AgentTrace, domain.AgentTrace{NodeKey: call.CurrentNodeKey, AgentID: agentID, EnteredAt: now})
		}
	}
	if err := s.Store.SaveCall(ctx, call); err != nil {
		return err
	}
	_ = s.Store.IncrementCampaignCount(ctx, call.CampaignID, "dispatched", 1)
	return nil
}

func directCallAgentID(swarm domain.AgentSwarm, requested string) (string, error) {
	if requested == "" {
		return graphAgentID(swarm.Graph, swarm.Graph.EntryNodeKey)
	}
	for _, node := range swarm.Graph.Nodes {
		if node.AgentID == requested {
			return requested, nil
		}
	}
	return "", errors.New("agent_id is not a node in the selected outbound swarm")
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func sharesValue(left, right []string) bool {
	for _, value := range left {
		if contains(right, value) {
			return true
		}
	}
	return false
}

func validateAgentTools(agent domain.Agent) error {
	seen := map[string]bool{}
	for _, tool := range agent.Tools {
		key := strings.TrimSpace(tool.Key)
		if key == "" {
			return errors.New("tool key is required")
		}
		if seen[key] {
			return fmt.Errorf("tool %s is configured more than once", key)
		}
		seen[key] = true
		definition, ok := domain.AgentToolDefinition(key)
		if !ok {
			return fmt.Errorf("tool %s is not registered in the runtime catalog", key)
		}
		if !tool.Enabled {
			continue
		}
		if !definition.Assignable || definition.Availability == "unavailable" {
			return fmt.Errorf("tool %s is not available for assignment", key)
		}
		if !sharesValue(agent.Channels, definition.Channels) {
			return fmt.Errorf("tool %s is not available on this agent's channel", key)
		}
		if len(definition.Directions) > 0 && !contains(definition.Directions, agent.Direction) {
			return fmt.Errorf("tool %s is not available for %s agents", key, agent.Direction)
		}
	}
	if contains(agent.Channels, "web") && !agentToolEnabled(agent, "search_catalog") {
		return errors.New("web agents require the search_catalog tool")
	}
	return nil
}

func agentToolEnabled(agent domain.Agent, key string) bool {
	for _, tool := range agent.Tools {
		if tool.Key == key && tool.Enabled {
			return true
		}
	}
	return false
}

func validateCaptureContract(capture domain.CaptureConfig) error {
	seen := map[string]bool{}
	supported := []string{"string", "boolean", "number", "number_range", "datetime", "select", "multi_select"}
	for _, field := range capture.Fields {
		key := strings.TrimSpace(field.Key)
		if key == "" || strings.TrimSpace(field.Label) == "" {
			return errors.New("capture fields require a key and label")
		}
		if seen[key] {
			return fmt.Errorf("capture field %s is configured more than once", key)
		}
		seen[key] = true
		if !contains(supported, field.Type) {
			return fmt.Errorf("capture field %s has an unsupported type", key)
		}
	}
	return nil
}

func cloneMap(value map[string]any) map[string]any {
	if value == nil {
		return nil
	}
	result := make(map[string]any, len(value))
	for key, item := range value {
		result[key] = item
	}
	return result
}

func mapValue(value any) map[string]any {
	result, _ := value.(map[string]any)
	return result
}

func stringValue(value any) string {
	result, _ := value.(string)
	return strings.TrimSpace(result)
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func (s *Service) deferDispatch(ctx context.Context, call domain.Call, scheduledAt time.Time) error {
	call.Status = "pending"
	call.ScheduledAt = scheduledAt.UTC()
	call.LeaseUntil = nil
	call.UpdatedAt = time.Now().UTC()
	if call.Attempt > 0 {
		call.Attempt-- // Eligibility checks are not dial attempts.
	}
	if err := s.Store.SaveCall(ctx, call); err != nil {
		return err
	}
	return store.ErrNotFound
}

func (s *Service) cancelUndispatchedCall(ctx context.Context, call domain.Call, reason string) error {
	now := time.Now().UTC()
	call.Status = "cancelled"
	call.LeaseUntil = nil
	call.EndedAt = &now
	call.UpdatedAt = now
	call.Failure = mergeFailure(call.Failure, "campaign_gate", reason)
	if err := s.Store.SaveCall(ctx, call); err != nil {
		return err
	}
	_ = s.Store.IncrementCampaignCount(ctx, call.CampaignID, "cancelled", 1)
	return store.ErrNotFound
}

func withinCallingWindow(window domain.CallingWindow, now time.Time) bool {
	location, startMinute, endMinute, ok := parseCallingWindow(window)
	if !ok {
		return false
	}
	local := now.In(location)
	minute := local.Hour()*60 + local.Minute()
	if startMinute < endMinute {
		return minute >= startMinute && minute < endMinute
	}
	return minute >= startMinute || minute < endMinute
}

func nextCallingWindow(window domain.CallingWindow, now time.Time) time.Time {
	location, startMinute, _, ok := parseCallingWindow(window)
	if !ok {
		return now.Add(15 * time.Minute)
	}
	local := now.In(location)
	next := time.Date(local.Year(), local.Month(), local.Day(), startMinute/60, startMinute%60, 0, 0, location)
	if !next.After(local) {
		next = next.AddDate(0, 0, 1)
	}
	return next.UTC()
}

func parseCallingWindow(window domain.CallingWindow) (*time.Location, int, int, bool) {
	location, err := time.LoadLocation(window.Timezone)
	if err != nil {
		return nil, 0, 0, false
	}
	parseMinute := func(value string) (int, bool) {
		parsed, parseErr := time.Parse("15:04", value)
		if parseErr != nil {
			return 0, false
		}
		return parsed.Hour()*60 + parsed.Minute(), true
	}
	start, startOK := parseMinute(window.Start)
	end, endOK := parseMinute(window.End)
	return location, start, end, startOK && endOK && start != end
}

func (s *Service) dispositionAgent(ctx context.Context, call domain.Call) (domain.Agent, error) {
	ids := []string{}
	seen := map[string]bool{}
	for _, trace := range call.AgentTrace {
		if trace.AgentID != "" && !seen[trace.AgentID] {
			seen[trace.AgentID] = true
			ids = append(ids, trace.AgentID)
		}
	}
	if len(ids) == 0 {
		id, err := graphAgentID(call.GraphSnapshot, call.CurrentNodeKey)
		if err != nil {
			return domain.Agent{}, err
		}
		ids = append(ids, id)
	}
	base, err := s.Store.GetAgent(ctx, ids[len(ids)-1])
	if err != nil {
		return domain.Agent{}, err
	}
	fields := []domain.CaptureField{}
	fieldKeys := map[string]bool{}
	for _, id := range ids {
		agent, getErr := s.Store.GetAgent(ctx, id)
		if getErr != nil {
			return domain.Agent{}, getErr
		}
		for _, field := range agent.Capture.Fields {
			if !fieldKeys[field.Key] {
				fieldKeys[field.Key] = true
				fields = append(fields, field)
			}
		}
	}
	if call.CampaignSnapshot != nil {
		for _, field := range call.CampaignSnapshot.Capture.Fields {
			if !fieldKeys[field.Key] {
				fieldKeys[field.Key] = true
				fields = append(fields, field)
			}
		}
		if strings.TrimSpace(call.CampaignSnapshot.Instructions.Objective) != "" {
			base.Instructions.System += "\n\nCampaign objective: " + call.CampaignSnapshot.Instructions.Objective
		}
	}
	base.Capture.Fields = fields
	return base, nil
}

func graphAgentID(graph domain.SwarmGraph, nodeKey string) (string, error) {
	for _, node := range graph.Nodes {
		if node.Key == nodeKey {
			return node.AgentID, nil
		}
	}
	return "", fmt.Errorf("graph node %q is unavailable", nodeKey)
}

func (s *Service) failDispatch(ctx context.Context, call domain.Call, cause error) error {
	now := time.Now().UTC()
	call.UpdatedAt = now
	call.LeaseUntil = nil
	call.Failure = mergeFailure(call.Failure, "dispatch", cause.Error())
	if call.Attempt < call.MaxAttempts {
		call.Status = "pending"
		call.ScheduledAt = now.Add(time.Duration(call.Attempt) * 5 * time.Minute)
	} else {
		call.Status = "failed"
		call.EndedAt = &now
	}
	_ = s.Store.SaveCall(ctx, call)
	return cause
}

func sanitizePlan(plan domain.SearchPlan, filters map[string]any) domain.SearchPlan {
	plan.Brand = allowedValues(plan.Brand, optionSet(filters["brands"]))
	plan.Category = allowedValues(plan.Category, optionSet(filters["categories"]))
	plan.ProductType = allowedValues(plan.ProductType, optionSet(filters["productTypes"]))
	plan.Colour = allowedValues(plan.Colour, optionSet(filters["colors"]))
	plan.Size = allowedValues(plan.Size, optionSet(filters["sizes"]))
	fieldSets := map[string]map[string]string{}
	if fields, ok := filters["fields"].([]any); ok {
		for _, raw := range fields {
			if field, ok := raw.(map[string]any); ok {
				key, _ := field["key"].(string)
				if key != "" {
					fieldSets[key] = optionSet(field["options"])
				}
			}
		}
	}
	plan.Gender = allowedValues(plan.Gender, fieldSets["gender"])
	cleanMetadata := map[string][]string{}
	for key, values := range plan.Metadata {
		if allowed, ok := fieldSets[key]; ok {
			if clean := allowedValues(values, allowed); len(clean) > 0 {
				cleanMetadata[key] = clean
			}
		}
	}
	plan.Metadata = cleanMetadata
	if plan.SwoopStyl && !regexp.MustCompile(`^[1-9][0-9]{5}$`).MatchString(plan.Pincode) {
		plan.SwoopStyl = false
		plan.Pincode = ""
	}
	return plan
}

func optionSet(raw any) map[string]string {
	result := map[string]string{}
	items, _ := raw.([]any)
	for _, item := range items {
		if text, ok := item.(string); ok {
			result[strings.ToLower(text)] = text
			continue
		}
		value, ok := item.(map[string]any)
		if !ok {
			continue
		}
		for _, key := range []string{"key", "value", "slug", "name", "label"} {
			if text, ok := value[key].(string); ok && text != "" {
				normalized := strings.ToLower(text)
				if _, exists := result[normalized]; !exists {
					result[normalized] = text
				}
			}
		}
		if families, ok := value["familyKeys"].([]any); ok {
			for _, family := range families {
				if text, ok := family.(string); ok {
					result[strings.ToLower(text)] = text
				}
			}
		}
	}
	return result
}

func allowedValues(values []string, allowed map[string]string) []string {
	result := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		if canonical, ok := allowed[strings.ToLower(strings.TrimSpace(value))]; ok && !seen[canonical] {
			seen[canonical] = true
			result = append(result, canonical)
		}
	}
	return result
}

func planSummary(plan domain.SearchPlan) map[string]any {
	return map[string]any{"brand": plan.Brand, "category": plan.Category, "productType": plan.ProductType, "colour": plan.Colour, "size": plan.Size, "gender": plan.Gender, "metadata": plan.Metadata, "minPrice": plan.MinPrice, "maxPrice": plan.MaxPrice, "pincode": plan.Pincode, "swoopstyl": plan.SwoopStyl, "sort": plan.Sort}
}

func randomID(prefix string) string { return prefix + "_" + randomToken(12) }
func randomToken(bytesCount int) string {
	value := make([]byte, bytesCount)
	if _, err := rand.Read(value); err != nil {
		panic(err)
	}
	return hex.EncodeToString(value)
}
func tokenHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func mergeFailure(existing map[string]any, stage, message string) map[string]any {
	if existing == nil {
		existing = map[string]any{}
	}
	existing[stage] = message
	return existing
}

func CallFilter(campaignID, direction, status string) bson.M {
	filter := bson.M{}
	if campaignID != "" {
		filter["campaign_id"] = campaignID
	}
	if direction != "" {
		filter["direction"] = direction
	}
	if status != "" {
		filter["status"] = status
	}
	return filter
}

func SortEdges(edges []domain.SwarmEdge) {
	sort.SliceStable(edges, func(i, j int) bool { return edges[i].Priority > edges[j].Priority })
}
