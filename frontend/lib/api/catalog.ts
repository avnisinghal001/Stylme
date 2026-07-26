import type {
  CatalogFilters,
  CatalogPage,
  CatalogProduct,
  CatalogQuery,
  CatalogSort,
  HomeCatalog,
} from "@/types/catalog";
import { getPublicApiBaseUrl } from "@/lib/api/public-endpoints";

type UnknownRecord = Record<string, unknown>;

// A cold Vercel Python function may need to establish its first Atlas pool.
// Keep browser requests bounded while allowing enough time for that first pool.
const REQUEST_TIMEOUT_MS = 30_000;

const DEMO_PRODUCTS: CatalogProduct[] = [
  demoProduct({
    id: "demo-pink-dress",
    title: "Satin Cowl-Neck Midi Dress",
    brand: "DressBerry",
    category: "Women",
    productType: "Dresses",
    price: 149900,
    mrp: 299900,
    rating: 4.6,
    count: 842,
    colour: "Rose Pink",
    image: "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=900&q=85",
    description: "A fluid satin midi with a softly draped neckline, made for celebrations that turn into late-night plans.",
    tags: ["party", "satin", "gen-z"],
    sizes: ["XS", "S", "M", "L", "XL"],
  }),
  demoProduct({
    id: "demo-linen-shirt",
    title: "Relaxed Linen Resort Shirt",
    brand: "Roadster",
    category: "Men",
    productType: "Shirts",
    price: 99900,
    mrp: 199900,
    rating: 4.4,
    count: 1294,
    colour: "Ivory",
    image: "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=900&q=85",
    description: "Breathable linen texture, an easy relaxed fit and a clean resort collar for warm days.",
    tags: ["minimal", "summer", "classic"],
    sizes: ["S", "M", "L", "XL", "XXL"],
  }),
  demoProduct({
    id: "demo-denim-jacket",
    title: "Cropped Vintage Denim Jacket",
    brand: "Mast & Harbour",
    category: "Women",
    productType: "Jackets",
    price: 179900,
    mrp: 329900,
    rating: 4.7,
    count: 638,
    colour: "Washed Blue",
    image: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=85",
    description: "A vintage-wash denim layer with a cropped proportion that works across dresses and relaxed separates.",
    tags: ["streetwear", "denim", "layering"],
    sizes: ["XS", "S", "M", "L"],
  }),
  demoProduct({
    id: "demo-kurta-set",
    title: "Embroidered Festive Kurta Set",
    brand: "Anouk",
    category: "Women",
    productType: "Kurta Sets",
    price: 219900,
    mrp: 449900,
    rating: 4.8,
    count: 2143,
    colour: "Maroon",
    image: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=900&q=85",
    description: "Fine tonal embroidery and an effortless straight silhouette for festive days and family celebrations.",
    tags: ["festive", "ethnic", "embroidered"],
    sizes: ["S", "M", "L", "XL", "XXL"],
  }),
  demoProduct({
    id: "demo-sneakers",
    title: "Everyday Colourblock Sneakers",
    brand: "HRX",
    category: "Footwear",
    productType: "Sneakers",
    price: 189900,
    mrp: 399900,
    rating: 4.5,
    count: 3071,
    colour: "White & Pink",
    image: "https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=900&q=85",
    description: "Cushioned everyday sneakers with a lightweight sole and a soft colour-blocked finish.",
    tags: ["casual", "athleisure", "everyday"],
    sizes: ["UK 4", "UK 5", "UK 6", "UK 7", "UK 8"],
  }),
  demoProduct({
    id: "demo-coord",
    title: "Printed Relaxed Co-ord Set",
    brand: "SASSAFRAS",
    category: "Women",
    productType: "Co-ords",
    price: 129900,
    mrp: 259900,
    rating: 4.3,
    count: 516,
    colour: "Coral",
    image: "https://images.unsplash.com/photo-1551488831-00ddcb6c6bd3?auto=format&fit=crop&w=900&q=85",
    description: "An easy matching set in a playful print, designed to look styled with almost no effort.",
    tags: ["vacation", "printed", "relaxed"],
    sizes: ["XS", "S", "M", "L", "XL"],
  }),
  demoProduct({
    id: "demo-blazer",
    title: "Tailored Single-Breasted Blazer",
    brand: "MANGO",
    category: "Women",
    productType: "Blazers",
    price: 349900,
    mrp: 549900,
    rating: 4.6,
    count: 427,
    colour: "Black",
    image: "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=900&q=85",
    description: "A sharply tailored, single-breasted layer that moves cleanly from work hours to dinner.",
    tags: ["workwear", "tailored", "classic"],
    sizes: ["XS", "S", "M", "L", "XL"],
  }),
  demoProduct({
    id: "demo-hoodie",
    title: "Oversized Graphic Hoodie",
    brand: "WROGN",
    category: "Men",
    productType: "Sweatshirts",
    price: 159900,
    mrp: 299900,
    rating: 4.4,
    count: 1876,
    colour: "Charcoal",
    image: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=900&q=85",
    description: "A heavyweight cotton-blend hoodie with an oversized cut and a confident graphic finish.",
    tags: ["streetwear", "oversized", "winter"],
    sizes: ["S", "M", "L", "XL", "XXL"],
  }),
];

function demoProduct(input: {
  id: string;
  title: string;
  brand: string;
  category: string;
  productType: string;
  price: number;
  mrp: number;
  rating: number;
  count: number;
  colour: string;
  image: string;
  description: string;
  tags: string[];
  sizes: string[];
}): CatalogProduct {
  return {
    id: input.id,
    slug: input.id,
    title: input.title,
    brand: input.brand,
    shortDescription: input.description,
    description: input.description,
    category: input.category,
    productType: input.productType,
    genders: input.category === "Men" ? ["men"] : input.category === "Women" ? ["women"] : ["unisex"],
    imageUrl: input.image,
    gallery: [input.image],
    pricePaise: input.price,
    mrpPaise: input.mrp,
    discountPercent: Math.round(((input.mrp - input.price) / input.mrp) * 100),
    rating: input.rating,
    ratingCount: input.count,
    colour: input.colour,
    colourFamilies: [input.colour.split(" ").at(-1)?.toLowerCase() ?? input.colour.toLowerCase()],
    sizes: input.sizes,
    tags: input.tags,
    sellerName: "StylMe Select",
    deliveryLabel: "SwoopStyl · eligible for 1-day delivery",
    swoopStylEligible: true,
    metadata: { style: input.tags, occasion: ["everyday"] },
    offers: [{ id: `offer-${input.id}`, sellerName: "StylMe Select", pricePaise: input.price, mrpPaise: input.mrp, variants: input.sizes.map((size) => ({ id: `${input.id}-${size}`, sku: `${input.id}-${size}`, sizeKey: size, colorId: input.colour, available: true, fitRange: {}, ageRange: {} })) }],
  };
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function imageValue(...values: unknown[]): string {
  const value = stringValue(...values);
  if (!value) return "";
  const normalized = value.toLowerCase();
  if (["-", "null", "undefined", "n/a", "na", "none"].includes(normalized)) return "";
  if (/^(https?:\/\/|\/|data:image\/|blob:)/i.test(value)) return value;
  return "";
}

function numberValue(...values: unknown[]): number {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter(Boolean);
}

function optionLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const option = record(item);
      return stringValue(option.label, option.name, option.key, item);
    })
    .filter(Boolean);
}

function optionItems(value: unknown): Array<{ value: string; label: string; hex?: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const option = record(item);
    const raw = stringValue(option.key, option.value, option.slug, option.name, item);
    return {
      value: raw,
      label: stringValue(option.label, option.name, raw),
      ...(stringValue(option.hex) ? { hex: stringValue(option.hex) } : {}),
    };
  }).filter((item) => item.value);
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function metadataValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => stringValue(item)).filter(Boolean);
  const single = stringValue(value);
  return single ? [single] : [];
}

function normalizeMetadata(value: unknown): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(record(value))
      .map(([key, item]) => [key, metadataValue(item)] as const)
      .filter(([, items]) => items.length > 0),
  );
}

function normalizeMedia(raw: UnknownRecord): string[] {
  const media = Array.isArray(raw.media) ? raw.media : [];
  const urls = media
    .map((item) => imageValue(record(item).url, record(item).display_url, item))
    .filter(Boolean);
  const legacy = imageValue(raw.img, raw.image, raw.imageUrl, raw.cover_image_url, raw.coverImageUrl);
  return [...new Set([legacy, ...urls].filter(Boolean))];
}

function normalizeProduct(value: unknown): CatalogProduct | null {
  const raw = record(value);
  const title = stringValue(raw.title, raw.name);
  if (!title) return null;

  const offer = record(
    raw.offer ??
      raw.seller_offer ??
      (Array.isArray(raw.offers) ? raw.offers[0] : undefined),
  );
  const rating = record(raw.rating);
  const media = normalizeMedia(raw);
  const metadata = normalizeMetadata(raw.metadata);
  const id = stringValue(raw._id, raw.id, raw.p_id, raw.source_product_id, raw.slug, title);
  const pricePaise = numberValue(
    offer.salePricePaise,
    offer.sale_price_paise,
    raw.sale_price_paise,
    raw.pricePaise,
    numberValue(raw.price) > 0 ? numberValue(raw.price) * 100 : 0,
  );
  const mrpPaise = numberValue(offer.mrpPaise, offer.mrp_paise, raw.mrp_paise, raw.mrpPaise, pricePaise);
  const rawSizes = stringArray(
    offer.availableSizeKeys ?? offer.available_size_keys ?? raw.available_size_keys ?? raw.availableSizeKeys ?? raw.sizes,
  );
  const variants = Array.isArray(offer.variants) ? offer.variants.map(record) : [];
  const sizes = rawSizes.length
    ? rawSizes
    : [...new Set(variants.map((variant) => stringValue(variant.sizeKey, variant.size_key)).filter(Boolean))];
  const colours = stringArray(
    offer.availableColorFamilyKeys ??
      offer.available_color_family_keys ??
      raw.available_color_family_keys ??
      raw.availableColorFamilyKeys ??
      raw.colourFamilies ??
      raw.colorFamilies,
  );
  const category = titleCase(stringValue(raw.category, raw.categoryKey, raw.category_key, "Fashion"));
  const productType = titleCase(
    stringValue(raw.productType, raw.product_type, raw.productTypeKey, raw.product_type_key, category),
  );
  const tags = [...new Set(Object.values(metadata).flat())].slice(0, 12);
  const normalizedOffers = (Array.isArray(raw.offers) ? raw.offers : []).map((value) => {
    const source = record(value);
    const inventory = Array.isArray(source.inventory) ? source.inventory.map(record) : [];
    const availableVariants = new Set(inventory.filter((item) => item.available === true).map((item) => stringValue(item.variantId, item.variant_id)));
    return {
      id: stringValue(source.id, source._id),
      sellerName: stringValue(record(source.seller).displayName, record(source.seller).name) || null,
      pricePaise: numberValue(source.salePricePaise, source.sale_price_paise),
      mrpPaise: numberValue(source.mrpPaise, source.mrp_paise),
      variants: (Array.isArray(source.variants) ? source.variants : []).map((value) => {
        const variant = record(value);
        const variantId = stringValue(variant.id);
        return {
          id: variantId,
          sku: stringValue(variant.sku),
          sizeKey: stringValue(variant.sizeKey, variant.size_key),
          colorId: stringValue(variant.colorId, variant.color_id),
          available: availableVariants.has(variantId),
          fitRange: record(variant.fitRange ?? variant.fit_range),
          ageRange: record(variant.ageRange ?? variant.age_range),
        };
      }),
    };
  }).filter((item) => item.id);

  return {
    id,
    slug: stringValue(raw.slug, raw._id, raw.id, raw.p_id, raw.source_product_id, id),
    title,
    brand: stringValue(record(raw.brand).name, raw.brand_name, raw.brand, "StylMe"),
    shortDescription: stringValue(raw.short_description, raw.shortDescription, raw.description).slice(0, 180),
    description: stringValue(raw.description, raw.short_description, "A curated fashion find from StylMe."),
    category,
    productType,
    genders: stringArray(raw.genderKeys ?? raw.gender_keys ?? raw.genders),
    imageUrl: imageValue(raw.cover_image_url, raw.coverImageUrl, media[0]) || null,
    gallery: media,
    pricePaise,
    mrpPaise: Math.max(mrpPaise, pricePaise),
    discountPercent: numberValue(
      offer.discount_percent,
      offer.discountPercent,
      raw.discount_percent,
      mrpPaise > pricePaise && mrpPaise > 0 ? Math.round(((mrpPaise - pricePaise) / mrpPaise) * 100) : 0,
    ),
    rating: numberValue(rating.average, raw.avg_rating, raw.ratingAverage),
    ratingCount: numberValue(rating.count, raw.ratingCount, raw.rating_count),
    colour: titleCase(stringValue(raw.colour, raw.color, colours[0], "Multi")),
    colourFamilies: colours,
    sizes,
    tags,
    sellerName: stringValue(record(raw.seller).displayName, record(raw.seller).name, raw.sellerName, raw.seller_name) || null,
    deliveryLabel: stringValue(raw.deliveryLabel, raw.delivery_label, offer.deliveryLabel, offer.delivery_label) || null,
    swoopStylEligible: Boolean(
      raw.swoopStylEligible ?? raw.swoopstyl_enabled ?? offer.swoopStylEligible ?? offer.swoopstyl_enabled ?? false,
    ),
    metadata,
    offers: normalizedOffers,
  };
}

async function apiJson(path: string): Promise<unknown | null> {
  try {
    const response = await fetch(`${getPublicApiBaseUrl()}${path}`, {
      headers: { accept: "application/json" },
      cache: "default",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function sortDemo(items: CatalogProduct[], sort: CatalogSort = "recommended") {
  return [...items].sort((a, b) => {
    if (sort === "price-low") return a.pricePaise - b.pricePaise;
    if (sort === "price-high") return b.pricePaise - a.pricePaise;
    if (sort === "rating") return b.rating - a.rating;
    if (sort === "newest") return b.id.localeCompare(a.id);
    return b.ratingCount - a.ratingCount;
  });
}

function demoCatalog(query: CatalogQuery): CatalogPage {
  const search = query.query?.trim().toLowerCase();
  let items = DEMO_PRODUCTS.filter((product) => {
    const haystack = [
      product.title,
      product.brand,
      product.category,
      product.productType,
      product.colour,
      ...product.tags,
    ].join(" ").toLowerCase();
    return (
      (!search || haystack.includes(search)) &&
      (!query.brand?.length || query.brand.includes(product.brand)) &&
      (!query.category?.length || query.category.includes(product.category)) &&
      (!query.colour?.length || query.colour.some((value) => product.colour.toLowerCase().includes(value.toLowerCase()))) &&
      (!query.size?.length || query.size.some((value) => product.sizes.includes(value))) &&
      (query.minPrice === undefined || product.pricePaise >= query.minPrice * 100) &&
      (query.maxPrice === undefined || product.pricePaise <= query.maxPrice * 100)
    );
  });
  items = sortDemo(items, query.sort);
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.max(1, query.pageSize ?? 12);
  const total = items.length;
  items = items.slice((page - 1) * pageSize, page * pageSize);
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), source: "demo" };
}

export async function getCatalogPage(query: CatalogQuery = {}): Promise<CatalogPage> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.max(1, query.pageSize ?? 12);
  const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
  // A compiled intent deliberately omits lexical search when controlled
  // filters fully explain the phrase. Falling back to the original sentence
  // here would incorrectly require every filler word to match Mongo text.
  if (query.intentParsed) {
    if (query.lexicalQuery) params.set("search", query.lexicalQuery);
  } else if (query.query) {
    params.set("search", query.query);
  }
  query.brand?.forEach((value) => params.append("brand", value));
  query.category?.forEach((value) => params.append("category", value));
  query.productType?.forEach((value) => params.append("productType", value));
  query.colour?.forEach((value) => params.append("colour", value));
  query.size?.forEach((value) => params.append("size", value));
  query.gender?.forEach((value) => params.append("gender", value));
  Object.entries(query.metadata ?? {}).forEach(([key, values]) => {
    values.forEach((value) => params.append("meta", `${key}:${value}`));
  });
  if (query.minPrice !== undefined) params.set("min_price", String(query.minPrice));
  if (query.maxPrice !== undefined) params.set("max_price", String(query.maxPrice));
  if (query.minAge !== undefined) params.set("minAge", String(query.minAge));
  if (query.maxAge !== undefined) params.set("maxAge", String(query.maxAge));
  if (query.minHeightCm !== undefined) params.set("minHeightCm", String(query.minHeightCm));
  if (query.maxHeightCm !== undefined) params.set("maxHeightCm", String(query.maxHeightCm));
  if (query.minWeightKg !== undefined) params.set("minWeightKg", String(query.minWeightKg));
  if (query.maxWeightKg !== undefined) params.set("maxWeightKg", String(query.maxWeightKg));
  if (query.swoopStyl) params.set("swoopstyl", "true");
  if (query.pincode) params.set("pincode", query.pincode);
  const sortMap: Record<CatalogSort, [string, string]> = {
    recommended: ["relevance", "desc"],
    newest: ["createdAt", "desc"],
    "price-low": ["price", "asc"],
    "price-high": ["price", "desc"],
    rating: ["avg_rating", "desc"],
  };
  const [sortBy, order] = sortMap[query.sort ?? "recommended"];
  params.set("sort_by", sortBy);
  params.set("order", order);

  const response = await apiJson(`/products?${params.toString()}`);
  if (response === null) {
    if (query.swoopStyl) {
      return { items: [], total: 0, page, pageSize, totalPages: 1, source: "api" };
    }
    return demoCatalog(query);
  }
  const payload = record(response);
  const remoteItems = (Array.isArray(payload.items) ? payload.items : [])
    .map(normalizeProduct)
    .filter((item): item is CatalogProduct => item !== null);
  if (!Array.isArray(payload.items)) return demoCatalog(query);
  const total = numberValue(payload.total, remoteItems.length);
  return {
    items: remoteItems,
    total,
    page: numberValue(payload.page, page),
    pageSize: numberValue(payload.pageSize, payload.limit, pageSize),
    totalPages: Math.max(1, numberValue(payload.totalPages, Math.ceil(total / pageSize))),
    source: "api",
  };
}

export async function getCatalogProduct(slug: string): Promise<CatalogProduct | null> {
  const remote = normalizeProduct(await apiJson(`/products/${encodeURIComponent(slug)}`));
  if (remote) return remote;
  return DEMO_PRODUCTS.find((product) => product.slug === slug || product.id === slug) ?? null;
}

export async function getRelatedProducts(product: CatalogProduct): Promise<CatalogProduct[]> {
  const payload = await apiJson(`/products/${encodeURIComponent(product.id)}/related`);
  const payloadRecord = record(payload);
  const remote = (Array.isArray(payload) ? payload : Array.isArray(payloadRecord.items) ? payloadRecord.items : [])
    .map(normalizeProduct)
    .filter((item): item is CatalogProduct => item !== null);
  if (remote.length) return remote.slice(0, 4);
  return DEMO_PRODUCTS.filter(
    (item) => item.id !== product.id && (item.category === product.category || item.brand === product.brand),
  ).slice(0, 4);
}

export async function getCatalogFilters(): Promise<CatalogFilters> {
  const payload = record(await apiJson("/filters"));
  const fields = Array.isArray(payload.fields) ? payload.fields.map(record) : [];
  const valuesFor = (...keys: string[]) => {
    const field = fields.find((item) => keys.includes(stringValue(item.key)));
    return optionLabels(field?.options);
  };
  const remote: CatalogFilters = {
    brands: optionLabels(payload.brands),
    categories: optionLabels(payload.categories).length
      ? optionLabels(payload.categories)
      : valuesFor("category", "category_key"),
    colours: optionLabels(payload.colours ?? payload.colors),
    sizes: optionLabels(payload.sizes).length ? optionLabels(payload.sizes) : valuesFor("size", "size_key"),
    fields: fields.filter((field) => Boolean(field.filterable)).map((field) => ({
      key: stringValue(field.key),
      label: stringValue(field.label, field.key),
      group: stringValue(field.group, "More"),
      control: stringValue(field.control, "multi_select"),
      storage: stringValue(field.storage),
      options: optionItems(field.options),
    })).filter((field) => field.key && field.options.length),
    priceBounds: {
      min: numberValue(record(payload.priceBounds).min, 0),
      max: Math.max(1, numberValue(record(payload.priceBounds).max, 50_000)),
    },
  };
  if (remote.brands.length || remote.categories.length || remote.fields.length) return remote;
  return {
    brands: [...new Set(DEMO_PRODUCTS.map((product) => product.brand))].sort(),
    categories: [...new Set(DEMO_PRODUCTS.map((product) => product.category))].sort(),
    colours: [...new Set(DEMO_PRODUCTS.map((product) => product.colour))].sort(),
    sizes: [...new Set(DEMO_PRODUCTS.flatMap((product) => product.sizes))].sort(),
    fields: [],
    priceBounds: { min: 0, max: 10_000 },
  };
}

export async function getAdvancedCatalogPage(query: CatalogQuery): Promise<{ page: CatalogPage; queryParams: Record<string, unknown> } | null> {
  try {
    const response = await fetch(`${getPublicApiBaseUrl()}/search/advanced`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        query: query.query,
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 12,
        ...(query.lexicalQuery !== undefined ? { lexicalQuery: query.lexicalQuery } : {}),
        brand: query.brand ?? [],
        category: query.category ?? [],
        productType: query.productType ?? [],
        colour: query.colour ?? [],
        size: query.size ?? [],
        gender: query.gender ?? [],
        profileGender: query.profileGender ?? [],
        profileAge: query.profileAge,
        profileHeightCm: query.profileHeightCm,
        profileWeightKg: query.profileWeightKg,
        metadata: query.metadata ?? {},
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
        minAge: query.minAge,
        maxAge: query.maxAge,
        minHeightCm: query.minHeightCm,
        maxHeightCm: query.maxHeightCm,
        minWeightKg: query.minWeightKg,
        maxWeightKg: query.maxWeightKg,
        sort: query.sort ?? "recommended",
        swoopstyl: query.swoopStyl ?? false,
        ...(query.pincode ? { pincode: query.pincode } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload = record(await response.json());
    const remoteItems = (Array.isArray(payload.items) ? payload.items : [])
      .map(normalizeProduct)
      .filter((item): item is CatalogProduct => item !== null);
    const page = Math.max(1, numberValue(payload.page, query.page, 1));
    const pageSize = Math.max(1, numberValue(payload.pageSize, query.pageSize, 12));
    const total = numberValue(payload.total, remoteItems.length);
    return {
      page: {
        items: remoteItems,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, numberValue(payload.totalPages, Math.ceil(total / pageSize))),
        source: "api",
      },
      queryParams: record(payload.queryParams),
    };
  } catch {
    return null;
  }
}

export async function getHomeCatalog(): Promise<HomeCatalog> {
  const payload = record(await apiJson("/home"));
  const trending = (Array.isArray(payload.trending) ? payload.trending : [])
    .map(normalizeProduct)
    .filter((item): item is CatalogProduct => item !== null);
  const arrivals = (Array.isArray(payload.newArrivals) ? payload.newArrivals : [])
    .map(normalizeProduct)
    .filter((item): item is CatalogProduct => item !== null);
  if (trending.length || arrivals.length) {
    const combined = [...trending, ...arrivals];
    return {
      featured: combined.slice(0, 6),
      trending: trending.slice(0, 8),
      newArrivals: arrivals.slice(0, 8),
      categories: optionLabels(payload.categories),
      source: "api",
    };
  }
  return {
    featured: DEMO_PRODUCTS.slice(0, 6),
    trending: sortDemo(DEMO_PRODUCTS, "recommended").slice(0, 8),
    newArrivals: sortDemo(DEMO_PRODUCTS, "newest").slice(0, 8),
    categories: [...new Set(DEMO_PRODUCTS.map((product) => product.category))],
    source: "demo",
  };
}
