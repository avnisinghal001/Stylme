// =============================================================================
// StylMe — simplified MongoDB / Beanie schema (Eraser.io compatible)
// Feature: SwoopStyl distance-first, one-day fashion discovery
// =============================================================================
//
// Design rule:
// - Keep frequently queried identities and operational fields first-class.
// - Put long-tail fashion attributes in Product.metadata.
// - metadata_fields is the only authority for metadata keys, types, allowed
//   values, UI controls, searchability, and filterability.
// - Every collection has a `metadata` extension object. On Product it contains
//   controlled fashion attributes; elsewhere it is a small, namespaced,
//   non-indexed extension bag that can never replace required business fields.
// - MongoDB Atlas Search supplies the inverted index across product text and
//   controlled metadata. Local development uses one flattened text index.
// - Available filters/facet counts are generated lazily and cached only in
//   MongoDB for five minutes.
//
// V1 stack: Next.js + shadcn/ui, Vercel AI SDK + ai-key-manager,
// FastAPI + Beanie, MongoDB, pgeocode.
// Money is stored as integer INR paise. Coordinates are GeoJSON [lon, lat].

// -----------------------------------------------------------------------------
// CONTROLLED VALUES
// -----------------------------------------------------------------------------
//
// role: customer | seller | admin | owner
// user_status: active | blocked | deleted
// seller_status: pending | approved | rejected | suspended
// record_status: draft | active | archived | blocked | deleted
// offer_status: draft | active | paused | archived
// order_status: placed | confirmed | packed | out_for_delivery | delivered | cancelled
// payment_status: mock_pending | mock_paid | cod_selected | mock_failed
// metadata_data_type: text | number | boolean | enum | multi_enum | range
// metadata_storage: product_core | product_metadata | offer
// filter_control: select | multi_select | checkbox | range | swatch | hidden
// import_status: uploaded | validating | importing | completed | partial | failed

// -----------------------------------------------------------------------------
// USERS + SELLERS
// -----------------------------------------------------------------------------

users [icon: user, color: blue] {
  id ObjectId pk
  email string unique
  phone_e164 string unique nullable
  full_name string
  avatar_url string nullable
  status user_status
  roles string[] // static server-controlled role enum; no role collections in V1
  onboarding_completed boolean
  addresses object[] // address + pincode + pgeocode place/GeoJSON snapshot
  default_address_id string nullable // embedded address id
  default_pincode string nullable // fast SwoopStyl lookup
  preferences object // controlled gender/department, size, style, generation keys + budget
  body_profile object // dateOfBirth, heightCm, weightKg, consent; runtime derives age/15cm/10kg bands
  appearance_profile object nullable // reviewed controlled JSON + hashes; never raw photos
  whatsapp_opt_in boolean // UI preference only; no provider integration in V1
  metadata object // namespaced extensions; non-filterable/non-indexed
  created_at datetime
  updated_at datetime
}

sellers [icon: store, color: orange] {
  id ObjectId pk
  user_id ObjectId unique
  display_name string
  normalized_name string
  slug string unique
  legal_details object nullable
  contact object
  status seller_status
  rejection_reason string nullable
  approved_by_user_id ObjectId nullable
  approved_at datetime nullable
  brand_ids ObjectId[] // seller may manage multiple brands
  simulation_mode boolean
  source_ref string nullable
  metadata object // namespaced seller/integration extensions
  created_at datetime
  updated_at datetime
}

seller_locations [icon: map-pin, color: orange] {
  id ObjectId pk
  seller_id ObjectId
  name string
  address_line string
  pincode string
  place object // city, district, state, countryCode from pgeocode
  geo_point object // GeoJSON Point; 2dsphere indexed
  geocode_resolved boolean
  timezone string
  daily_capacity integer
  current_committed_load integer // configured/demo load; checkout does not mutate
  capacity_date date
  cutoff_local string // HH:mm
  handling_hours integer
  swoopstyl_enabled boolean
  radius_km_override number nullable
  status record_status
  simulation_mode boolean
  metadata object // carrier/warehouse extensions; never SwoopStyl source of truth
  created_at datetime
  updated_at datetime
}

brands [icon: badge, color: orange] {
  id ObjectId pk
  name string
  normalized_name string unique
  slug string unique
  aliases string[]
  logo_url string nullable
  description string nullable
  status record_status
  simulation_mode boolean
  created_by_user_id ObjectId nullable
  metadata object // optional brand extensions/import provenance
  created_at datetime
  updated_at datetime
}

pincode_geos [icon: navigation, color: orange] {
  id ObjectId pk
  country_code string
  pincode string
  place object
  geo_point object // cached pgeocode centroid
  resolved boolean
  metadata object // provider/raw geocode extensions
  refreshed_at datetime
}

// -----------------------------------------------------------------------------
// ONE CONTROLLED METADATA REGISTRY
// -----------------------------------------------------------------------------
//
// One document exists per field, e.g. category, product_type, gender, color,
// size, style, theme, occasion, festival, material, pattern, fit, neckline.
// Core/common keys can be stored directly on Product/Offer; long-tail keys are
// stored in Product.metadata. Both are governed by the same registry.

metadata_fields [icon: sliders, color: purple] {
  id ObjectId pk
  key string unique // stable API/storage key, e.g. style
  label string
  description string nullable
  group string // identity | classification | appearance | occasion | garment
  data_type metadata_data_type
  storage metadata_storage
  storage_path string // e.g. category_key or metadata.style
  control filter_control
  options object[] // {key,label,aliases,parentKey,hex?,sortOrder,active}
  validation object // required, min/max, regex, maxSelections
  filterable boolean
  searchable boolean
  gemini_allowed boolean
  frontend_visible boolean
  usage_frequency string // core | common | long_tail
  sort_order integer
  schema_version integer
  status record_status
  created_by_user_id ObjectId nullable
  updated_by_user_id ObjectId nullable
  metadata object // field-level UI/import extensions; not option storage
  created_at datetime
  updated_at datetime
}

// Metadata examples stored on Product:
// {
//   "style": ["gen-z", "classic"],
//   "theme": ["festive", "minimal"],
//   "occasion": ["diwali", "wedding-guest"],
//   "material": ["cotton"],
//   "pattern": ["embroidered"],
//   "fit": ["regular"],
//   "generation": ["gen-alpha"],
//   "trend_signal": ["emerging"]
// }
// The API rejects any key/value not allowed by metadata_fields.

colors [icon: palette, color: purple] {
  id ObjectId pk
  key string unique // stable variant/filter key
  name string
  normalized_name string unique
  hex string nullable // canonical #RRGGBB
  primary_family_key string // VIBGYOR/neutral family
  family_keys string[] // one color may map to multiple universal families
  aliases string[] // grey, off-white, wine red, etc.
  status record_status
  metadata object // source, confidence, image/AI proposal provenance
  created_at datetime
  updated_at datetime
}

// -----------------------------------------------------------------------------
// CANONICAL PRODUCT + SELLER OFFER
// -----------------------------------------------------------------------------

products [icon: shirt, color: green] {
  id ObjectId pk
  source string // myntra_csv | manual_admin | manual_seller
  source_product_id string nullable
  source_url string nullable
  brand_id ObjectId
  title string
  normalized_title string
  slug string unique
  description string
  status record_status
  visibility string // public | unlisted

  category_key string // controlled core metadata option
  product_type_key string // controlled core metadata option
  gender_keys string[] // controlled core metadata options
  metadata object // controlled long-tail product attributes and extension surface
  media object[] // image/video url, alt, order, optional color key
  cover_image_url string nullable
  color_palette object[] // colorId, hex, families, variant sources, confidence

  rating object // average, count, breakdown, customer summary
  source_details object // specifications, breadcrumbs, source-only data
  search_text string // deterministic flattened title/brand/metadata text fallback
  simulation_mode boolean
  created_by_user_id ObjectId nullable
  system_metadata object // non-filterable namespaced import/integration extensions
  created_at datetime
  updated_at datetime
}

seller_offers [icon: shopping-bag, color: green] {
  id ObjectId pk
  product_id ObjectId
  seller_id ObjectId
  brand_id ObjectId // repeated for fast seller/brand validation
  offer_code string unique
  status offer_status
  currency string // INR
  mrp_paise integer
  sale_price_paise integer
  discount_percent number
  offer_details object // best offer, delivery/return copy
  variants object[] // id, sku, sizeKey, colorId, measurements, fitRange, ageRange, attributes
  inventory object[] // variantId, locationId, availableQty, active
  fit_bounds object // applicable + min/max heightCm/weightKg across variants
  age_bounds object // applicable + minAge/maxAge across variants
  available_size_keys string[] // common/high-use offer filter
  available_color_ids ObjectId[] // canonical colors used by active variants
  available_color_family_keys string[] // red, blue, gray, etc.
  location_ids ObjectId[] // inventory-bearing location shortcut
  simulation_mode boolean
  created_by_user_id ObjectId nullable
  metadata object // namespaced offer/integration extensions; non-filterable by default
  created_at datetime
  updated_at datetime
}

// -----------------------------------------------------------------------------
// SWOOPSTYL, GENERIC APP CONFIG, AND LAZY FILTER CACHE
// -----------------------------------------------------------------------------

app_configs [icon: settings, color: red] {
  id ObjectId pk
  key string unique // swoopstyl | catalogue | auth_demo | frontend | ai_runtime
  value object
  version integer
  updated_by_user_id ObjectId nullable
  metadata object // config ownership, rollout, and UI extensions
  created_at datetime
  updated_at datetime
}

// app_configs[key=swoopstyl].value seed:
// {
//   "enabled": true,
//   "maxRadiusKm": 100,
//   "bands": [{"key":"near","maxKm":25}, {"key":"local","maxKm":60},
//             {"key":"extended","maxKm":100}],
//   "cutoffLocal": "14:00",
//   "maxHandlingHours": 8,
//   "minAvailableQty": 1,
//   "minCapacityHeadroom": 1,
//   "weights": {"distance":0.60,"relevance":0.20,"capacity":0.10,
//               "stock":0.05,"readiness":0.05},
//   "fitOrdering": "confirmed-bands-before-wildcard",
//   "heightBandCm": 15,
//   "weightBandKg": 10
// }

// app_configs[key=ai_runtime].value contains non-secret runtime policy only:
// {
//   "enabled": true,
//   "intentSchemaVersion": 1,
//   "timeoutMs": 4000,
//   "maxAttempts": 2,
//   "providerOrder": ["google"],
//   "fallback": "lexical"
// }
// Provider API keys and the internal gateway secret are server environment
// variables. They must never be stored in app_configs or any metadata object.

available_filter_cache [icon: filter, color: red] {
  id ObjectId pk
  cache_key string unique // SHA-256 of normalized filter/search context
  context object // query, selected filters, mode, pincode zone, policy version
  metadata_schema_version integer
  catalogue_revision integer
  payload object // complete frontend AvailableFiltersResponse JSON
  metadata object // cache diagnostics only; never part of filter semantics
  generated_at datetime
  expires_at datetime // generated_at + 300 seconds
}

// -----------------------------------------------------------------------------
// SELLER DRAFT + ONE-SHOT CLIENT AI WORKFLOW
// -----------------------------------------------------------------------------

product_drafts [icon: file-edit, color: pink] {
  id ObjectId pk
  created_by_user_id ObjectId
  seller_id ObjectId // always resolved to an approved seller
  brand_id ObjectId
  status string // draft | pending_review | approved | rejected
  title string
  description string nullable
  category_key string
  product_type_key string
  gender_keys string[]
  metadata object // controlled only by metadata_fields
  media object[] // ImgBB/source URLs and client-derived dimensions/palette; no image bytes
  offer object // price, variants, inventory and location ids; never generic metadata
  ai_proposal object nullable // last completed, still-untrusted proposal
  submitted_at datetime nullable
  reviewed_by_user_id ObjectId nullable
  reviewed_at datetime nullable
  rejection_reason string nullable
  published_product_id ObjectId nullable
  published_offer_id ObjectId nullable
  created_at datetime
  updated_at datetime
}

ai_processing_runs [icon: sparkles, color: pink] {
  id ObjectId pk
  draft_id ObjectId
  actor_user_id ObjectId
  input_hash string // SHA-256 of normalized text + client-processed image inputs
  contract_version integer
  metadata_schema_version integer
  allowed_filters_hash string
  provider string nullable
  model string nullable
  status string // reserved | completed | failed | expired
  proposal object nullable // strict client-returned structured JSON, validated by Python
  confidence number nullable
  warnings string[]
  error object nullable // safe provider code/message only; no keys or image bytes
  metadata object // timing/usage/idempotency diagnostics
  reserved_at datetime
  completed_at datetime nullable
  expires_at datetime
}

user_appearance_runs [icon: scan-face, color: pink] {
  id ObjectId pk
  user_id ObjectId
  input_hash string // consented form context + normalized image hashes
  image_hashes string[] // SHA-256 only; no image URL/bytes
  contract_version integer
  metadata_schema_version integer
  allowed_filters_hash string
  status string // reserved | completed | failed
  provider string nullable
  model string nullable
  proposal object nullable // color/style/fit/silhouette controlled values only
  confidence number nullable
  warnings string[]
  error object nullable
  consent boolean
  created_at datetime
  completed_at datetime nullable
  updated_at datetime
}

search_intent_runs [icon: search, color: pink] {
  id ObjectId pk
  input_hash string // server-verified normalized query+pincode+contract identity
  query string // original shopper text; never contains provider credentials
  contract_version integer
  metadata_schema_version integer
  allowed_filters_hash string
  status string // reserved | completed | failed
  provider string nullable
  model string nullable
  intent object nullable // strict ranges + controlled filters + lexical text
  confidence number nullable
  warnings string[]
  error object nullable // safe code/message only
  created_at datetime
  completed_at datetime nullable
  updated_at datetime
}

// One-shot flow:
// 1. Browser validates/converts the image, strips EXIF, creates WebP upload and
//    max-1024px AI input, extracts palette, and computes input_hash.
// 2. Python reserves unique(draft_id,input_hash,contract_version).
// 3. Browser uploads directly to ImgBB and calls one AI provider through the
//    hackathon-only public scheduler. Python never receives image bytes/calls AI.
// 4. Python validates the returned proposal against metadata_fields and stores it.
// 5. Seller/admin reviews and explicitly applies the proposal to product_drafts.

// Required TTL behavior:
// - MongoDB TTL index: expires_at, expireAfterSeconds: 0.
// - API treats expires_at <= now as a miss even before Mongo's TTL monitor deletes.
// - Cache is populated only on a miss; no Redis/in-memory facet cache.
// - metadata_schema_version/catalogue_revision/policy version are part of the key,
//   so changes naturally bypass older documents without mass invalidation.

// Frontend/Gemini filter contract stored in available_filter_cache.payload:
// {
//   "schemaVersion": 7,
//   "generatedAt": "...",
//   "expiresAt": "...",
//   "filters": [
//     {
//       "key": "metadata.style",
//       "label": "Style",
//       "control": "multi_select",
//       "operator": "in",
//       "values": [{"key":"gen-z","label":"Gen-Z","count":42,"selected":false}]
//     },
//     {
//       "key": "price",
//       "label": "Price",
//       "control": "range",
//       "min": 19900,
//       "max": 899900
//     }
//   ],
//   "sortOptions": ["relevance", "nearest", "price_low", "price_high", "rating"]
// }

// -----------------------------------------------------------------------------
// CART, MOCK ORDERS, IMPORTS, AUDIT
// -----------------------------------------------------------------------------

carts [icon: shopping-cart, color: cyan] {
  id ObjectId pk
  user_id ObjectId unique
  items object[] // offer/variant/qty + safe display snapshots
  subtotal_paise integer
  item_count integer
  metadata object // campaign/session extensions; never trusted for pricing
  updated_at datetime
}

orders [icon: package, color: cyan] {
  id ObjectId pk
  order_number string unique
  user_id ObjectId
  status order_status
  payment_status payment_status
  payment_method string
  currency string
  totals object // subtotal, delivery fee, total in paise
  address_snapshot object
  items object[] // immutable product/offer/seller/location/variant/price snapshots
  swoopstyl object // requested, eligible, distance, zone, policy/score/promise snapshot
  status_timeline object[] // also powers WhatsApp-update UI copy
  whatsapp_updates_requested boolean
  simulation_mode boolean
  metadata object // channel/campaign extensions; immutable business state stays explicit
  placed_at datetime
  updated_at datetime
}

import_jobs [icon: upload, color: gray] {
  id ObjectId pk
  filename string
  source string
  status import_status
  counts object // total, valid, imported, rejected
  mapping object
  simulation_seed string
  errors object[] // capped row/error summary for V1
  started_by_user_id ObjectId
  metadata object // importer version, source checksum, optional mappings
  started_at datetime
  completed_at datetime nullable
}

audit_logs [icon: clipboard-list, color: gray] {
  id ObjectId pk
  actor_user_id ObjectId nullable
  actor_role string nullable
  action string
  entity_type string
  entity_id string
  changes object // small before/after diff, not full product duplication
  metadata object // request id, import id, reason, source
  created_at datetime
}

// -----------------------------------------------------------------------------
// CONFIGURABLE WEB + VOICE AGENTS (GO CONTROL PLANE)
// -----------------------------------------------------------------------------
// Six collections only. Calls are also the outbound work queue, so there is no
// campaign_items collection and inbound/outbound never fork into separate tables.

ai_agents [icon: bot, color: pink] {
  id string pk // stable agent_* id; referenced by versioned swarm graphs
  key string unique
  name string
  description string
  channels string[] // web, voice
  direction string // interactive, inbound, outbound
  status string // draft, active, paused, archived
  is_default boolean
  revision integer
  instructions object // system, greeting, guardrails[], verified fallback
  model object // provider=openai, model, temperature, reasoning, output bound
  voice object nullable // Deepgram STT + Sarvam TTS/language/speaker/turn policy
  web object nullable // starters, history/result bounds, profile proposal policy
  tools object[] // explicit allowlist and per-tool config
  capture object // disposition JSON fields/questions required from the call
  metadata object // non-indexed extension/provenance; never secrets
  created_by string
  updated_by string
  created_at datetime
  updated_at datetime
}

agent_swarms [icon: git-branch, color: pink] {
  id string pk
  key string unique
  name string
  description string
  channels string[]
  directions string[]
  status string
  is_default boolean
  revision integer
  graph object // entryNodeKey, nodes(agentId+overrides), conditional edges; DAG only
  telephony object // shared E.164 line + managed trunks/rule + admin-editable human handoff number
  metadata object // non-indexed extension/provenance
  created_by string
  updated_by string
  created_at datetime
  updated_at datetime
}

campaigns [icon: megaphone, color: pink] {
  id string pk
  name string
  kind string // reusable automation key, e.g. abandoned_checkout
  swarm_id string
  entry_node_key string // campaign-selected start node in the swarm DAG
  language string // one of the 11 Bulbul v3 Indian language codes
  instructions object // campaign objective, greeting, and bounded system context
  capture object // campaign-specific questions/JSON fields merged with agent capture
  status string // draft, running, paused, completed, cancelled
  direction string // outbound only in V1
  from_number string // E.164, can be the same number used for inbound
  calling_window object // timezone + start/end
  retry_policy object // max attempts, backoff, retryable outcomes
  max_concurrency integer
  calls_per_second number
  counts object // scheduled, dispatched, completed, failed
  metadata object // source/audience extension; never credentials
  created_by string
  updated_by string
  created_at datetime
  updated_at datetime
}

provider_credentials [icon: key-round, color: pink] {
  id string pk
  provider string // openai, deepgram, sarvam
  encrypted_value string // AES-GCM ciphertext; never returned through admin APIs
  nonce string
  key_hint string // masked last characters for status UI
  status string // active, superseded, revoked
  expires_at datetime nullable // expired DB values automatically fall back to env
  metadata object // rotation reason/provenance; never plaintext credentials
  created_by string
  created_at datetime
  updated_at datetime
}

calls [icon: phone-call, color: pink] {
  id string pk
  tenant_id string
  campaign_id string nullable
  swarm_id string
  direction string // inbound or outbound in this one collection
  status string // pending, dispatching, ringing, active, completed, failed
  external_id string nullable // business identity; phone is contact data only
  idempotency_key string unique // campaignId:externalId or inbound:room
  from string
  to string
  attempt integer
  max_attempts integer
  scheduled_at datetime
  lease_until datetime nullable // atomic worker lease; stale leases are reclaimable
  graph_snapshot object // immutable DAG snapshot for this call
  current_node_key string
  agent_trace object[] // node entry/exit/reason for multi-level handoffs
  participant object // campaign input
  context object // call-specific facts/instructions
  livekit object // room, SIP/participant/dispatch ids
  transcript object[] // speaker, agentId, text, timestamp
  recording_url string nullable
  disposition object nullable // outcome, summary, captured fields, missing, next action
  failure object nullable
  metadata object // bounded extension/provenance; never secrets
  started_at datetime nullable
  answered_at datetime nullable
  ended_at datetime nullable
  created_at datetime
  updated_at datetime
}

ai_sessions [icon: messages-square, color: pink] {
  id string pk
  access_token_hash string // opaque browser session proof; raw token never stored
  user_id string nullable
  agent_id string
  swarm_id string nullable
  status string
  messages object[] // one bounded contextual chat + generative UI components
  profile_context object // ranking snapshot, not silently learned state
  metadata object // surface/locale/provenance
  expires_at datetime // TTL
  created_at datetime
  updated_at datetime
}

// -----------------------------------------------------------------------------
// RELATIONSHIPS
// -----------------------------------------------------------------------------

users.id - sellers.user_id
users.id < audit_logs.actor_user_id
sellers.id < seller_locations.seller_id
brands.id < sellers.brand_ids
brands.id < products.brand_id
colors.id < products.color_palette.color_id
products.id < seller_offers.product_id
sellers.id < seller_offers.seller_id
brands.id < seller_offers.brand_id
users.id < product_drafts.created_by_user_id
sellers.id < product_drafts.seller_id
brands.id < product_drafts.brand_id
product_drafts.id < ai_processing_runs.draft_id
users.id < ai_processing_runs.actor_user_id
users.id < user_appearance_runs.user_id
users.id - carts.user_id
users.id < orders.user_id
users.id < ai_sessions.user_id
ai_agents.id < agent_swarms.graph.nodes.agent_id
ai_agents.id < ai_sessions.agent_id
agent_swarms.id < campaigns.swarm_id
agent_swarms.id < calls.swarm_id
campaigns.id < calls.campaign_id

// -----------------------------------------------------------------------------
// REQUIRED INDEXES
// -----------------------------------------------------------------------------
//
// users:                  unique(email), sparse unique(phone_e164), index(roles,status)
// sellers:                unique(user_id), unique(slug), index(status)
// seller_locations:       2dsphere(geo_point), index(seller_id,status),
//                         index(pincode,swoopstyl_enabled,status)
// brands:                 unique(normalized_name), unique(slug), multikey(aliases)
// pincode_geos:           unique(country_code,pincode), 2dsphere(geo_point)
// metadata_fields:        unique(key), index(status,frontend_visible,sort_order)
// colors:                 unique(key), unique(normalized_name), multikey(aliases),
//                         multikey(family_keys)
// products:               unique(source,source_product_id) sparse, unique(slug),
//                         index(status,visibility,category_key,product_type_key),
//                         compound(status,visibility,metadata.<field>) for
//                         aesthetic,dress_code,material,mood,occasion,season,
//                         style,theme hybrid candidate retrieval,
//                         wildcard(metadata.$**) only when local query fallback needs it
// seller_offers:          unique(offer_code), index(product_id,status),
//                         index(seller_id,status), multikey(location_ids),
//                         multikey(available_size_keys), multikey(available_color_ids),
//                         multikey(available_color_family_keys),
//                         index(fit_bounds.applicable,fit_bounds.minHeightCm,
//                               fit_bounds.maxHeightCm,fit_bounds.minWeightKg,
//                               fit_bounds.maxWeightKg),
//                         index(age_bounds.applicable,age_bounds.minAge,
//                               age_bounds.maxAge)
// available_filter_cache: unique(cache_key), TTL(expires_at,expireAfterSeconds=0)
// product_drafts:         index(created_by_user_id,updated_at desc),
//                         index(seller_id,status), index(brand_id,status)
// ai_processing_runs:     unique(draft_id,input_hash,contract_version),
//                         index(actor_user_id,status,reserved_at desc),
//                         TTL(expires_at,expireAfterSeconds=0) only for failed/
//                         expired reservations when using a partial TTL policy
// user_appearance_runs:   unique(user_id,input_hash,contract_version),
//                         index(user_id,created_at desc)
// search_intent_runs:     unique(input_hash,contract_version,allowed_filters_hash),
//                         index(status,created_at desc)
// search_query_failures:  unique(query_hash),
//                         index(status,occurrences desc,last_seen_at desc),
//                         TTL(expires_at,expireAfterSeconds=0)
// taxonomy_reconciler_graphs: unique(key,version), index(key,active)
// taxonomy_retag_proposals: unique(proposal_key),
//                         index(status,confidence desc,updated_at desc),
//                         index(product_id,graph_version desc)
// taxonomy_reconciliation_runs: unique(run_id), index(started_at desc)
// taxonomy_reconciler_state: unique(key)
// carts:                  unique(user_id)
// orders:                 unique(order_number), index(user_id,placed_at desc),
//                         index(items.sellerId,placed_at desc)
// audit_logs:             index(entity_type,entity_id,created_at desc)
// ai_agents:              unique(key), index(channels,direction,status),
//                         partial uniqueness for active defaults per channel/direction
// agent_swarms:            unique(key), index(channels,directions,status)
// campaigns:              index(status,updated_at desc), index(swarm_id,created_at desc)
// provider_credentials:   index(provider,status,updated_at desc), sparse(expires_at)
// calls:                  unique(idempotency_key),
//                         index(campaign_id,status,scheduled_at),
//                         index(direction,created_at desc), sparse(livekit.room_name)
// ai_sessions:            TTL(expires_at,expireAfterSeconds=0),
//                         index(user_id,updated_at desc)

// Atlas Search inverted index (not another collection):
// - products.title: autocomplete + string
// - products.description/search_text: string
// - products.category_key/product_type_key/gender_keys: token/string
// - products.metadata: dynamic mapping for registry-controlled keys only
// - products.rating.average: number
// Search filters price/stock/size/color/seller/location through active offers;
// the final facet JSON is cached in available_filter_cache for five minutes.

// Hackathon product-AI request path (AI never reads MongoDB directly):
// 1. Browser loads the Mongo-controlled metadata contract and product options.
// 2. Browser normalizes the image, uploads it directly to ImgBB, then creates a
//    fully valid ProductDraft containing URLs, offer, variants and inventory.
// 3. FastAPI reserves unique(draftId,inputHash,contractVersion).
// 4. The browser scheduler uses the Vercel AI SDK to call one provider and
//    validates its response with Zod enums built from that exact contract.
// 5. FastAPI checks the version/hash and validates every field again with
//    Pydantic plus metadata_fields before storing a proposal.
// 6. Human review PATCHes the draft; submission enters pending_review and only
//    owner/admin approval publishes Product + SellerOffer.
// 7. Timeout/provider/schema failure leaves the canonical draft manually usable.

// Hackathon natural-language search path:
// 1. FastAPI loads the current Mongo-controlled taxonomy and trained PMI graph.
// 2. Unicode normalization plus edit/bigram-cosine probability repairs likely
//    malformed commerce/context tokens without rewriting the original query.
// 3. Exact aliases, learned catalogue relationships and the reconciler graph
//    compile into allowlisted field:value dimensions with confidence weights.
// 4. Explicit shopper filters remain hard; inferred context is an indexed OR
//    candidate predicate and never a brittle cross-facet intersection.
// 5. MongoDB calculates sparse-vector cosine similarity, blends residual text
//    relevance, takes top-K products, then joins active offers and paginates.
// 6. API responses expose corrections, ranking dimensions and scores so the
//    retrieval decision is debuggable and reproducible.
// 7. Page-one zero results are redacted/aggregated in search_query_failures;
//    a four-level graph fallback may return eligible inventory without changing
//    the original intent record.
// 8. A protected cron rebuilds the allowlisted undirected taxonomy graph only
//    when taxonomy/failure fingerprints change, then stages evidence-backed
//    retag proposals. AI context edges never write products directly.

// -----------------------------------------------------------------------------
// VALIDATION + WRITE RULES
// -----------------------------------------------------------------------------
//
// 1. The API loads active metadata_fields into a short request-local validator.
//    Product.metadata cannot contain undeclared keys or invalid values/types.
// 2. Every collection exposes metadata for extensions, with two explicit modes:
//    - Product.metadata: registry-controlled, filterable/searchable when enabled.
//    - Other metadata plus Product.system_metadata: namespaced, non-filterable,
//      non-indexed, size-limited extension data. Never store secrets, required
//      lifecycle state, ownership, money, stock, permissions, or delivery inputs.
// 3. Promote an extension key to a first-class field or metadata_fields entry
//    when it becomes required, frequently queried, sorted, filtered, or indexed.
// 4. New seller metadata options are allowed immediately only through the
//    metadata option endpoint, which normalizes, deduplicates, aliases, audits,
//    increments schema_version, and advances catalogue_revision.
// 5. Product core keys, offer size/color keys, Gemini filters, admin forms, and
//    storefront controls all use the same metadata option keys.
// 6. SwoopStyl is evaluated after product relevance: approved seller, resolved
//    active location, radius, positive stock, capacity headroom, handling/cutoff.
//    Gemini can never set eligibility, distance, score, or delivery promise.
// 7. Mock checkout writes Order snapshots only. It does not reserve/decrement
//    offer inventory or mutate seller location capacity/load.
// 8. Imported/generated values carry simulation_mode=true and remain traceable
//    through source ids, import job, simulation seed, and audit metadata.
// 9. AI candidate JSON is untrusted input. Only FastAPI-validated, human-reviewed
//    draft fields may reach publication. Browser/provider code receives no
//    MongoDB, JWT, or owner credentials.
// 10. Every offer variant has exactly one colorId and one fitRange envelope.
//     Wearable variants carry numeric height/weight ranges; non-body-fit items
//     explicitly use applicable=false with null bounds. AI may propose fit data,
//     but seller/admin confirmation is required before simulated values become real.
// 11. Profile recommendations convert height to 15 cm bands and weight to 10 kg
//     bands. Confirmed overlapping fit envelopes rank before wildcard envelopes;
//     SwoopStyl keeps its distance-first weighted score within each fit tier.
