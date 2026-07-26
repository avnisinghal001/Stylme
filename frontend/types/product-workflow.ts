export const PRODUCT_STYLES = [
  'athleisure',
  'bohemian',
  'casual',
  'classic',
  'ethnic',
  'formal',
  'gen-z',
  'indo-western',
  'minimal',
  'partywear',
  'preppy',
  'romantic',
  'streetwear',
  'utility',
  'vintage',
] as const;

export const PRODUCT_THEMES = [
  'college',
  'date-night',
  'diwali',
  'eid',
  'everyday',
  'festive',
  'holi',
  'lounge',
  'monsoon',
  'navratri',
  'party',
  'religious',
  'summer',
  'travel',
  'wedding',
  'winter',
  'workwear',
] as const;

export const PRODUCT_OCCASIONS = [
  'casual',
  'festive',
  'formal',
  'party',
  'religious',
  'sports',
  'travel',
  'wedding',
  'work',
] as const;

export const PRODUCT_GENDERS = [
  'boys',
  'girls',
  'men',
  'unisex',
  'women',
] as const;

export const COLOUR_FAMILIES = [
  'black',
  'blue',
  'brown',
  'gray',
  'green',
  'orange',
  'pink',
  'purple',
  'red',
  'teal',
  'white',
  'yellow',
] as const;

export const PRODUCT_CATEGORIES = ['accessories', 'apparel', 'beauty', 'footwear', 'home-living'] as const;
export const PRODUCT_ARTICLE_TYPES = [
  'accessory', 'activewear', 'bag', 'dress', 'footwear', 'jacket', 'jeans', 'jewellery',
  'kurta', 'kurta-set', 'lehenga', 'lingerie', 'other', 'saree', 'shirt', 'shorts',
  'skirt', 'sleepwear', 'sweater', 'sweatshirt', 't-shirt', 'trousers', 'watch',
] as const;
export const PRODUCT_TAGS = [
  'breathable', 'comfortable', 'embroidered', 'hand-crafted', 'layering', 'lightweight',
  'modest', 'oversized', 'premium', 'printed', 'relaxed-fit', 'slim-fit', 'solid',
  'statement', 'stretch', 'sustainable', 'versatile',
] as const;
export const PRODUCT_MATERIALS = [
  'blended', 'cotton', 'denim', 'leather', 'linen', 'nylon', 'polyester', 'rayon',
  'silk', 'synthetic', 'velvet', 'viscose', 'wool',
] as const;
export const PRODUCT_PATTERNS = [
  'abstract', 'animal', 'checked', 'colourblocked', 'embroidered', 'floral', 'geometric',
  'graphic', 'printed', 'solid', 'striped', 'textured',
] as const;
export const PRODUCT_FITS = ['bodycon', 'flared', 'loose', 'oversized', 'regular', 'relaxed', 'slim', 'straight'] as const;
export const PRODUCT_SILHOUETTES = ['a-line', 'bodycon', 'boxy', 'draped', 'fit-and-flare', 'layered', 'straight', 'structured'] as const;
export const PRODUCT_SEASONS = ['all-season', 'autumn', 'monsoon', 'spring', 'summer', 'winter'] as const;

export type ProductStyle = (typeof PRODUCT_STYLES)[number];
export type ProductTheme = (typeof PRODUCT_THEMES)[number];
export type ProductOccasion = (typeof PRODUCT_OCCASIONS)[number];
export type ProductGender = (typeof PRODUCT_GENDERS)[number];
export type ColourFamily = (typeof COLOUR_FAMILIES)[number];
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type ProductArticleType = (typeof PRODUCT_ARTICLE_TYPES)[number];
export type ProductTag = (typeof PRODUCT_TAGS)[number];
export type ProductMaterial = (typeof PRODUCT_MATERIALS)[number];
export type ProductPattern = (typeof PRODUCT_PATTERNS)[number];
export type ProductFit = (typeof PRODUCT_FITS)[number];
export type ProductSilhouette = (typeof PRODUCT_SILHOUETTES)[number];
export type ProductSeason = (typeof PRODUCT_SEASONS)[number];

export const PRODUCT_TAXONOMY_KEYS = [
  'category', 'product_type', 'gender', 'style', 'theme', 'occasion', 'festival',
  'cultural_theme', 'material', 'pattern', 'fit', 'silhouette', 'season', 'mood',
  'outfit_role', 'color', 'color_family', 'size',
  'generation', 'trend_signal',
] as const;
export type ProductTaxonomyKey = (typeof PRODUCT_TAXONOMY_KEYS)[number];

export interface ProductTaxonomyContract {
  schemaVersion: number;
  allowedFiltersHash: string;
  source: 'mongo' | 'fallback';
  options: Record<ProductTaxonomyKey, string[]>;
  maxSelections: Partial<Record<ProductTaxonomyKey, number>>;
}

export interface PaletteColour {
  hex: string;
  family: ColourFamily;
  proportion: number;
}

export interface ImgBBAsset {
  provider: 'imgbb';
  id: string | null;
  url: string;
  displayUrl: string;
  deleteUrl: string | null;
  width: number;
  height: number;
  size: number;
  mime: 'image/webp';
}

/**
 * The ordered browser result. `aiDataUrl` is intentionally transient and must
 * never be included in the product-draft payload sent to Python/Mongo.
 */
export interface ProcessedProductImage {
  clientId: string;
  order: number;
  isCover: boolean;
  originalName: string;
  originalMime: string;
  originalBytes: number;
  originalSha256: string;
  normalizedSha256: string;
  width: number;
  height: number;
  normalizedBytes: number;
  palette: PaletteColour[];
  aiDataUrl: string;
  aiWidth: number;
  aiHeight: number;
  aiBytes: number;
  asset: ImgBBAsset;
}

export interface ProductWorkflowContext {
  title: string;
  brand: string;
  description: string;
  categoryHint: string;
}

export interface ProductAiColour {
  name: string;
  hex: string;
  family: string;
}

export interface ProductAiFitRange {
  minHeightCm: number;
  maxHeightCm: number;
  minWeightKg: number;
  maxWeightKg: number;
}

export interface ProductAiVariant {
  label: string;
  colour: ProductAiColour;
  mediaOrder: number;
}

export interface ProductAiProposal {
  title: string;
  shortDescription: string;
  description: string;
  category: string;
  productType: string;
  genders: string[];
  styles: string[];
  themes: string[];
  occasions: string[];
  festivals: string[];
  culturalThemes: string[];
  materials: string[];
  patterns: string[];
  fits: string[];
  silhouettes: string[];
  seasons: string[];
  moods: string[];
  outfitRoles: string[];
  generations: string[];
  trendSignals: string[];
  colours: ProductAiColour[];
  variants: ProductAiVariant[];
  fitRange: ProductAiFitRange | null;
  confidence: number;
  warnings: string[];
  missingInfo: string[];
}

export interface AiRunTelemetry {
  provider: 'google' | 'openrouter';
  model: string;
  keyId: string;
  latencyMs: number;
  attempts: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ProductAiResult {
  idempotencyKey: string;
  fingerprint: string;
  runId: string;
  generatedAt: string;
  taxonomy: Pick<ProductTaxonomyContract, 'schemaVersion' | 'allowedFiltersHash' | 'source'>;
  proposal: ProductAiProposal;
  telemetry: AiRunTelemetry;
}

export interface ProductDraftMedia {
  id: string;
  type: 'image';
  provider: 'imgbb';
  providerId: string | null;
  url: string;
  displayUrl: string;
  alt: string;
  position: number;
  width: number;
  height: number;
  size: number;
  mime: 'image/webp';
  sha256: string;
}

export interface ProductDraftVariantInput {
  id: string;
  sku: string;
  sizeKey: string;
  colorId: string;
  measurements: Record<string, number | string>;
  fitRange: {
    applicable: boolean;
    minHeightCm: number | null;
    maxHeightCm: number | null;
    minWeightKg: number | null;
    maxWeightKg: number | null;
    source: 'seller_confirmed' | 'ai_proposed';
    confidence: number;
  };
  ageRange: {
    applicable: boolean;
    minAge: number | null;
    maxAge: number | null;
    source: 'seller_confirmed';
    confidence: number;
  };
  attributes: Record<string, string>;
}

export interface ProductDraftInventoryInput {
  variantId: string;
  locationId: string;
  availableQty: number;
  active: boolean;
}

export interface ProductDraftPayload {
  sellerId?: string;
  brandId: string;
  title: string;
  description: string;
  categoryKey: string;
  productTypeKey: string;
  genderKeys: string[];
  metadata: Record<string, string[]>;
  media: ProductDraftMedia[];
  offer: {
    currency: 'INR';
    mrpPaise: number;
    salePricePaise: number;
    offerDetails: Record<string, string>;
    variants: ProductDraftVariantInput[];
    inventory: ProductDraftInventoryInput[];
    metadata: Record<string, string>;
  };
}

export interface ProductDraftResponse {
  draftId: string;
  status: string;
}

export interface DraftOption {
  id: string;
  name: string;
  sellerId?: string;
  brandIds?: string[];
  hex?: string;
  familyKeys?: string[];
  pincode?: string;
}

export interface ProductDraftOptions {
  contractVersion: number;
  sellers: DraftOption[];
  brands: DraftOption[];
  locations: DraftOption[];
  colors: DraftOption[];
  sizes: string[];
  taxonomy?: ProductTaxonomyContract;
}

export interface ProductVariantEditor {
  clientId: string;
  sku: string;
  sizeKey: string;
  colorId: string;
  locationId: string;
  availableQty: number;
  fitApplicable: boolean;
  minHeightCm: number | null;
  maxHeightCm: number | null;
  minWeightKg: number | null;
  maxWeightKg: number | null;
  ageApplicable: boolean;
  minAge: number | null;
  maxAge: number | null;
}
