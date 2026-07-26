"use client";

import { generateText, Output } from "ai";
import { z } from "zod";

import { BrowserAiKeyScheduler } from "@/lib/ai/browser-key-scheduler";
import { getProductTaxonomy, invalidateProductTaxonomy } from "@/lib/ai/metadata-taxonomy";
import { getBrowserAiRoutes, resolveBrowserAiModel } from "@/lib/ai/providers";
import { ApiError, completeAppearance, failAppearance, reserveAppearance } from "@/lib/api/client";
import { sha256Hex, type PreparedProductImage } from "@/lib/upload/webp";
import type { AppearanceProposal } from "@/types/auth";

const SYSTEM_PROMPT = `You are StylMe's opt-in visual styling assistant.
Describe only visible fashion-relevant signals using the supplied controlled vocabularies.
You may classify visible skin tone and undertone only to recommend clothing color families. These are approximate styling observations, never identity claims.
Never infer or mention age, gender identity, race, ethnicity, religion, health, disability, body attractiveness, biometrics, identity, or socioeconomic status.
Do not identify a person. Do not diagnose. Do not make body-shaming or sensitive claims.
Photos are transient inputs for this single request. Return structured data only.`;

function controlledEnum(options: string[], name: string) {
  if (!options.length) throw new Error(`Controlled ${name} options are unavailable.`);
  return z.enum(options as [string, ...string[]]);
}

export async function generateAppearanceProposal(input: {
  images: PreparedProductImage[];
  declared: {
    heightCm?: number;
    weightKg?: number;
    styleKeys: string[];
  };
}) {
  if (input.images.length < 1 || input.images.length > 4) throw new Error("Choose between 1 and 4 photos.");
  const imageHashes = input.images.map((image) => image.normalizedSha256);
  let contractAndReservation: Awaited<ReturnType<typeof reserveFreshAppearanceRun>> | undefined;
  let reservationError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      contractAndReservation = await reserveFreshAppearanceRun(imageHashes, input.declared);
      break;
    } catch (error) {
      reservationError = error;
      if (!(error instanceof ApiError && error.status === 409 && attempt === 0)) throw error;
      invalidateProductTaxonomy();
    }
  }
  if (!contractAndReservation) throw reservationError instanceof Error ? reservationError : new Error("Appearance processing could not reserve a live metadata contract.");
  const { taxonomy, reservation } = contractAndReservation;
  if (!reservation.shouldProcess && reservation.status === "completed" && reservation.proposal) {
    return { proposal: reservation.proposal, confidence: 1, warnings: ["Reused the existing result for these exact photo hashes."], reused: true };
  }
  if (!reservation.shouldProcess) throw new Error("These exact photos already have an active or failed appearance run.");

  const style = controlledEnum(taxonomy.options.style, "style");
  const color = controlledEnum(taxonomy.options.color_family, "colour family");
  const fit = controlledEnum(taxonomy.options.fit, "fit");
  const silhouette = controlledEnum(taxonomy.options.silhouette, "silhouette");
  const schema = z.object({
    skinTone: z.enum(["very-light", "light", "medium", "tan", "deep", "unknown"]),
    undertone: z.enum(["cool", "warm", "neutral", "olive", "unknown"]),
    recommendedColorFamilyKeys: z.array(color).max(8),
    styleKeys: z.array(style).max(8),
    fitKeys: z.array(fit).max(6),
    silhouetteKeys: z.array(silhouette).max(6),
    contrastLevel: z.enum(["low", "medium", "high", "unknown"]),
    notes: z.array(z.string().trim().min(1).max(180)).max(8),
    confidence: z.number().min(0).max(1),
    warnings: z.array(z.string().trim().min(1).max(180)).max(8),
  }).strict();
  const prompt = `Suggest reusable fashion filters for the shopper to review.

Shopper-declared, consented context (never reinterpret as identity):
${JSON.stringify(input.declared)}

Controlled values:
- recommendedColorFamilyKeys: ${taxonomy.options.color_family.join(", ")}
- styleKeys: ${taxonomy.options.style.join(", ")}
- fitKeys: ${taxonomy.options.fit.join(", ")}
- silhouetteKeys: ${taxonomy.options.silhouette.join(", ")}

Choose skinTone or undertone as unknown when lighting, makeup, filters, framing, or confidence makes the observation unreliable.
Recommend color families from the controlled list based on the observed tone/undertone, contrast level, and declared styling context. Use an empty recommendation array when uncertain. Notes must be neutral, practical styling observations and must never connect skin tone to race or identity.`;
  const scheduler = new BrowserAiKeyScheduler(getBrowserAiRoutes({ requiresVision: true }));
  try {
    const scheduled = await scheduler.execute(async (route) => {
      const result = await generateText({
        model: resolveBrowserAiModel(route),
        system: SYSTEM_PROMPT,
        output: Output.object({ name: "stylme_appearance_profile", description: "Opt-in controlled styling signals for human review.", schema }),
        messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...input.images.map((image) => ({ type: "image" as const, image: image.aiDataUrl, mediaType: "image/webp" as const }))] }],
        temperature: 0.1,
        maxOutputTokens: 1_800,
        abortSignal: AbortSignal.timeout(90_000),
      });
      return { output: schema.parse(result.output), route };
    });
    const value = scheduled.value.output;
    const actionEntries: Array<[AppearanceProposal["actions"][number]["field"], string[]]> = [
      ["recommended_color_family", value.recommendedColorFamilyKeys], ["style", value.styleKeys], ["fit", value.fitKeys], ["silhouette", value.silhouetteKeys],
    ];
    const proposal: AppearanceProposal = {
      skinTone: value.skinTone,
      undertone: value.undertone,
      recommendedColorFamilyKeys: value.recommendedColorFamilyKeys,
      styleKeys: value.styleKeys,
      fitKeys: value.fitKeys,
      silhouetteKeys: value.silhouetteKeys,
      contrastLevel: value.contrastLevel,
      notes: value.notes,
      actions: actionEntries.filter(([, values]) => values.length).map(([field, values]) => ({ field, action: "reuse", values })),
    };
    await completeAppearance(reservation.runId, {
      provider: scheduled.route.provider,
      model: scheduled.route.model,
      proposal,
      confidence: value.confidence,
      warnings: value.warnings,
    });
    return { proposal, confidence: value.confidence, warnings: value.warnings, reused: false };
  } catch (error) {
    await failAppearance(reservation.runId, error).catch(() => undefined);
    throw error;
  }
}

async function reserveFreshAppearanceRun(
  imageHashes: string[],
  declared: { heightCm?: number; weightKg?: number; styleKeys: string[] },
) {
  const taxonomy = await getProductTaxonomy(undefined, { forceRefresh: true, allowFallback: false });
  const inputHash = await sha256Hex(JSON.stringify({
    contract: "stylme-appearance-v2",
    imageHashes,
    declared,
    metadataSchemaVersion: taxonomy.schemaVersion,
    allowedFiltersHash: taxonomy.allowedFiltersHash,
  }));
  const reservation = await reserveAppearance({
    consent: true,
    inputHash,
    contractVersion: 2,
    metadataSchemaVersion: taxonomy.schemaVersion,
    allowedFiltersHash: taxonomy.allowedFiltersHash,
    imageHashes,
  });
  return { taxonomy, reservation };
}
