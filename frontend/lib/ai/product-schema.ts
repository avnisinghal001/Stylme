import { z } from 'zod';

import type { ProductAiProposal, ProductTaxonomyContract, ProductTaxonomyKey } from '@/types/product-workflow';

const cleanText = (maximum: number) => z.string().trim().min(1).max(maximum);
const hexColour = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

function enumFor(taxonomy: ProductTaxonomyContract, key: ProductTaxonomyKey) {
  const options = taxonomy.options[key];
  if (!options.length) throw new Error(`Controlled taxonomy “${key}” has no active options.`);
  return z.enum(options as [string, ...string[]]);
}

function multiFor(taxonomy: ProductTaxonomyContract, key: ProductTaxonomyKey, fallbackMaximum: number) {
  return z.array(enumFor(taxonomy, key)).max(taxonomy.maxSelections[key] ?? fallbackMaximum);
}

export function createProductAiProposalSchema(taxonomy: ProductTaxonomyContract) {
  const colour = z.object({
    name: enumFor(taxonomy, 'color'),
    hex: hexColour,
    family: enumFor(taxonomy, 'color_family'),
  }).strict();

  return z.object({
    title: cleanText(180),
    shortDescription: cleanText(300),
    description: cleanText(3000),
    category: enumFor(taxonomy, 'category'),
    productType: enumFor(taxonomy, 'product_type'),
    genders: multiFor(taxonomy, 'gender', 3),
    styles: multiFor(taxonomy, 'style', 5),
    themes: multiFor(taxonomy, 'theme', 6),
    occasions: multiFor(taxonomy, 'occasion', 5),
    festivals: multiFor(taxonomy, 'festival', 5),
    culturalThemes: multiFor(taxonomy, 'cultural_theme', 5),
    materials: multiFor(taxonomy, 'material', 5),
    patterns: multiFor(taxonomy, 'pattern', 4),
    fits: multiFor(taxonomy, 'fit', 4),
    silhouettes: multiFor(taxonomy, 'silhouette', 4),
    seasons: multiFor(taxonomy, 'season', 4),
    moods: multiFor(taxonomy, 'mood', 5),
    outfitRoles: multiFor(taxonomy, 'outfit_role', 4),
    generations: multiFor(taxonomy, 'generation', 3),
    trendSignals: multiFor(taxonomy, 'trend_signal', 3),
    colours: z.array(colour).min(1).max(taxonomy.maxSelections.color ?? 8),
    variants: z.array(z.object({
      label: cleanText(80),
      colour,
      mediaOrder: z.number().int().min(0).max(11),
    }).strict()).max(12),
    fitRange: z.object({
      minHeightCm: z.number().int().min(80).max(230),
      maxHeightCm: z.number().int().min(80).max(230),
      minWeightKg: z.number().int().min(20).max(250),
      maxWeightKg: z.number().int().min(20).max(250),
    }).strict().nullable(),
    confidence: z.number().min(0).max(1),
    warnings: z.array(cleanText(240)).max(10),
    missingInfo: z.array(cleanText(160)).max(10),
  }).strict();
}

export function validateProposalSemantics(value: unknown, taxonomy: ProductTaxonomyContract): ProductAiProposal {
  const proposal = createProductAiProposalSchema(taxonomy).parse(value) as ProductAiProposal;
  if (proposal.fitRange) {
    if (proposal.fitRange.minHeightCm > proposal.fitRange.maxHeightCm) throw new Error('AI returned an invalid height range.');
    if (proposal.fitRange.minWeightKg > proposal.fitRange.maxWeightKg) throw new Error('AI returned an invalid weight range.');
  }
  return proposal;
}
