import { getAccessToken } from "@/lib/api/client";
import { getPublicAiApiBaseUrl } from "@/lib/api/public-endpoints";
import type { AiReply, AiSessionStart, AiStarterConfig } from "@/types/ai-agents";

async function aiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const accessToken = getAccessToken();
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${getPublicAiApiBaseUrl()}${path}`, { ...init, headers, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message || `AI stylist request failed (${response.status}).`);
  return payload as T;
}

export function getAiStarterConfig(): Promise<AiStarterConfig> {
  return aiRequest("/public/ai/config");
}

export function createAiSession(): Promise<AiSessionStart> {
  return aiRequest("/web/sessions", {
    method: "POST",
    body: JSON.stringify({ metadata: { surface: "storefront-hero", locale: navigator.language } }),
  });
}

export function sendAiMessage(sessionId: string, sessionToken: string, text: string): Promise<AiReply> {
  return aiRequest(`/web/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    headers: { "X-AI-Session-Token": sessionToken },
    body: JSON.stringify({ text }),
  });
}
