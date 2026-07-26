export type CatalogSort = "recommended" | "newest" | "price-low" | "price-high" | "rating";

export interface CatalogProduct {
  id: string;
  slug: string;
  title: string;
  brand: string;
  shortDescription: string;
  description: string;
  category: string;
  productType: string;
  genders: string[];
  imageUrl: string | null;
  gallery: string[];
  pricePaise: number;
  mrpPaise: number;
  discountPercent: number;
  rating: number;
  ratingCount: number;
  colour: string;
  colourFamilies: string[];
  sizes: string[];
  tags: string[];
  sellerName: string | null;
  deliveryLabel: string | null;
  swoopStylEligible: boolean;
  metadata: Record<string, string[]>;
  offers: CatalogOffer[];
}

export interface CatalogOffer {
  id: string;
  sellerName: string | null;
  pricePaise: number;
  mrpPaise: number;
  variants: Array<{
    id: string;
    sku: string;
    sizeKey: string;
    colorId: string;
    available: boolean;
    fitRange: Record<string, unknown>;
    ageRange: Record<string, unknown>;
  }>;
}

export interface CatalogPage {
  items: CatalogProduct[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  source: "api" | "demo";
}

export interface CatalogFilters {
  brands: string[];
  categories: string[];
  colours: string[];
  sizes: string[];
  fields: CatalogFilterField[];
  priceBounds: { min: number; max: number };
}

export interface CatalogFilterField {
  key: string;
  label: string;
  group: string;
  control: string;
  storage: string;
  options: Array<{ value: string; label: string; hex?: string }>;
}

export interface HomeCatalog {
  featured: CatalogProduct[];
  trending: CatalogProduct[];
  newArrivals: CatalogProduct[];
  categories: string[];
  source: "api" | "demo";
}

export interface CatalogQuery {
  page?: number;
  pageSize?: number;
  query?: string;
  lexicalQuery?: string;
  brand?: string[];
  category?: string[];
  productType?: string[];
  colour?: string[];
  size?: string[];
  gender?: string[];
  profileGender?: string[];
  profileAge?: number;
  profileHeightCm?: number;
  profileWeightKg?: number;
  metadata?: Record<string, string[]>;
  softMetadata?: Record<string, string[]>;
  minPrice?: number;
  maxPrice?: number;
  minAge?: number;
  maxAge?: number;
  minHeightCm?: number;
  maxHeightCm?: number;
  minWeightKg?: number;
  maxWeightKg?: number;
  sort?: CatalogSort;
  pincode?: string;
  swoopStyl?: boolean;
  intentParsed?: boolean;
  intentSource?: string;
}
