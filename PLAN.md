# StylMe V1 — implementation and acceptance plan

This is the implemented V1 architecture and its remaining acceptance checklist. The
database contract is in [schema.md](./schema.md), and the reproducible catalogue
pipeline is in [DATA.md](./DATA.md).

## 1. Simpler data model

StylMe uses only the collections that need independent lifecycle, high-frequency lookup, geospatial access, or audit history:

```text
Users ─ Seller ─ Seller Locations
                └─ managed Brand ids

Brand ─ Canonical Product ─ Seller Offer
                            └─ embedded variants + location inventory

Metadata Fields ─ controls Product.metadata, core keys, offer keys,
                  frontend filters, and Gemini's allowed JSON

Canonical Colors ─ HEX + universal family mappings used by variants/pickers
```

- Embed roles and customer addresses in `users`; V1 role permissions are static server code.
- Keep `sellers`, `seller_locations`, and `brands` separate because approval, ownership, and geospatial lookup are operationally important.
- Keep one canonical `products` collection and one `seller_offers` collection. Embed variants and location-stock entries in each offer instead of maintaining separate variant/inventory collections.
- Keep category, product type, gender, brand, price, size, color, stock, status, location, and variant fit ranges as direct high-use fields.
- Move styles, themes, occasions, festivals, cultural themes, materials, patterns, fit, silhouettes, necklines, moods, regions, seasons, and future sparse attributes into `products.metadata`.
- Replace long-tail taxonomy/tag tables with one `metadata_fields` registry. Each field declares its key, type, validation, options, aliases, hierarchy, storage path, frontend control, and search/filter flags.
- Keep a dedicated `colors` collection because colors are reused by every variant and require canonical HEX, aliases, swatches, and universal families. One variant has exactly one `color_id`; a canonical color may belong to several families, such as Maroon → Red + Brown. Product palettes are derived from their variants.

Every collection also receives a `metadata` JSON extension object. It follows two modes:

- `products.metadata` is controlled by `metadata_fields` and may be searchable/filterable.
- Metadata on users, sellers, locations, brands, offers, carts, orders, imports, configuration, cache, and audits is a small namespaced extension bag and is non-indexed/non-filterable by default. `products.system_metadata` serves this non-domain purpose on products so it cannot contaminate controlled fashion attributes.

Extension metadata cannot contain required ownership, lifecycle, role, price, stock, capacity, location, or SwoopStyl state. It must not contain secrets or duplicate core fields. When a metadata key becomes frequently queried, sorted, filtered, indexed, or required, promote it to a first-class field or a controlled `metadata_fields` definition.

Example product metadata:

```json
{
  "style": ["gen-z", "classic"],
  "theme": ["festive"],
  "occasion": ["diwali", "wedding-guest"],
  "material": ["cotton"],
  "pattern": ["embroidered"]
}
```

The backend rejects unknown product metadata keys and values. Inline seller-created options go through normalization and deduplication before becoming immediately available. Generic extension metadata is validated as namespaced JSON with a configured size/depth limit.

Customer onboarding stores user-entered date of birth plus consented `heightCm` and `weightKg` in `users.body_profile`. Wearable offer variants carry seller-confirmed or explicitly simulated min/max age, height, and weight ranges. Homepage personalization intersects provided values with applicable ranges and treats every blank filter as a wildcard. Non-wearables keep explicit `applicable=false` envelopes and are never assigned meaningless body ranges.

## 2. One JSON filter contract

`GET /api/v1/filters` is the public five-minute filter contract, while
`GET /api/v1/metadata/fields` is the exact controlled taxonomy contract used by
the admin/seller form and AI proposal validator.

The backend combines active `metadata_fields`, brand/offer data, and live facet counts into:

```json
{
  "schemaVersion": 7,
  "generatedAt": "2026-07-18T10:00:00Z",
  "expiresAt": "2026-07-18T10:05:00Z",
  "filters": [
    {
      "key": "metadata.style",
      "label": "Style",
      "control": "multi_select",
      "operator": "in",
      "values": [
        { "key": "gen-z", "label": "Gen-Z", "count": 42, "selected": false }
      ]
    }
  ],
  "sortOptions": ["relevance", "nearest", "price_low", "price_high", "rating"]
}
```

The Next.js frontend renders controls generically from this response instead of hard-coding filter lists. The same keys and values are sent to Gemini as its allowlist; Pydantic removes anything outside the contract before search runs.

### Lazy MongoDB cache

- Normalize query text, selected filters, search mode, pincode zone, SwoopStyl policy version, metadata schema version, and catalogue revision; hash them into `cache_key`.
- Read `available_filter_cache`. On a live hit, return its JSON directly.
- On a miss, run the facet aggregation, construct the response, and insert it with `expires_at = now + 300 seconds`.
- Add a MongoDB TTL index on `expires_at` with `expireAfterSeconds: 0`. Because TTL cleanup is asynchronous, the API must also reject logically expired rows during reads.
- Use MongoDB only—no Redis or application-memory facet cache.
- Metadata/catalogue/policy versions are part of the key, so writes immediately use a new cache namespace while old documents expire naturally.

## 3. Hybrid AI processing, search, and SwoopStyl

For the hackathon build, product-image enrichment runs once in the admin browser
through the Vercel AI SDK. FastAPI remains the validation and persistence authority.
This deliberately avoids sending image bodies through Vercel functions.

Install the AI runtime in `frontend` during implementation:

```bash
npm install ai ai-key-manager @ai-sdk/google
```

### Product creation request path

```text
Admin browser
  → validate signature/dimensions, resize and encode WebP, strip EXIF
  → upload the normalized image directly to ImgBB
  → create a canonical Mongo-backed product draft in FastAPI
  → reserve one idempotent AI run using draft/input/taxonomy hashes
  → browser scheduler selects a public hackathon provider key
  → Vercel AI SDK generates a runtime-Zod-constrained proposal
  → FastAPI revalidates the proposal against the same controlled taxonomy
  → admin reviews, patches, and submits the draft
  → owner/admin approval publishes Product + SellerOffer atomically
```

- The browser downloads the five-minute metadata-field contract from MongoDB and
  builds the prompt and runtime Zod enums from the exact active AI-allowed options.
- `ai_processing_runs` has a unique draft/input/contract tuple. A completed or
  reserved tuple cannot consume another provider call, including after refresh.
- The browser-safe scheduler persists only provider health/cooldown state. It rotates
  key pools and providers while keeping the one-call reservation invariant.
- The published `ai-key-manager` package is installed for SDK/server compatibility,
  but its current Node-only filesystem/crypto implementation is not imported into
  the browser bundle. The browser adapter implements the required rotation and
  cooldown behavior without bundling Node shims.
- FastAPI verifies contract versions and allowlist hashes, then validates the object
  again with Pydantic. AI output is always a proposal and never Mongo authority.
- `NEXT_PUBLIC_*` AI and ImgBB keys are intentionally extractable in hackathon mode.
  They must be provider-restricted, quota-limited, rotated after the demo, and moved
  behind a server/edge gateway before production. Mongo/JWT/owner credentials are
  never exposed to the browser.
- On key exhaustion, timeout, or malformed JSON, the draft stays editable and can be
  completed manually. Natural-language search falls back to deterministic lexical
  parsing, so the catalogue remains usable without a provider.

Natural-language search uses a separate one-call browser workflow. It reserves an
idempotent `search_intent_runs` row, gives the provider the complete live controlled
taxonomy plus exact lexical brand candidates, validates structured JSON in Zod and
again in FastAPI, and serializes the resulting advanced filters as repeated query
parameters. Values inside one facet are OR choices; different facets intersect.
Every facet is searchable and multi-select in the UI. The AI never receives MongoDB
credentials and cannot emit Mongo operators, seller eligibility, or delivery scores.

- Atlas Search provides the inverted index for product title, description, core classification keys, and registry-controlled `metadata` values. Local development uses the flattened `search_text` text index plus aggregation filters.
- Gemini only proposes controlled catalogue fields from image/text evidence and
  controlled search intent from shopper text. It
  cannot emit Mongo operators, arbitrary metadata, price, stock, distance, seller
  eligibility, or delivery promises and receives no MongoDB credentials.
- Search first retrieves relevant canonical products and active offers. SwoopStyl then strictly keeps approved sellers with a resolved active location, positive stock, capacity headroom, acceptable handling/cutoff, and distance inside the effective radius.
- The configurable default remains 100 km with 0–25, 25–60, and 60–100 km bands. Ranking remains distance-dominant: 60% distance, 20% relevance, 10% capacity, 5% stock, 5% readiness.
- Full catalogue browsing does not require pincode. Turning on SwoopStyl prompts for and stores one. The homepage SwoopStyl rail and strict search toggle consume the same endpoint and eligibility logic.
- `GET /api/v1/products?swoopstyl=true&pincode=...` now enforces that zone
  directly and returns distance/score diagnostics with each eligible product.
  Natural-language price ceilings such as “under ₹2500” are emitted in INR by the
  structured intent compiler and are also extracted by the deterministic fallback,
  so AI failure never removes basic intent.

## 4. Product and UI scope

- Rename visible product branding to **StylMe** and the one-day feature to **SwoopStyl**.
- Adapt the `store-arnabdzns` shadcn design system, layouts, storefront cards, search interactions, forms, tables, and responsive states; do not bring over its Clerk, Prisma/Postgres, Razorpay, or digital-download logic.
- Customer: home, discovery/search, product details, offer/variant selection, cart, mock checkout, orders, addresses, onboarding, and WhatsApp-update copy.
- Seller: onboarding, approval state, dashboard, brands, locations/capacity, product/offer editor, canonical color picker/HEX-family preview, per-variant height/weight fit ranges, embedded location inventory, and orders.
- Owner/admin: seller approval, users, catalogue, metadata field/option editor, imports/rejections, SwoopStyl configuration, orders, and audits. Owner alone manages admins.
- Mock checkout creates an immutable order snapshot and never changes inventory or configured capacity/load.

## 5. Build and acceptance order

1. Beanie models, indexes, metadata validator, seeded metadata fields/options, app config, mock signed-cookie auth and role guards.
2. Idempotent Myntra CSV import with deterministic simulated sellers/offers/variants/inventory/locations/capacity/fit ranges, canonical colors, and `simulation_mode=true` provenance.
3. Product/offer/seller/location APIs and generic forms driven by the metadata/filter JSON.
4. Next.js Vercel AI SDK gateway with `ai-key-manager`, Zod/Pydantic contract tests, Atlas/local search adapter, lexical fallback, lazy five-minute facet cache, and SwoopStyl evaluation/ranking.
5. StylMe storefront, role workspaces, cart/mock orders, responsive polish, and end-to-end tests.

Acceptance requires: every collection supports bounded extension metadata; controlled product metadata rejects invalid keys/values; generic metadata cannot override core fields; every frontend filter comes from the JSON contract; filter cache hits and expires logically at five minutes; metadata/config/catalogue changes bypass stale cache; the client scheduler rotates/cools down restricted hackathon keys; one draft/input fingerprint can invoke AI only once; Python rejects stale or invented AI fields; manual creation still works when AI is unavailable; SwoopStyl returns only in-zone eligible offers nearest-first; approved sellers can submit valid offers; and only owner/admin approval publishes them.

## 6. Data preparation status

The full production data design and runbook are in [DATA.md](./DATA.md). The reproducible pipeline currently produces and validates 30,000 complete Product + SellerOffer envelopes, plus normalized manifests for 3,655 brands, 376 sellers, 377 geocoded locations, 44 canonical colors, 20 metadata fields, app configuration, dedupe review, 100-product Codex batches, image processing, and MongoDB seeding.

All variants have a canonical color and fit envelope; body-fit products have numeric height/weight ranges, while non-body-fit products explicitly use `applicable=false`. Offline enrichment uses the saved ChatGPT login through local `codex exec`, never Gemini/API keys. Existing CSV image URLs are seeded unchanged; ImgBB is reserved for new dashboard product uploads. The root `.env` is the sole local configuration source, and its Mongo target now contains the complete 30,000-product/offer seed.
