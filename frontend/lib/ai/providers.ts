'use client';

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

import type { BrowserAiRoute } from '@/lib/ai/browser-key-scheduler';

const splitKeys = (values: Array<string | undefined>) => [...new Set(values
  .flatMap((value) => value?.split(',') ?? [])
  .map((value) => value.trim())
  .filter(Boolean))];

export function getBrowserAiRoutes(options: { requiresVision?: boolean } = {}): BrowserAiRoute[] {
  if (process.env.NEXT_PUBLIC_HACKATHON_DIRECT_AI !== 'true') return [];
  const googleKeys = splitKeys([
    process.env.NEXT_PUBLIC_GEMINI_API_KEYS,
    process.env.NEXT_PUBLIC_GEMINI_API_KEY,
    process.env.NEXT_PUBLIC_GEMINI_API_KEY_1,
    process.env.NEXT_PUBLIC_GEMINI_API_KEY_2,
    process.env.NEXT_PUBLIC_GEMINI_API_KEY_3,
    process.env.NEXT_PUBLIC_GEMINI_API_KEY_4,
    process.env.NEXT_PUBLIC_GOOGLE_GENERATIVE_AI_API_KEY,
  ]);
  const openRouterKeys = splitKeys([
    process.env.NEXT_PUBLIC_OPENROUTER_API_KEYS,
    process.env.NEXT_PUBLIC_OPENROUTER_API_KEY,
    process.env.NEXT_PUBLIC_OPENROUTER_1_API_KEY,
    process.env.NEXT_PUBLIC_OPENROUTER_2_API_KEY,
  ]);

  const routes: BrowserAiRoute[] = [
    ...googleKeys.map((apiKey, index) => ({
      provider: 'google' as const,
      model: process.env.NEXT_PUBLIC_AI_GEMINI_MODEL || 'gemini-3.1-flash-lite',
      keyId: `google-${index + 1}`,
      apiKey,
      supportsVision: true,
    })),
    ...openRouterKeys.map((apiKey, index) => ({
      provider: 'openrouter' as const,
      model: process.env.NEXT_PUBLIC_AI_OPENROUTER_MODEL || 'google/gemini-2.5-flash',
      keyId: `openrouter-${index + 1}`,
      apiKey,
      supportsVision: true,
    })),
  ];
  return options.requiresVision ? routes.filter((route) => route.supportsVision) : routes;
}

export function resolveBrowserAiModel(route: BrowserAiRoute) {
  if (route.provider === 'google') return createGoogleGenerativeAI({ apiKey: route.apiKey })(route.model);
  return createOpenRouter({
    apiKey: route.apiKey,
    appName: 'StylMe Hackathon',
    appUrl: typeof window === 'undefined' ? undefined : window.location.origin,
  })(route.model);
}
