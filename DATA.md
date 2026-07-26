# StylMe data production plan and runbook

This document covers the Myntra data history and tooling. The 50,000-product v2 catalogue and older 30,000-product/OpenAI path remain as an audit trail; the current production deployment state and validated 80,000-row v3 candidate are recorded below. The database design remains in [schema.md](./schema.md).

## Current production deployment state

The original source database remains intact at 50,000 managed products and 50,000 offers. Its 30 collections were copied and fingerprint-verified on the destination. The v3 destination expansion was then stopped by operator request after a destination-only managed prune and partial product writes. The destination is frozen at 47,819 managed products, 30,344 matching managed offers, 26,500 v3-marked products, and zero v3 offers. Treat the source as the recovery copy; do not run the guarded source-delete command in this state.

## Validated 80k candidate (v3, not fully seeded)

`data/processed/catalogue-80k/processed.csv` is reproducible with seed `stylme-curated-80000-v3` and `npm run catalogue:build`. The processed directory is excluded from the share ZIP.

| Result | Count |
| --- | ---: |
| Valid unique products/offers/slugs | 80,000 |
| Allowed product types used | 74 |
| Normalized brands | 2,140 |
| Sellers / seller locations | 264 / 265 |
| Metadata field definitions | 28 |
| Festive-first products | 46,867 |
| Products with Gen Z signal | 64,243 |
| Products with Gen Alpha signal | 15,757 |
| Products with full deep-personalization facets | 80,000 |
| Forbidden-policy matches | 0 |

The candidate passed offline validation, but it did not pass live database verification because seeding was stopped. Offline validity must not be presented as a completed live migration.

## Curated 50k output (v2 history)

The earlier catalogue is `data/processed/catalogue-50k/processed.csv`, reproducible with seed `stylme-curated-50000-v2` and `npm --prefix data run catalogue50:build`.

| Result | Count |
| --- | ---: |
| Valid unique products/offers/slugs | 50,000 |
| Allowed product types used | 74 |
| Normalized brands | 2,020 |
| Sellers / seller locations | 264 / 265 |
| Canonical colors | 44 |
| Metadata field definitions | 28 |
| Festive-first products | 29,998 |
| Products with Gen Z signal | 40,251 |
| Products with Gen Alpha signal | 9,749 |
| Products with full deep-personalization facets | 50,000 |
| Forbidden-policy matches | 0 |

The build reads 20 active taxonomy fields from MongoDB, merges them with eight deeper local fields, retains existing options, creates new dynamic options, and validates every emitted value against the resulting registry. The strict policy excludes intimate apparel, underwear, lingerie, sleep/loungewear, swimwear, hosiery, and thermal underlayers. See [SETUP.md](./SETUP.md) and [SYSTEM_DESIGN.md](./SYSTEM_DESIGN.md).

## Legacy v1 baseline (30k)

The original generated catalogue was [processed.csv](./data/processed/processed.csv), reproducible with seed `stylme-30000-v1`. It is no longer the live production dataset.

| Result | Count |
| --- | ---: |
| Valid processed products | 30,000 |
| Unique product keys/slugs | 30,000 |
| Seller offers | 30,000 |
| Embedded variants | 98,389 |
| Location inventory entries | 98,389 |
| Variants with numeric body-fit ranges | 68,355 |
| Variants with explicit non-applicable fit envelopes | 30,034 |
| Normalized brands | 3,655 |
| Sellers | 376 |
| Seller locations | 377 |
| Geocoded active locations | 377 |
| Canonical colors | 44 |
| Metadata field definitions | 20 |
| Product types | 409 |
| Conservative fuzzy dedupe reviews | 121 |

Source mix: 1,000 products from `myntra-product.csv` and 29,000 stratified products from `myntra202305041052.csv`.

Validation is recorded in [validation_report.json](./data/processed/validation_report.json), live Mongo verification in [mongo_verification_report.json](./data/processed/mongo_verification_report.json), the build summary in [build_summary.json](./data/processed/build_summary.json), and source profiling in [source_profile.json](./data/processed/source_profile.json).

## Source analysis

### `data/raw/myntra-product.csv`

- 1,000 CSV records, 24 columns, and 1,000 unique product IDs.
- No malformed rows; every nested JSON value parses.
- 281 seller labels and 177 source pincodes.
- 84 records lack seller name/address and therefore receive deterministic simulated fulfilment.
- Price range: ₹149–₹16,995 final price. Ratings range from 0–5.

Available source fields:

```text
url, product_id, title, product_description, rating, ratings_count,
initial_price, discount, final_price, currency, images, delivery_options,
product_details, breadcrumbs, product_specifications, amount_of_stars,
what_customers_said, seller_name, sizes, videos, seller_information,
variations, best_offer, more_offers
```

Important interpretation: `title` is the source brand label and `product_description` is the consumer product name. Breadcrumbs include brand/navigation tails, which the pipeline removes before deriving product type.

### `data/raw/myntra202305041052.csv`

- 1,060,213 parsed CSV records occupying about 1.3 GB.
- 822,972 unique product IDs and 237,241 repeated scrape records.
- 5,496 brand labels and 404 URL product-type buckets.
- No missing source columns or malformed rows.
- The raw `discount` column contains impossible outliers up to 19,996; the pipeline recomputes discount from MRP and sale price.
- The `img` field mostly repeats one underlying asset URL at several DPR transformations. The pipeline canonicalizes these to one Myntra asset URL.

Available source fields:

```text
id, name, img, asin, price, mrp, rating, ratingTotal, discount, seller, purl
```

Important interpretation: this file's `seller` is the consumer-facing brand label, not a fulfilment seller. StylMe never turns it into an unverified real seller.

## Sampling and normalization

The rich 1,000 rows are always retained. The large source is streamed and deduplicated by the product ID in `purl`. The remaining 29,000 records are selected with deterministic, square-root-weighted category quotas across all 404 discovered product types. A min-hash reservoir prevents file order from biasing the sample. Rerunning with the same seed produces the same catalogue.

Entity handling:

1. Unicode NFKC normalization, case-folding, punctuation removal, ampersand normalization, and whitespace collapse.
2. Seller legal suffixes such as `PVT LTD`, `Private Limited`, `LLP`, and `Ltd` are removed from the identity key but retained in aliases/display evidence.
3. Exact normalized forms are merged automatically.
4. Extremely high-confidence fuzzy variants are merged only at conservative thresholds.
5. Ambiguous brand/seller pairs are written to `data/processed/seed/dedupe_review.jsonl`; 121 current pairs require review and are not silently merged.
6. Brands, sellers, and locations receive stable pipeline keys used for MongoDB upserts.
7. Locations deduplicate by seller, pincode, and normalized address.

Missing seller, location, stock, capacity, variants, or fit information is generated from the fixed pipeline seed. Generated values always use `simulation_mode=true`, source metadata, and quality flags. They are demo marketplace data—not claims about current Myntra inventory or delivery.

## Processed CSV contract

Every row is a complete Product + SellerOffer ingestion envelope. The Mongo seed resolves stable keys to ObjectIds and separates the row into collections.

| Group | Exact columns |
| --- | --- |
| Version/source | `schema_version`, `source`, `source_product_id`, `source_url`, `product_key` |
| Brand/product identity | `brand_key`, `brand_name`, `title`, `normalized_title`, `slug`, `description`, `status`, `visibility` |
| Classification | `category_key`, `product_type_key`, `gender_keys_json`, `product_metadata_json` |
| Media/colors | `media_json`, `cover_image_url`, `color_palette_json` |
| Rating/search/provenance | `rating_json`, `source_details_json`, `search_text`, `product_simulation_mode`, `product_system_metadata_json` |
| Seller | `seller_key`, `seller_name`, `seller_status`, `seller_metadata_json` |
| Location/SwoopStyl inputs | `location_key`, `location_name`, `location_address`, `location_pincode`, `location_place_json`, `location_geo_json`, `location_daily_capacity`, `location_current_load`, `location_cutoff_local`, `location_handling_hours` |
| Offer/price | `offer_code`, `currency`, `mrp_paise`, `sale_price_paise`, `discount_percent`, `offer_details_json` |
| Variants/inventory/fit | `variants_json`, `inventory_json`, `fit_bounds_json`, `age_bounds_json`, `available_size_keys_json` |
| Color facets | `available_color_keys_json`, `available_color_family_keys_json` |
| Simulation/quality | `offer_simulation_mode`, `offer_metadata_json`, `quality_flags_json` |

Required invariants enforced by `validate_processed.py`:

- All 30,000 product, offer, and slug keys are unique.
- Required identity, seller, location, price, description, search, and media fields exist.
- MRP ≥ sale price > 0 and discount is between 0–100.
- Metadata keys and values exist in the generated metadata registry.
- Every offer has at least one variant and positive location inventory.
- Every variant has exactly one canonical color, one fit envelope, and one age envelope.
- Every inventory item references a variant and the row's seller location.
- All seller, location, brand, and color keys resolve to seed manifests.

## Metadata and intelligent search

`data/config/metadata_fields.seed.json` defines the controlled fields. The build adds discovered categories, product types, sizes, colors, and color families to `data/processed/seed/metadata_fields.json`.

Direct/high-frequency filters remain category, product type, gender, brand, price, size, color, color family, seller, availability, age/fit range, and location. Long-tail values live in controlled `Product.metadata`: style, theme, occasion, festival, cultural theme, material, pattern, fit, silhouette, season, mood, outfit role, generation, and trend signal.

The deterministic build assigns all 30,000 products a controlled generation and trend signal. It produces 12,732 age-targeted wearable offers (76,092 variants) and 17,268 explicit wildcard/non-applicable offers (22,297 variants). Current generation coverage includes 3,949 Gen Alpha products and 393 explicit Gen Z products; the remaining values are controlled millennial/timeless signals. These are reproducible merchandising classifications, not appearance-based identity inference.

The same registry drives:

- Product and seller form controls.
- Storefront available-filter JSON.
- MongoDB/Atlas Search fields and facets.
- Codex/runtime intent parsers' allowed structured-output keys and values.
- Python validation of AI output before MongoDB search or commit.

At runtime, the browser sends this complete live registry (plus only exact lexical
brand candidates) to the Vercel AI SDK for a single structured search-intent call.
The result is reserved and validated through `search_intent_runs`, then translated
to repeated advanced-search URL parameters. FastAPI rechecks every field and value;
OR applies within one facet and AND across facets. A deterministic English, Hindi,
and Hinglish parser remains the no-key/error fallback.

## Universal colors and image processing

`data/config/color_catalog.seed.json` contains named colors plus universal families: red, orange, yellow, green, blue, indigo, violet, pink, black, white, gray, brown, beige, metallic, multicolor, and unspecified.

- A variant has exactly one `color_id`.
- A canonical color can have multiple families: Maroon maps primarily to Red and also Brown; Teal maps to Green and Blue.
- A Product palette is derived from all offer variants and image/color evidence.
- The seller color picker accepts a canonical name and `#RRGGBB` value. Exact name/HEX matches reuse a color. Very close CIELAB matches reuse an existing value; a genuinely new HEX becomes a proposal.
- Source text resolves 18,677 current products to named colors. The remaining 11,323 use the explicit `unspecified` color until image/AI review—never a guessed color.

`image_pipeline.py` can optionally remove backgrounds with `rembg`, quantize foreground colors with Pillow, map HEX values to universal families, and save a local proposal. Background removal is optional because it adds a heavy runtime/model dependency.

Existing CSV image links are stored and seeded exactly as imported; the pipeline never re-uploads those 30,000 products. New seller/admin images are signature-checked, dimension-limited, EXIF-stripped, resized, and converted to WebP in the browser. The normalized file is uploaded directly from the dashboard to ImgBB and only the returned URL/dimensions/hash/palette are sent to FastAPI. This keeps image bodies out of Vercel functions and avoids their request-body ceiling. ImgBB and direct-AI public keys are intentionally browser-visible only in hackathon mode; restrict their domains/quotas and rotate them after the demo. See [ImgBB API](https://api.imgbb.com/), [Vercel function limits](https://vercel.com/docs/functions/limitations), and [rembg](https://github.com/danielgatis/rembg).

### Apparel-only OpenAI vision catalogue

The replacement production catalogue is exactly 30,000 apparel records. Selection requires all three gates before an OpenAI request is created:

1. The source product type resolves to `apparel`.
2. The final title-aware classifier also resolves to `apparel`, preventing misleading URL categories from admitting beauty, footwear, jewellery, bags, home goods, or accessories.
3. The cover image is a real canonical HTTPS URL; placeholders such as `-` are rejected.

The OpenAI path uses `gpt-5.6-luna` for the high-volume workload, high image detail, low reasoning, the Responses API, and strict Structured Outputs. It stores no response state. Output is limited to controlled metadata and canonical color keys; sensitive traits are never inferred. A local validator rejects malformed values, non-clothing images, source/image mismatches, poor images, and low-confidence results before MongoDB can be touched.

OpenAI Batch input is split into 25,000- and 5,000-request files. Both remain below the official 50,000-request and 200 MB per-batch limits. Submission is separately guarded by `submit --commit`, persisted in `batch-state.json`, and idempotent by the SHA-256 of each JSONL shard.

```bash
cd data
npm run apparel:build
npm run apparel:validate-base
npm run apparel:prepare-openai

# Small synchronous contract/quality check before the paid bulk run.
python3 scripts/run_openai_vision_batches.py \
  --plan processed/clothing-30k/openai/plan.json \
  --seed-dir processed/clothing-30k/seed \
  pilot --limit 10

# Explicit paid side effect. Re-running skips already submitted shard hashes.
python3 scripts/run_openai_vision_batches.py \
  --plan processed/clothing-30k/openai/plan.json \
  --seed-dir processed/clothing-30k/seed \
  submit --commit

npm run apparel:openai-status
npm run apparel:openai-collect

# If provider failures exist, build a retry from every request without a
# collected HTTP 200 response, submit its plan with the same guarded command,
# then collect it. The final merge discovers collected retry-* states.
npm run apparel:openai-prepare-retry
python3 scripts/run_openai_vision_batches.py \
  --plan processed/clothing-30k/openai/retry-001/plan.json \
  --seed-dir processed/clothing-30k/seed \
  submit --commit
npm run apparel:openai-retry-status
npm run apparel:openai-retry-collect

npm run apparel:merge-openai

# If the strict merge reports content/image rejections, select only novel
# apparel rows from the validated reserve and process that smaller fill batch.
npm run apparel:select-replacements
npm run apparel:prepare-replacements
# Submit/monitor/collect replacement-001/openai/plan.json with the same runner,
# then merge again with matching --replacement-input/--replacement-plan flags
# (the checked-in npm script is configured for replacement-001).
npm run apparel:validate-final
npm run apparel:geocode

# Upsert the accepted set, then prune only older pipeline-managed Myntra
# products/offers absent from this apparel input. Manual/admin products remain.
npm run apparel:seed
npm run apparel:verify
```

The merge must produce 30,000 accepted rows or it exits without creating the final ingestion CSV. Failed requests are retried and rejected source rows are replaced before seeding. The managed-catalog prune is explicit and happens only after successful product and offer upserts.

Example:

```bash
data/.venv/bin/python data/scripts/image_pipeline.py \
  --input ./incoming/product.png \
  --product-key product:manual:123 \
  --variant-id v-medium-maroon \
  --color-name Maroon \
  --remove-background

```

## Age, height, and weight personalization

Customer onboarding stores the user-entered date of birth plus consented `heightCm` and `weightKg` in `User.body_profile`. These are sensitive personalization inputs and must be optional, editable, deletable, and excluded from analytics/audit payloads. Blank storefront ranges are true wildcards.

Each offer variant has this shape:

```json
{
  "fitRange": {
    "applicable": true,
    "minHeightCm": 153,
    "maxHeightCm": 176,
    "minWeightKg": 56,
    "maxWeightKg": 72,
    "source": "simulated_size_standard",
    "confidence": 0.55
  }
}
```

11,300 current products have numeric fit ranges. For 18,700 non-body-fit products such as watches, beauty, jewellery, and home goods, the equivalent object has `applicable=false` and null bounds. Meaningless body ranges are never fabricated.

Every variant also contains `ageRange`. Wearable adult ranges use a conservative deterministic 13–110 envelope; kids/boys/girls ranges use 0–14; products without a meaningful age fit use `applicable=false` with null bounds. Seller/admin listings can replace these simulated values with confirmed min/max ages.

Homepage logic:

1. Convert consented height into a stable 15 cm band (`150–165`, `165–180`, …) and weight into a stable 10 kg band (`40–50`, `50–60`, …). Exact boundaries start the next band.
2. Find active offer variants whose confirmed bounds overlap both requested bands. These form the first recommendation tier.
3. Keep `applicable=false` products as wildcards in a second tier so jewellery, beauty, home, and incomplete size charts do not disappear.
4. Prefer seller-confirmed ranges over source-derived and simulated ranges inside the confirmed tier.
5. Combine the tier with style/color/size preferences, rating, inventory, and—when pincode exists—SwoopStyl proximity. In SwoopStyl, distance remains the 60% score inside each fit tier.
6. AI can propose ranges only when size-chart evidence exists. It cannot invent or commit height/weight data; seller/admin confirmation is required.

Gender uses the same age contract. Adult wearable variants use 13–110 and child variants use 0–14, so ages 13–14 intentionally bridge the corresponding `women/girls` or `men/boys` departments. `unisex` remains compatible; a blank preference is a wildcard.

## Codex batch enrichment

The offline data workflow uses the locally authenticated Codex CLI. It does not read Gemini or OpenAI API keys:

```text
processed.csv
  → 100-product prepare_ai_batches.py batches
  → logged-in `codex exec` + JSON output schema
  → merge_ai_results.py
  → Python allowlist/confidence validation
  → proposals by default, explicit committed CSV only when requested
```

`codex_enrich.py` first requires `codex login status` to report a saved ChatGPT login. Runs are read-only, ephemeral, resumable by batch ID, and constrained by `data/config/codex_enrichment_output.schema.json`. A failed or interrupted batch is not appended, and reruns skip completed batches.

```bash
cd data
npm run codex:prepare             # 30,000 products → 300 batches of 100
codex login status                # must say Logged in using ChatGPT
npm run codex:enrich              # resumable; no provider API key
npm run codex:merge               # validated proposals
npm run codex:commit              # requires all 30,000 results, then validates

# Resumable complete flow; four workers may consume Codex plan usage quickly.
npm run pipeline:complete

cd ..
# Explicit commit creates a new file; it never overwrites the validated base.
python3 data/scripts/merge_ai_results.py \
  --commit-output data/processed/processed.codex.csv \
  --confidence 0.92
```

Codex proposes only controlled metadata from supplied product text. Titles, descriptions, classifications, image links, and canonical palettes remain authoritative. Codex cannot decide price, seller, stock, location, SwoopStyl eligibility, or height/weight ranges. Unknown values stay in proposal review.

## Reproducible build commands

```bash
python3 data/scripts/profile_sources.py
python3 data/scripts/build_processed.py --target 30000 --seed stylme-30000-v1
python3 data/scripts/validate_processed.py --expected-rows 30000

python3 -m venv data/.venv
data/.venv/bin/python -m pip install -r data/requirements.txt
data/.venv/bin/python data/scripts/geocode_locations.py

cd data
npm install
python3 scripts/prepare_ai_batches.py --batch-size 100 --output processed/codex_batches.jsonl
python3 scripts/codex_enrich.py
python3 scripts/merge_ai_results.py
node scripts/seed_mongo.mjs                 # dry-run
node scripts/seed_mongo.mjs --check-connection
node scripts/seed_mongo.mjs --apply         # idempotent MongoDB upsert
```

The expanded CSV is about 128 MB and is ignored by Git to avoid exceeding normal Git hosting limits. `processed.csv.gz` and `SHA256SUMS` are generated as portable artifacts; Git LFS/object storage is appropriate if the expanded CSV must be versioned.

## MongoDB ingestion order

Both `seed_mongo.py` and the Node/OpenSSL fallback `seed_mongo.mjs` follow the same upsert order:

1. Required indexes, including five-minute TTL on `available_filter_cache.expires_at`.
2. Metadata fields and non-secret app configurations.
3. Canonical colors and brands.
4. Simulated seller users and approved sellers with managed brand IDs.
5. Geocoded pincode cache and seller locations.
6. Canonical products.
7. Seller offers with variant color ObjectIds, fit ranges, and location inventory.
8. Completed import-job and idempotent audit record.

No collection is dropped. Product/offer upserts use `(source, source_product_id)` and `offer_code`. Entity upserts use stable `metadata.pipeline.key` values. The optional `--prune-managed-catalog` flag runs only after successful upserts and deletes only older Myntra-source products plus their offers that are absent from the selected input; it never targets manual/admin products.

### Current seed status

The v2 source database is complete and retained. The destination first passed an exact 30-collection copy verification, then diverged when the v3 catalogue seed was intentionally stopped. The independent live verifier checks counts, media, entity references, controlled taxonomy values, exclusions, deep-personalization coverage, ranges, indexes, and source image URL preservation; no valid 80k live report exists for the current destination. Generated datasets and reports remain local and are excluded from the share ZIP.

```bash
cd data
node scripts/seed_mongo.mjs --apply
node scripts/verify_mongo.mjs
```

Do not work around connection failures with disabled TLS verification. See the [MongoDB Atlas IP access-list documentation](https://www.mongodb.com/docs/atlas/security/ip-access-list/) and [Atlas connection prerequisites](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/).

## Environment contract

The repository root `.env` is the single local source for frontend, backend, and data tools. Folder-level `.env` files are ignored. The safe contract is in `.env.example`:

```text
MONGODB_URL
MIGRATE_DESTINATION_MONGO_URI
MONGODB_DB_NAME
APP_NAME
API_VERSION
DEBUG
JWT_SECRET
OWNER_EMAIL
OWNER_PASSWORD_HASH
NEXT_PUBLIC_API_BASE_URL
NEXT_PUBLIC_HACKATHON_DIRECT_AI
NEXT_PUBLIC_IMGBB_KEY
NEXT_PUBLIC_GEMINI_API_KEYS
NEXT_PUBLIC_GROQ_API_KEYS
NEXT_PUBLIC_OPENROUTER_API_KEYS
```

Codex authentication is managed by `codex login`, outside the project environment. MongoDB, JWT, and owner credentials remain server-only and must never be stored in product metadata, generated data, logs, or `NEXT_PUBLIC_*` variables. The public ImgBB/AI pools exist only for the requested hackathon direct-browser mode; treat them as disposable, provider-restricted client identifiers rather than secrets and move them behind a gateway for production.
