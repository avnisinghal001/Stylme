package domain

import "time"

type Metadata map[string]any

type Instructions struct {
	System     string   `bson:"system" json:"system"`
	Greeting   string   `bson:"greeting" json:"greeting"`
	Guardrails []string `bson:"guardrails" json:"guardrails"`
	Fallback   string   `bson:"fallback" json:"fallback"`
}

type ModelConfig struct {
	Provider        string  `bson:"provider" json:"provider"`
	Name            string  `bson:"name" json:"name"`
	Temperature     float64 `bson:"temperature" json:"temperature"`
	MaxOutputTokens int     `bson:"max_output_tokens" json:"maxOutputTokens"`
	ReasoningEffort string  `bson:"reasoning_effort,omitempty" json:"reasoningEffort,omitempty"`
}

type VoiceConfig struct {
	Language          string  `bson:"language" json:"language"`
	STTProvider       string  `bson:"stt_provider" json:"sttProvider"`
	STTModel          string  `bson:"stt_model" json:"sttModel"`
	TTSProvider       string  `bson:"tts_provider" json:"ttsProvider"`
	TTSModel          string  `bson:"tts_model" json:"ttsModel"`
	Speaker           string  `bson:"speaker" json:"speaker"`
	Pace              float64 `bson:"pace" json:"pace"`
	AllowInterruption bool    `bson:"allow_interruption" json:"allowInterruption"`
	EndCallAfterSec   int     `bson:"end_call_after_sec" json:"endCallAfterSec"`
}

type WebConfig struct {
	StarterPrompts       []string `bson:"starter_prompts" json:"starterPrompts"`
	MaxHistoryMessages   int      `bson:"max_history_messages" json:"maxHistoryMessages"`
	ResultLimit          int      `bson:"result_limit" json:"resultLimit"`
	AllowProfileProposal bool     `bson:"allow_profile_proposal" json:"allowProfileProposal"`
}

type CaptureField struct {
	Key         string   `bson:"key" json:"key"`
	Label       string   `bson:"label" json:"label"`
	Type        string   `bson:"type" json:"type"`
	Description string   `bson:"description" json:"description"`
	Required    bool     `bson:"required" json:"required"`
	Enum        []string `bson:"enum,omitempty" json:"enum,omitempty"`
}

type CaptureConfig struct {
	Fields []CaptureField `bson:"fields" json:"fields"`
}

type CampaignInstructions struct {
	Objective string `bson:"objective" json:"objective"`
	System    string `bson:"system" json:"system"`
	Greeting  string `bson:"greeting" json:"greeting"`
}

type ToolConfig struct {
	Key         string         `bson:"key" json:"key"`
	Description string         `bson:"description" json:"description"`
	Enabled     bool           `bson:"enabled" json:"enabled"`
	Config      map[string]any `bson:"config,omitempty" json:"config,omitempty"`
}

type Agent struct {
	ID           string        `bson:"_id" json:"id"`
	Key          string        `bson:"key" json:"key"`
	Name         string        `bson:"name" json:"name"`
	Description  string        `bson:"description" json:"description"`
	Channels     []string      `bson:"channels" json:"channels"`
	Direction    string        `bson:"direction" json:"direction"`
	Status       string        `bson:"status" json:"status"`
	IsDefault    bool          `bson:"is_default" json:"isDefault"`
	Revision     int           `bson:"revision" json:"revision"`
	Instructions Instructions  `bson:"instructions" json:"instructions"`
	Model        ModelConfig   `bson:"model" json:"model"`
	Voice        *VoiceConfig  `bson:"voice,omitempty" json:"voice,omitempty"`
	Web          *WebConfig    `bson:"web,omitempty" json:"web,omitempty"`
	Tools        []ToolConfig  `bson:"tools" json:"tools"`
	Capture      CaptureConfig `bson:"capture" json:"capture"`
	Metadata     Metadata      `bson:"metadata" json:"metadata"`
	CreatedBy    string        `bson:"created_by,omitempty" json:"createdBy,omitempty"`
	UpdatedBy    string        `bson:"updated_by,omitempty" json:"updatedBy,omitempty"`
	CreatedAt    time.Time     `bson:"created_at" json:"createdAt"`
	UpdatedAt    time.Time     `bson:"updated_at" json:"updatedAt"`
}

type SwarmNode struct {
	Key                  string   `bson:"key" json:"key"`
	AgentID              string   `bson:"agent_id" json:"agentId"`
	InstructionOverrides string   `bson:"instruction_overrides,omitempty" json:"instructionOverrides,omitempty"`
	Metadata             Metadata `bson:"metadata" json:"metadata"`
}

type TransitionCondition struct {
	Field    string `bson:"field" json:"field"`
	Operator string `bson:"operator" json:"operator"`
	Value    any    `bson:"value,omitempty" json:"value,omitempty"`
}

type SwarmEdge struct {
	From           string              `bson:"from" json:"from"`
	To             string              `bson:"to" json:"to"`
	Priority       int                 `bson:"priority" json:"priority"`
	Condition      TransitionCondition `bson:"condition" json:"condition"`
	HandoffMessage string              `bson:"handoff_message,omitempty" json:"handoffMessage,omitempty"`
}

type SwarmGraph struct {
	EntryNodeKey string      `bson:"entry_node_key" json:"entryNodeKey"`
	Nodes        []SwarmNode `bson:"nodes" json:"nodes"`
	Edges        []SwarmEdge `bson:"edges" json:"edges"`
}

type TelephonyBinding struct {
	PhoneNumber        string `bson:"phone_number,omitempty" json:"phoneNumber,omitempty"`
	HumanHandoffNumber string `bson:"human_handoff_number,omitempty" json:"humanHandoffNumber,omitempty"`
	InboundTrunkID     string `bson:"inbound_trunk_id,omitempty" json:"inboundTrunkId,omitempty"`
	OutboundTrunkID    string `bson:"outbound_trunk_id,omitempty" json:"outboundTrunkId,omitempty"`
	DispatchRuleID     string `bson:"dispatch_rule_id,omitempty" json:"dispatchRuleId,omitempty"`
	LiveKitAgentName   string `bson:"livekit_agent_name,omitempty" json:"livekitAgentName,omitempty"`
}

type AgentSwarm struct {
	ID          string           `bson:"_id" json:"id"`
	Key         string           `bson:"key" json:"key"`
	Name        string           `bson:"name" json:"name"`
	Description string           `bson:"description" json:"description"`
	Channels    []string         `bson:"channels" json:"channels"`
	Directions  []string         `bson:"directions" json:"directions"`
	Status      string           `bson:"status" json:"status"`
	IsDefault   bool             `bson:"is_default" json:"isDefault"`
	Revision    int              `bson:"revision" json:"revision"`
	Graph       SwarmGraph       `bson:"graph" json:"graph"`
	Telephony   TelephonyBinding `bson:"telephony" json:"telephony"`
	Metadata    Metadata         `bson:"metadata" json:"metadata"`
	CreatedBy   string           `bson:"created_by,omitempty" json:"createdBy,omitempty"`
	UpdatedBy   string           `bson:"updated_by,omitempty" json:"updatedBy,omitempty"`
	CreatedAt   time.Time        `bson:"created_at" json:"createdAt"`
	UpdatedAt   time.Time        `bson:"updated_at" json:"updatedAt"`
}

type CallingWindow struct {
	Timezone string `bson:"timezone" json:"timezone"`
	Start    string `bson:"start" json:"start"`
	End      string `bson:"end" json:"end"`
}

type RetryPolicy struct {
	MaxAttempts  int      `bson:"max_attempts" json:"maxAttempts"`
	BackoffMins  []int    `bson:"backoff_minutes" json:"backoffMinutes"`
	RetryOnCodes []string `bson:"retry_on_codes" json:"retryOnCodes"`
}

type Campaign struct {
	ID             string               `bson:"_id" json:"id"`
	Name           string               `bson:"name" json:"name"`
	Kind           string               `bson:"kind" json:"kind"`
	SwarmID        string               `bson:"swarm_id" json:"swarmId"`
	EntryNodeKey   string               `bson:"entry_node_key" json:"entryNodeKey"`
	Status         string               `bson:"status" json:"status"`
	Direction      string               `bson:"direction" json:"direction"`
	FromNumber     string               `bson:"from_number" json:"fromNumber"`
	CallingWindow  CallingWindow        `bson:"calling_window" json:"callingWindow"`
	RetryPolicy    RetryPolicy          `bson:"retry_policy" json:"retryPolicy"`
	MaxConcurrency int                  `bson:"max_concurrency" json:"maxConcurrency"`
	CallsPerSecond float64              `bson:"calls_per_second" json:"callsPerSecond"`
	Language       string               `bson:"language" json:"language"`
	Instructions   CampaignInstructions `bson:"instructions" json:"instructions"`
	Capture        CaptureConfig        `bson:"capture" json:"capture"`
	Counts         map[string]int64     `bson:"counts" json:"counts"`
	Metadata       Metadata             `bson:"metadata" json:"metadata"`
	CreatedBy      string               `bson:"created_by,omitempty" json:"createdBy,omitempty"`
	UpdatedBy      string               `bson:"updated_by,omitempty" json:"updatedBy,omitempty"`
	CreatedAt      time.Time            `bson:"created_at" json:"createdAt"`
	UpdatedAt      time.Time            `bson:"updated_at" json:"updatedAt"`
}

type CampaignSnapshot struct {
	ID           string               `bson:"id" json:"id"`
	Name         string               `bson:"name" json:"name"`
	Kind         string               `bson:"kind" json:"kind"`
	EntryNodeKey string               `bson:"entry_node_key" json:"entryNodeKey"`
	Language     string               `bson:"language" json:"language"`
	Instructions CampaignInstructions `bson:"instructions" json:"instructions"`
	Capture      CaptureConfig        `bson:"capture" json:"capture"`
}

type TranscriptTurn struct {
	Role      string    `bson:"role" json:"role"`
	AgentID   string    `bson:"agent_id,omitempty" json:"agentId,omitempty"`
	Text      string    `bson:"text" json:"text"`
	CreatedAt time.Time `bson:"created_at" json:"createdAt"`
}

type AgentTrace struct {
	NodeKey   string     `bson:"node_key" json:"nodeKey"`
	AgentID   string     `bson:"agent_id" json:"agentId"`
	EnteredAt time.Time  `bson:"entered_at" json:"enteredAt"`
	ExitedAt  *time.Time `bson:"exited_at,omitempty" json:"exitedAt,omitempty"`
	Reason    string     `bson:"reason,omitempty" json:"reason,omitempty"`
}

type Disposition struct {
	Code          string         `bson:"code" json:"code"`
	Summary       string         `bson:"summary" json:"summary"`
	CapturedData  map[string]any `bson:"captured_data" json:"capturedData"`
	MissingFields []string       `bson:"missing_fields" json:"missingFields"`
	NextAction    string         `bson:"next_action" json:"nextAction"`
	Confidence    float64        `bson:"confidence" json:"confidence"`
	GeneratedAt   *time.Time     `bson:"generated_at,omitempty" json:"generatedAt,omitempty"`
}

type Call struct {
	ID               string            `bson:"_id" json:"id"`
	TenantID         string            `bson:"tenant_id" json:"tenantId"`
	CampaignID       string            `bson:"campaign_id,omitempty" json:"campaignId,omitempty"`
	SwarmID          string            `bson:"swarm_id" json:"swarmId"`
	Direction        string            `bson:"direction" json:"direction"`
	Status           string            `bson:"status" json:"status"`
	ExternalID       string            `bson:"external_id,omitempty" json:"externalId,omitempty"`
	IdempotencyKey   string            `bson:"idempotency_key" json:"idempotencyKey"`
	From             string            `bson:"from" json:"from"`
	To               string            `bson:"to" json:"to"`
	Attempt          int               `bson:"attempt" json:"attempt"`
	MaxAttempts      int               `bson:"max_attempts" json:"maxAttempts"`
	ScheduledAt      time.Time         `bson:"scheduled_at" json:"scheduledAt"`
	LeaseUntil       *time.Time        `bson:"lease_until,omitempty" json:"leaseUntil,omitempty"`
	GraphSnapshot    SwarmGraph        `bson:"graph_snapshot" json:"graphSnapshot"`
	CampaignSnapshot *CampaignSnapshot `bson:"campaign_snapshot,omitempty" json:"campaignSnapshot,omitempty"`
	CurrentNodeKey   string            `bson:"current_node_key" json:"currentNodeKey"`
	AgentTrace       []AgentTrace      `bson:"agent_trace" json:"agentTrace"`
	Participant      map[string]any    `bson:"participant" json:"participant"`
	Context          map[string]any    `bson:"context" json:"context"`
	LiveKit          map[string]string `bson:"livekit" json:"livekit"`
	Transcript       []TranscriptTurn  `bson:"transcript" json:"transcript"`
	RecordingURL     string            `bson:"recording_url,omitempty" json:"recordingUrl,omitempty"`
	Disposition      *Disposition      `bson:"disposition,omitempty" json:"disposition,omitempty"`
	Failure          map[string]any    `bson:"failure,omitempty" json:"failure,omitempty"`
	Metadata         Metadata          `bson:"metadata" json:"metadata"`
	StartedAt        *time.Time        `bson:"started_at,omitempty" json:"startedAt,omitempty"`
	AnsweredAt       *time.Time        `bson:"answered_at,omitempty" json:"answeredAt,omitempty"`
	EndedAt          *time.Time        `bson:"ended_at,omitempty" json:"endedAt,omitempty"`
	CreatedAt        time.Time         `bson:"created_at" json:"createdAt"`
	UpdatedAt        time.Time         `bson:"updated_at" json:"updatedAt"`
}

type ProviderCredential struct {
	ID         string     `bson:"_id" json:"id"`
	Provider   string     `bson:"provider" json:"provider"`
	Label      string     `bson:"label" json:"label"`
	Ciphertext string     `bson:"ciphertext" json:"-"`
	KeyHint    string     `bson:"key_hint" json:"keyHint"`
	Status     string     `bson:"status" json:"status"`
	ExpiresAt  *time.Time `bson:"expires_at,omitempty" json:"expiresAt,omitempty"`
	Metadata   Metadata   `bson:"metadata" json:"metadata"`
	CreatedBy  string     `bson:"created_by,omitempty" json:"createdBy,omitempty"`
	UpdatedBy  string     `bson:"updated_by,omitempty" json:"updatedBy,omitempty"`
	CreatedAt  time.Time  `bson:"created_at" json:"createdAt"`
	UpdatedAt  time.Time  `bson:"updated_at" json:"updatedAt"`
}

type ChatMessage struct {
	Role       string        `bson:"role" json:"role"`
	Text       string        `bson:"text" json:"text"`
	Components []UIComponent `bson:"components,omitempty" json:"components,omitempty"`
	CreatedAt  time.Time     `bson:"created_at" json:"createdAt"`
}

type UIComponent struct {
	Type string         `bson:"type" json:"type"`
	Data map[string]any `bson:"data" json:"data"`
}

type AISession struct {
	ID              string         `bson:"_id" json:"id"`
	AccessTokenHash string         `bson:"access_token_hash" json:"-"`
	UserID          string         `bson:"user_id,omitempty" json:"userId,omitempty"`
	AgentID         string         `bson:"agent_id" json:"agentId"`
	SwarmID         string         `bson:"swarm_id,omitempty" json:"swarmId,omitempty"`
	Status          string         `bson:"status" json:"status"`
	Messages        []ChatMessage  `bson:"messages" json:"messages"`
	ProfileContext  map[string]any `bson:"profile_context" json:"profileContext"`
	Metadata        Metadata       `bson:"metadata" json:"metadata"`
	ExpiresAt       time.Time      `bson:"expires_at" json:"expiresAt"`
	CreatedAt       time.Time      `bson:"created_at" json:"createdAt"`
	UpdatedAt       time.Time      `bson:"updated_at" json:"updatedAt"`
}

type SearchPlan struct {
	AssistantMessage   string              `json:"assistantMessage"`
	NeedsClarification bool                `json:"needsClarification"`
	ClarifyingQuestion string              `json:"clarifyingQuestion"`
	LexicalQuery       string              `json:"lexicalQuery"`
	Brand              []string            `json:"brand"`
	Category           []string            `json:"category"`
	ProductType        []string            `json:"productType"`
	Colour             []string            `json:"colour"`
	Size               []string            `json:"size"`
	Gender             []string            `json:"gender"`
	Metadata           map[string][]string `json:"metadata"`
	MinPrice           *float64            `json:"minPrice"`
	MaxPrice           *float64            `json:"maxPrice"`
	Pincode            string              `json:"pincode"`
	SwoopStyl          bool                `json:"swoopstyl"`
	Sort               string              `json:"sort"`
	ProfileProposal    map[string]any      `json:"profileProposal"`
}
