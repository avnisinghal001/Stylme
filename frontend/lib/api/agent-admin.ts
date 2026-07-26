import { getAccessToken } from "@/lib/api/client";
import { getPublicAiApiBaseUrl } from "@/lib/api/public-endpoints";
import type { AgentConfig, AgentSwarm, AgentToolDefinition, AiCall, AiCampaign, ProviderCredentialStatus, SarvamVoiceCatalog } from "@/types/ai-agents";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`${getPublicAiApiBaseUrl()}${path}`, { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message || `Request failed (${response.status}).`);
  return payload as T;
}

export async function loadAgentWorkspace() {
  const [agents, tools, swarms, campaigns, calls, credentials] = await Promise.all([
    request<{ items: AgentConfig[] }>("/agents"), request<{ items: AgentToolDefinition[] }>("/tools"), request<{ items: AgentSwarm[] }>("/swarms"), request<{ items: AiCampaign[] }>("/campaigns"), request<{ items: AiCall[]; total: number }>("/calls?page=1&pageSize=20"), request<{ items: ProviderCredentialStatus[] }>("/credentials"),
  ]);
  return {
    agents: (agents.items ?? []).map((agent) => ({
      ...agent,
      channels: agent.channels ?? [],
      tools: agent.tools ?? [],
      capture: { fields: agent.capture?.fields ?? [] },
      metadata: agent.metadata ?? {},
    })),
    tools: (tools.items ?? []).map((tool) => ({
      ...tool,
      channels: tool.channels ?? [],
      directions: tool.directions ?? [],
      requirements: tool.requirements ?? [],
    })),
    swarms: (swarms.items ?? []).map((swarm) => ({
      ...swarm,
      channels: swarm.channels ?? [],
      directions: swarm.directions ?? [],
      graph: {
        entryNodeKey: swarm.graph?.entryNodeKey ?? "",
        nodes: swarm.graph?.nodes ?? [],
        edges: swarm.graph?.edges ?? [],
      },
      telephony: swarm.telephony ?? {},
      metadata: swarm.metadata ?? {},
    })),
    campaigns: campaigns.items ?? [],
    calls: calls.items ?? [],
    callsTotal: calls.total ?? 0,
    credentials: credentials.items ?? [],
  };
}

export function saveAgent(value: AgentConfig) { return request<AgentConfig>(value.id ? `/agents/${encodeURIComponent(value.id)}` : "/agents", { method: value.id ? "PUT" : "POST", body: JSON.stringify(value) }); }
export function saveSwarm(value: AgentSwarm) {
  const editable: Partial<AgentSwarm> = {
    ...value,
    telephony: { humanHandoffNumber: value.telephony.humanHandoffNumber },
  };
  return request<AgentSwarm>(value.id ? `/swarms/${encodeURIComponent(value.id)}` : "/swarms", {
    method: value.id ? "PUT" : "POST",
    body: JSON.stringify(editable),
  });
}
export function saveCampaign(value: AiCampaign) { return request<AiCampaign>(value.id ? `/campaigns/${encodeURIComponent(value.id)}` : "/campaigns", { method: value.id ? "PUT" : "POST", body: JSON.stringify(value) }); }
export function scheduleCampaign(id: string, targets: Array<{ externalId: string; phone: string; participant: Record<string, unknown>; context: Record<string, unknown>; metadata: Record<string, unknown> }>) { return request(`/campaigns/${encodeURIComponent(id)}/schedule`, { method: "POST", body: JSON.stringify({ targets }) }); }
export function saveProviderCredential(value: { provider: string; label: string; apiKey: string; expiresAt?: string | null; metadata: Record<string, unknown> }) { return request<ProviderCredentialStatus>("/credentials", { method: "POST", body: JSON.stringify(value) }); }
export function getSarvamVoices() { return request<SarvamVoiceCatalog>("/voices/sarvam"); }
export async function previewSarvamVoice(value: { speaker: string; language: string; text: string; pace: number }): Promise<Blob> {
  const headers = new Headers({ "content-type": "application/json" });
  const token = getAccessToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${getPublicAiApiBaseUrl()}/voices/sarvam/preview`, {
    method: "POST",
    headers,
    body: JSON.stringify(value),
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message || `Voice preview failed (${response.status}).`);
  }
  return response.blob();
}
export function triggerTestCall(value: { agent_id?: string; swarm_id?: string; to_number: string; from_number?: string; external_id?: string; idempotency_key?: string; participant?: Record<string, unknown>; context?: Record<string, unknown>; metadata?: Record<string, unknown> }) { return request<{ call_id: string; status: string; swarm_id: string; agent_id: string }>("/calls/trigger", { method: "POST", body: JSON.stringify(value) }); }
export function getCampaignAnalytics(id: string, period: "day" | "month") { return request<{ items: Array<{ period: string; status: string; count: number }> }>(`/campaigns/${encodeURIComponent(id)}/analytics?period=${period}`); }
export function getCalls(page: number, pageSize = 20, campaignId = "") { const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) }); if (campaignId) query.set("campaignId", campaignId); return request<{ items: AiCall[]; total: number; page: number; pageSize: number }>(`/calls?${query}`); }
export function runAbandonedCheckout(campaignId: string, limit = 100) { return request<{ campaignId: string; fetched?: number; eligible: number; scheduled: number; duplicates?: number; dispatched: number; invalid?: number; sourceErrors?: unknown[] }>("/admin/workflows/abandoned-checkout", { method: "POST", body: JSON.stringify({ campaignId, limit }) }); }
