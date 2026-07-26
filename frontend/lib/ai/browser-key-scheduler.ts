'use client';

export type BrowserAiProvider = 'google' | 'openrouter';

export interface BrowserAiRoute {
  provider: BrowserAiProvider;
  model: string;
  keyId: string;
  apiKey: string;
  supportsVision: boolean;
}

interface KeyHealth {
  cooldownUntil: number;
  failures: number;
  successes: number;
  lastUsedAt: number;
}

interface SchedulerState {
  version: 2;
  keys: Record<string, KeyHealth>;
}

const STORAGE_KEY = 'stylme.ai-key-health.v2';
const EMPTY_HEALTH: KeyHealth = { cooldownUntil: 0, failures: 0, successes: 0, lastUsedAt: 0 };

const healthKey = (route: BrowserAiRoute) => (
  `${route.provider}:${route.model}:${route.keyId}:${route.apiKey.slice(-8)}`
);

function readState(): SchedulerState {
  if (typeof window === 'undefined') return { version: 2, keys: {} };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '') as SchedulerState;
    return parsed?.version === 2 && parsed.keys ? parsed : { version: 2, keys: {} };
  } catch {
    return { version: 2, keys: {} };
  }
}

function saveState(state: SchedulerState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Browsers with disabled storage still get in-call rotation/fallback.
  }
}

function getStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  for (const value of [candidate.status, candidate.statusCode, candidate.response?.status]) {
    if (typeof value === 'number') return value;
  }
  const match = (error instanceof Error ? error.message : String(error)).match(/\b(401|403|408|409|429|5\d\d)\b/);
  return match ? Number(match[1]) : null;
}

function cooldownMs(error: unknown, failures: number) {
  const status = getStatus(error);
  if (status === 401 || status === 403) return 30 * 60_000;
  if (status === 429) return Math.min(10 * 60_000, 60_000 * Math.max(1, failures));
  if (status === 408 || (status !== null && status >= 500)) return Math.min(2 * 60_000, 10_000 * Math.max(1, failures));
  return Math.min(60_000, 5_000 * Math.max(1, failures));
}

export class BrowserAiKeyScheduler {
  constructor(private readonly routes: BrowserAiRoute[]) {}

  async execute<T>(operation: (route: BrowserAiRoute) => Promise<T>): Promise<{ value: T; route: BrowserAiRoute; attempts: number }> {
    if (!this.routes.length) {
      throw new Error('No public AI provider keys are configured for hackathon mode.');
    }

    const state = readState();
    const now = Date.now();
    const ranked = this.routes
      .map((route, routeOrder) => ({ route, routeOrder, stateKey: healthKey(route), health: state.keys[healthKey(route)] ?? EMPTY_HEALTH }))
      .sort((left, right) => {
        const providerOrder = left.routeOrder - right.routeOrder;
        if (left.route.provider !== right.route.provider) return providerOrder;
        return left.health.lastUsedAt - right.health.lastUsedAt;
      });
    const ready = ranked.filter(({ health }) => health.cooldownUntil <= now);
    // A cooldown is advisory. If every route is cooling down, make one real
    // pass instead of ending the shopper workflow before contacting a provider.
    const available = ready.length ? ready : ranked.sort((left, right) => left.health.cooldownUntil - right.health.cooldownUntil);

    let lastError: unknown;
    let attempts = 0;
    for (const { route, stateKey } of available) {
      attempts += 1;
      const health = state.keys[stateKey] ?? { ...EMPTY_HEALTH };
      health.lastUsedAt = Date.now();
      state.keys[stateKey] = health;
      saveState(state);
      try {
        const value = await operation(route);
        health.successes += 1;
        health.failures = 0;
        health.cooldownUntil = 0;
        saveState(state);
        return { value, route, attempts };
      } catch (error) {
        lastError = error;
        health.failures += 1;
        health.cooldownUntil = Date.now() + cooldownMs(error, health.failures);
        saveState(state);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Every configured AI provider failed.');
  }
}
