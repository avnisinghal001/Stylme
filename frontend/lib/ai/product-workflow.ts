'use client';

import { generateText, Output } from 'ai';

import { BrowserAiKeyScheduler } from '@/lib/ai/browser-key-scheduler';
import { getProductTaxonomy } from '@/lib/ai/metadata-taxonomy';
import { createProductAiProposalSchema, validateProposalSemantics } from '@/lib/ai/product-schema';
import { completeAiRun, createProductDraft, failAiRun, patchProductDraftFromAi, reserveAiRun, submitProductDraft, updateProductDraft } from '@/lib/ai/python-api';
import { getBrowserAiRoutes, resolveBrowserAiModel } from '@/lib/ai/providers';
import { sha256Hex } from '@/lib/upload/webp';
import {
  type ProductAiResult,
  type ProductDraftPayload,
  type ProcessedProductImage,
  type ProductTaxonomyContract,
  type ProductVariantEditor,
  type ProductWorkflowContext,
} from '@/types/product-workflow';

const SYSTEM_PROMPT = `You are StylMe's fashion catalogue analyst. Return exactly one product proposal.
Only use values from the controlled vocabularies supplied in the user message. Never invent taxonomy values.
Infer only visible or well-supported attributes. Use empty arrays and missingInfo when an attribute cannot be established.
Treat each image as an ordered view or colour variant of the same product. mediaOrder is zero-based.
Do not include URLs, markdown, commentary, or claims unsupported by the images.`;

function buildPrompt(context: ProductWorkflowContext, images: ProcessedProductImage[], taxonomy: ProductTaxonomyContract) {
  const palettes = images.map((image) => ({
    mediaOrder: image.order,
    colours: image.palette.map((colour) => `${colour.hex}/${colour.family}/${Math.round(colour.proportion * 100)}%`),
  }));
  const controlledOptions = Object.entries(taxonomy.options)
    .map(([key, options]) => `- ${key}: ${options.join(', ')}`)
    .join('\n');
  return `Create metadata for one fashion product from the attached ordered images.

Admin context:
${JSON.stringify(context)}

Client-extracted palettes:
${JSON.stringify(palettes)}

Controlled vocabularies:
${controlledOptions}

Map product_type to productType, gender to genders, cultural_theme to culturalThemes, outfit_role to outfitRoles, generation to generations, trend_signal to trendSignals, color to colours[].name, and color_family to colours[].family.
Generation and trend signals describe the product's intended merchandising audience, not the photographed person's identity. Return empty arrays unless product context supports them.
Height/weight fitRange is not a size chart. Return it only when the product type and supplied context support a conservative recommendation; otherwise null.`;
}

export async function productWorkflowFingerprint(context: ProductWorkflowContext, images: ProcessedProductImage[], taxonomy: ProductTaxonomyContract) {
  return sha256Hex(JSON.stringify({
    context: Object.fromEntries(Object.entries(context).map(([key, value]) => [key, value.trim()])),
    images: images.map((image) => ({ order: image.order, sha256: image.normalizedSha256 })),
    schema: 'stylme-product-ai-v2',
    taxonomy: { schemaVersion: taxonomy.schemaVersion, allowedFiltersHash: taxonomy.allowedFiltersHash },
  }));
}

const stringArray = (record: Record<string, unknown>, key: string) => Array.isArray(record[key])
  ? (record[key] as unknown[]).filter((item): item is string => typeof item === 'string')
  : [];

function parseExistingResult(input: {
  value: unknown;
  taxonomy: ProductTaxonomyContract;
  images: ProcessedProductImage[];
  fingerprint: string;
  idempotencyKey: string;
  runId: string;
}): ProductAiResult | null {
  if (!input.value || typeof input.value !== 'object') return null;
  const run = input.value as Record<string, unknown>;
  const raw = run.proposal && typeof run.proposal === 'object' ? run.proposal as Record<string, unknown> : {};
  const metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata as Record<string, unknown> : {};
  const description = typeof raw.description === 'string' ? raw.description : '';
  const rawColours = Array.isArray(raw.colorProposals) ? raw.colorProposals : Array.isArray(raw.color_proposals) ? raw.color_proposals : [];
  const colours = rawColours.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const colour = value as Record<string, unknown>;
    const families = Array.isArray(colour.familyKeys) ? colour.familyKeys : Array.isArray(colour.family_keys) ? colour.family_keys : [];
    if (typeof colour.name !== 'string' || typeof colour.hex !== 'string' || typeof families[0] !== 'string') return [];
    return [{ name: colour.name, hex: colour.hex, family: families[0] }];
  });
  if (!colours.length && input.images[0]?.palette[0]) {
    const palette = input.images[0].palette[0];
    colours.push({
      name: input.taxonomy.options.color.includes(palette.family) ? palette.family : input.taxonomy.options.color[0],
      hex: palette.hex,
      family: input.taxonomy.options.color_family.includes(palette.family) ? palette.family : input.taxonomy.options.color_family[0],
    });
  }
  const proposal = createProductAiProposalSchema(input.taxonomy).safeParse({
    title: raw.title,
    shortDescription: description.slice(0, 300) || 'Restored AI product proposal',
    description,
    category: raw.categoryKey ?? raw.category_key,
    productType: raw.productTypeKey ?? raw.product_type_key,
    genders: Array.isArray(raw.genderKeys) ? raw.genderKeys : Array.isArray(raw.gender_keys) ? raw.gender_keys : [],
    styles: stringArray(metadata, 'style'),
    themes: stringArray(metadata, 'theme'),
    occasions: stringArray(metadata, 'occasion'),
    festivals: stringArray(metadata, 'festival'),
    culturalThemes: stringArray(metadata, 'cultural_theme'),
    materials: stringArray(metadata, 'material'),
    patterns: stringArray(metadata, 'pattern'),
    fits: stringArray(metadata, 'fit'),
    silhouettes: stringArray(metadata, 'silhouette'),
    seasons: stringArray(metadata, 'season'),
    moods: stringArray(metadata, 'mood'),
    outfitRoles: stringArray(metadata, 'outfit_role'),
    generations: stringArray(metadata, 'generation'),
    trendSignals: stringArray(metadata, 'trend_signal'),
    colours,
    variants: [],
    fitRange: null,
    confidence: typeof run.confidence === 'number' ? run.confidence : 0,
    warnings: Array.isArray(run.warnings) ? run.warnings : [],
    missingInfo: ['Restored from the prior idempotent AI run.'],
  });
  if (!proposal.success) return null;
  return {
    idempotencyKey: input.idempotencyKey,
    fingerprint: input.fingerprint,
    runId: input.runId,
    generatedAt: typeof run.completedAt === 'string' ? run.completedAt : new Date().toISOString(),
    taxonomy: {
      schemaVersion: input.taxonomy.schemaVersion,
      allowedFiltersHash: input.taxonomy.allowedFiltersHash,
      source: input.taxonomy.source,
    },
    proposal: proposal.data,
    telemetry: {
      provider: run.provider === 'openrouter' ? 'openrouter' : 'google',
      model: typeof run.model === 'string' ? run.model : 'stored-result',
      keyId: 'stored-result',
      latencyMs: 0,
      attempts: 0,
      inputTokens: null,
      outputTokens: null,
    },
  };
}

export async function generateOneShotProductProposal(input: {
  context: ProductWorkflowContext;
  images: ProcessedProductImage[];
  draftId: string;
  contractVersion: number;
  accessToken?: string;
}): Promise<ProductAiResult> {
  if (!input.images.length) throw new Error('Upload at least one processed image first.');
  const images = [...input.images].sort((left, right) => left.order - right.order).slice(0, 6);
  const taxonomy = await getProductTaxonomy(input.accessToken, { forceRefresh: true, allowFallback: false });
  const fingerprint = await productWorkflowFingerprint(input.context, images, taxonomy);
  const idempotencyKey = `product-ai:${fingerprint}`;
  const reservation = await reserveAiRun({
    draftId: input.draftId,
    inputHash: fingerprint,
    contractVersion: input.contractVersion,
    metadataSchemaVersion: taxonomy.schemaVersion,
    allowedFiltersHash: taxonomy.allowedFiltersHash,
  }, input.accessToken);

  if (!reservation.shouldProcess && reservation.status === 'completed') {
    const existing = parseExistingResult({
      value: reservation.result,
      taxonomy,
      images,
      fingerprint,
      idempotencyKey,
      runId: reservation.runId,
    });
    if (existing) return existing;
    throw new Error('This AI run completed previously, but its stored result is unavailable.');
  }
  if (!reservation.shouldProcess && (reservation.status === 'processing' || reservation.status === 'reserved')) {
    throw new Error('This exact product is already being processed. Wait for the existing run.');
  }
  if (!reservation.shouldProcess && reservation.status === 'failed') throw new Error('This exact AI run failed previously. Change an input before retrying.');

  const scheduler = new BrowserAiKeyScheduler(getBrowserAiRoutes({ requiresVision: true }));
  const proposalSchema = createProductAiProposalSchema(taxonomy);
  const startedAt = Date.now();
  try {
    const scheduled = await scheduler.execute(async (route) => {
      const generated = await generateText({
        model: resolveBrowserAiModel(route),
        system: SYSTEM_PROMPT,
        output: Output.object({
          name: 'stylme_product_proposal',
          description: 'A controlled StylMe product metadata proposal for human review.',
          schema: proposalSchema,
        }),
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt(input.context, images, taxonomy) },
            ...images.map((image) => ({
              type: 'image' as const,
              image: image.aiDataUrl,
              mediaType: 'image/webp',
            })),
          ],
        }],
        temperature: 0.2,
        maxOutputTokens: 4_000,
        abortSignal: AbortSignal.timeout(90_000),
      });
      return { proposal: validateProposalSemantics(generated.output, taxonomy), usage: generated.usage };
    });

    const result: ProductAiResult = {
      idempotencyKey,
      fingerprint,
      runId: reservation.runId,
      generatedAt: new Date().toISOString(),
      taxonomy: {
        schemaVersion: taxonomy.schemaVersion,
        allowedFiltersHash: taxonomy.allowedFiltersHash,
        source: taxonomy.source,
      },
      proposal: scheduled.value.proposal,
      telemetry: {
        provider: scheduled.route.provider,
        model: scheduled.route.model,
        keyId: scheduled.route.keyId,
        latencyMs: Date.now() - startedAt,
        attempts: scheduled.attempts,
        inputTokens: scheduled.value.usage.inputTokens ?? null,
        outputTokens: scheduled.value.usage.outputTokens ?? null,
      },
    };
    await completeAiRun(reservation.runId, result, input.accessToken);
    return result;
  } catch (error) {
    await failAiRun(reservation.runId, error, { latencyMs: Date.now() - startedAt }, input.accessToken).catch(() => undefined);
    throw error;
  }
}

export function buildProductDraftPayload(input: {
  context: ProductWorkflowContext;
  images: ProcessedProductImage[];
  sellerId?: string;
  brandId: string;
  categoryKey: string;
  productTypeKey: string;
  genderKeys: string[];
  mrpPaise: number;
  salePricePaise: number;
  variants: ProductVariantEditor[];
}): ProductDraftPayload {
  return {
    ...(input.sellerId ? { sellerId: input.sellerId } : {}),
    brandId: input.brandId,
    title: input.context.title.trim(),
    description: input.context.description.trim(),
    categoryKey: input.categoryKey,
    productTypeKey: input.productTypeKey,
    genderKeys: input.genderKeys,
    metadata: {},
    media: [...input.images]
      .sort((left, right) => left.order - right.order)
      .map((image) => ({
        id: image.asset.id ?? image.clientId,
        type: 'image' as const,
        provider: 'imgbb',
        providerId: image.asset.id,
        url: image.asset.url,
        displayUrl: image.asset.displayUrl,
        alt: `${input.context.title.trim()} image ${image.order + 1}`,
        position: image.order,
        width: image.asset.width,
        height: image.asset.height,
        size: image.asset.size,
        mime: 'image/webp',
        sha256: image.normalizedSha256,
      })),
    offer: {
      currency: 'INR',
      mrpPaise: input.mrpPaise,
      salePricePaise: input.salePricePaise,
      offerDetails: {},
      variants: input.variants.map((variant) => ({
        id: variant.clientId,
        sku: variant.sku,
        sizeKey: variant.sizeKey,
        colorId: variant.colorId,
        measurements: {},
        fitRange: {
          applicable: variant.fitApplicable,
          minHeightCm: variant.fitApplicable ? variant.minHeightCm : null,
          maxHeightCm: variant.fitApplicable ? variant.maxHeightCm : null,
          minWeightKg: variant.fitApplicable ? variant.minWeightKg : null,
          maxWeightKg: variant.fitApplicable ? variant.maxWeightKg : null,
          source: 'seller_confirmed',
          confidence: 1,
        },
        ageRange: {
          applicable: variant.ageApplicable,
          minAge: variant.ageApplicable ? variant.minAge : null,
          maxAge: variant.ageApplicable ? variant.maxAge : null,
          source: 'seller_confirmed',
          confidence: 1,
        },
        attributes: {},
      })),
      inventory: input.variants.map((variant) => ({
        variantId: variant.clientId,
        locationId: variant.locationId,
        availableQty: variant.availableQty,
        active: true,
      })),
      metadata: {},
    },
  };
}

export async function saveInitialProductDraft(input: Parameters<typeof buildProductDraftPayload>[0] & { accessToken?: string; draftId?: string | null }) {
  const payload = buildProductDraftPayload(input);
  return input.draftId
    ? updateProductDraft(input.draftId, payload, input.accessToken)
    : createProductDraft(payload, input.accessToken);
}

export async function submitReviewedProductWorkflow(input: {
  draftId: string;
  ai: ProductAiResult;
  accessToken?: string;
}) {
  await patchProductDraftFromAi(input.draftId, input.ai, input.accessToken);
  return submitProductDraft(input.draftId, input.accessToken);
}
