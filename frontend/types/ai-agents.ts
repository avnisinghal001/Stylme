export type AiStarterConfig = {
  agentId: string;
  name: string;
  greeting: string;
  starterPrompts: string[];
  available: boolean;
};

export type AiSearchPlan = {
  assistantMessage: string;
  needsClarification: boolean;
  clarifyingQuestion: string;
  lexicalQuery: string;
  brand: string[];
  category: string[];
  productType: string[];
  colour: string[];
  size: string[];
  gender: string[];
  metadata: Record<string, string[]>;
  minPrice: number | null;
  maxPrice: number | null;
  pincode: string;
  swoopstyl: boolean;
  sort: string;
  profileProposal: Record<string, unknown>;
};

export type AiComponent = {
  type: "clarification" | "filter_summary" | "product_grid" | "profile_proposal" | string;
  data: Record<string, unknown>;
};

export type AiChatMessage = {
  role: "user" | "assistant";
  text: string;
  components?: AiComponent[];
  createdAt?: string;
};

export type AiSessionStart = {
  sessionId: string;
  sessionToken: string;
  expiresAt: string;
  agent: { id: string; name: string; greeting: string; starterPrompts: string[] };
};

export type AgentConfig = {
  id: string;
  key: string;
  name: string;
  description: string;
  channels: string[];
  direction: string;
  status: string;
  isDefault: boolean;
  revision: number;
  instructions: { system: string; greeting: string; guardrails: string[]; fallback: string };
  model: { provider: string; name: string; temperature: number; maxOutputTokens: number; reasoningEffort?: string };
  voice?: { language: string; sttProvider: string; sttModel: string; ttsProvider: string; ttsModel: string; speaker: string; pace: number; allowInterruption: boolean; endCallAfterSec: number };
  web?: { starterPrompts: string[]; maxHistoryMessages: number; resultLimit: number; allowProfileProposal: boolean };
  tools: Array<{ key: string; description: string; enabled: boolean; config?: Record<string, unknown> }>;
  capture: { fields: Array<{ key: string; label: string; type: string; description: string; required: boolean; enum?: string[] }> };
  metadata: Record<string, unknown>;
};

export type AgentToolDefinition = {
  key: string;
  name: string;
  description: string;
  group: string;
  channels: string[];
  directions: string[];
  availability: "ready" | "setup_required" | "always_on" | "unavailable";
  assignable: boolean;
  riskLevel: string;
  runtime: string;
  requirements: string[];
};

export type AgentSwarm = {
  id: string;
  key: string;
  name: string;
  description: string;
  channels: string[];
  directions: string[];
  status: string;
  isDefault: boolean;
  revision: number;
  graph: {
    entryNodeKey: string;
    nodes: Array<{ key: string; agentId: string; instructionOverrides?: string; metadata: Record<string, unknown> }>;
    edges: Array<{ from: string; to: string; priority: number; condition: { field: string; operator: string; value?: unknown }; handoffMessage?: string }>;
  };
  telephony: { phoneNumber?: string; humanHandoffNumber?: string; inboundTrunkId?: string; outboundTrunkId?: string; dispatchRuleId?: string; liveKitAgentName?: string };
  metadata: Record<string, unknown>;
};

export type AiCampaign = {
  id: string;
  name: string;
  kind: string;
  swarmId: string;
  entryNodeKey: string;
  status: string;
  direction: string;
  fromNumber: string;
  callingWindow: { timezone: string; start: string; end: string };
  retryPolicy: { maxAttempts: number; backoffMinutes: number[]; retryOnCodes: string[] };
  maxConcurrency: number;
  callsPerSecond: number;
  language: string;
  instructions: { objective: string; system: string; greeting: string };
  capture: AgentConfig["capture"];
  counts: Record<string, number>;
  metadata: Record<string, unknown>;
  updatedAt?: string;
};

export type AiCall = {
  id: string;
  campaignId?: string;
  swarmId: string;
  direction: string;
  status: string;
  from: string;
  to: string;
  attempt: number;
  currentNodeKey: string;
  disposition?: { code: string; summary: string; capturedData: Record<string, unknown>; missingFields?: string[]; nextAction?: string; confidence: number };
  transcript?: Array<{ role: string; agentId?: string; text: string; createdAt: string }>;
  participant?: Record<string, unknown>;
  context?: Record<string, unknown>;
  createdAt: string;
};

export type ProviderCredentialStatus = {
  provider: "openai" | "deepgram" | "sarvam";
  configured: boolean;
  source: "database" | "environment" | "none";
  keyHint?: string;
  status: string;
  expiresAt?: string;
  updatedAt?: string;
};

export type SarvamVoice = {
  id: string;
  name: string;
  gender: "female" | "male";
};

export type SarvamVoiceCatalog = {
  provider: "sarvam";
  model: "bulbul:v3";
  default: string;
  items: SarvamVoice[];
  languages: string[];
};

export type AiReply = {
  sessionId: string;
  message: AiChatMessage;
  plan: AiSearchPlan;
  search?: Record<string, unknown>;
};
