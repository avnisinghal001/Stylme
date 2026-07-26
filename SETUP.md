# StylMe setup and handoff

This repository is one workspace containing the storefront/admin app, catalogue API, AI control plane, voice worker, and catalogue migration tools. The root commands are the supported entry points.

## 1. Prerequisites

- Node.js 20+ and npm 10+
- Python 3.12 (the voice worker supports 3.10–3.14, but using 3.12 everywhere is simplest)
- Go 1.26+
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/) for the LiveKit Python workspace
- A reachable MongoDB deployment
- Optional for calls: a LiveKit Cloud project, the `lk` CLI, and a Twilio Elastic SIP Trunk/voice-capable number

The setup command installs [Air](https://github.com/air-verse/air) with `go install`; no separate Air install is required.

## 2. Configure the environment

From the repository root:

```bash
cp .env.example .env
```

At minimum, set `MONGODB_URL`, `JWT_SECRET`, `OWNER_EMAIL`, `OWNER_PASSWORD_HASH`, and `AI_INTERNAL_API_KEY`. Use separate long random values for `JWT_SECRET`, `AI_INTERNAL_API_KEY`, `CRON_SECRET`, and `CREDENTIAL_ENCRYPTION_KEY` in production.

Initialize database indexes and managed metadata once after configuring the environment, and again after a release adds indexes:

```bash
npm run db:init
```

`MONGO_ENSURE_INDEXES_ON_STARTUP=false` is intentional for Vercel/serverless deployments; schema/index migrations must not run on every cold request. Long-running local services may set it to `true`, although the explicit command is preferred.

Generate random secrets immediately; run the bcrypt command after `npm run setup` has created the backend environment:

```bash
openssl rand -hex 48
backend/.venv/bin/python -c "from passlib.context import CryptContext; print(CryptContext(schemes=['bcrypt']).hash('replace-this-password'))"
```

Do not add a `NEXT_PUBLIC_` prefix to MongoDB, auth, provider, LiveKit, or Twilio secrets. The browser can read every `NEXT_PUBLIC_` value.

## 3. Install everything

```bash
npm run setup
```

The command runs these independent workspaces in parallel:

- `frontend`: `npm install`
- `backend`: creates `.venv` and installs `requirements-dev.txt`
- `data`: installs Node and Python migration dependencies
- `Go-Backend`: downloads Go modules and installs Air
- `Livekit-Agent`: runs `uv sync --dev` and downloads agent model files

For a faster setup that deliberately defers local voice model downloads:

```bash
SETUP_SKIP_VOICE_MODELS=1 npm run setup
```

Rerunning setup is safe and refreshes dependencies without recreating existing virtual environments.

## 4. Run locally

```bash
npm run dev
```

This starts and supervises three development processes:

| Service | Address | Reload behavior |
|---|---|---|
| Next.js storefront/admin | `http://localhost:3000` | Next development reload |
| FastAPI catalogue API | `http://localhost:8000` | Uvicorn `--reload` |
| Go AI control plane | `http://localhost:8081` | Air rebuild/restart via `Go-Backend/.air.toml` |

`Ctrl-C` terminates all children. If one service fails, the runner terminates the others so a half-running local stack is obvious.

Start the voice worker too:

```bash
npm run dev:all
```

Or run only the voice worker:

```bash
npm run voice:dev
```

Smoke checks:

```bash
curl http://localhost:8000/api/v1/health
curl http://localhost:8081/health
curl http://localhost:3000
```

FastAPI's interactive `/docs` route is available only when `DEBUG=true`.

## 5. Initialize and verify MongoDB

FastAPI and Go create their owned indexes/default records on startup. The catalogue migration is explicit because it changes managed product data.

### Current handoff state (20 July 2026)

The original `StylMe` database is deliberately still present with 30 collections, 50,000 pipeline-managed products, and 50,000 matching offers. A full copy was made to the destination and every collection passed BSON SHA-256 and index-definition comparison. The later 80,000-product expansion was stopped on request, after a destination-only managed-catalogue prune and partial product upserts. The frozen destination therefore has 47,819 managed products and 30,344 matching offers; it is not an exact copy anymore. FastAPI and Go production deployments point to this destination.

Do **not** delete the source based on this handoff state. `npm run mongo:delete-source-after-80k` is intentionally guarded by both a valid full-copy report and a valid live 80,000-product/offer report; the latter does not exist for the interrupted run.

### Reproducing or completing the catalogue

Place these source files in `data/raw/`:

- `myntra-product.csv`
- `myntra202305041052.csv`

The raw datasets are intentionally excluded from the share ZIP because they are very large and may have separate redistribution terms.

The cross-cluster copy command copies all collections/documents/indexes and writes a credential-free verification report:

```bash
# Set MIGRATE_DESTINATION_MONGO_URI in the private root .env first.
npm run mongo:migrate
```

Only use an empty destination when an exact clone is required. The command never deletes destination extras; an extra or mismatched document makes verification fail.

The optional curated target is 80,000 products. It requires enough Atlas storage for products, offers, and indexes:

```bash
npm run catalogue:migrate
```

That command:

1. reads the active `metadata_fields` registry from MongoDB;
2. merges it with the local 28-field contract;
3. selects 80,000 image-backed apparel products with strict intimate/sleep/swim/underlayer exclusions;
4. prioritizes festive, Gen Z, Gen Alpha, dress, and youth signals;
5. validates every taxonomy value and entity reference;
6. upserts registry fields, entities, products, and offers;
7. prunes only obsolete pipeline-managed Myntra products/offers after successful upserts;
8. invalidates derived filter cache entries and verifies the live database.

Individual stages are available as `npm run catalogue:build`, `catalogue:validate`, and `catalogue:verify`. The seeder uses deterministic keys, progress markers, transient-write retries, and delayed pruning. A successful live verification must show exactly 80,000 managed products and 80,000 matching offers before any source deletion is considered.

## 6. LiveKit Cloud and Twilio SIP

The recommended production path is LiveKit Cloud plus the existing `Livekit-Agent` worker. LiveKit supports third-party SIP providers such as Twilio; an inbound trunk accepts calls, a dispatch rule chooses the room/agent, and an outbound trunk is used when `CreateSIPParticipant` places a call. See the current [LiveKit SIP setup](https://docs.livekit.io/telephony/start/sip-trunk-setup/) and [dispatch-rule guide](https://docs.livekit.io/telephony/accepting-calls/dispatch-rule/).

1. Create a LiveKit Cloud project and copy `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` into the deployment secret store and local `.env`.
2. In Twilio, create an Elastic SIP Trunk, buy/attach a voice-capable number, configure a Termination URI plus credentials for outbound calls, and set the trunk Origination URI to the LiveKit SIP endpoint for inbound calls. Keep phone numbers in `+E.164` form. Twilio distinguishes termination (your infrastructure to PSTN) from origination (PSTN to your infrastructure); see [Twilio Elastic SIP Trunking](https://www.twilio.com/docs/sip-trunking).
3. In LiveKit Cloud, create an inbound trunk restricted to the purchased number/provider, an outbound trunk pointing at the Twilio termination endpoint, and an explicit dispatch rule for agent `stylme-voice`. LiveKit recommends explicit agent dispatch for inbound numbers.
4. Bind the resulting server-managed IDs to both default swarms and the recovery campaign:

```bash
cd Go-Backend
go run ./cmd/bind-telephony \
  -inbound ST_inbound_id \
  -outbound ST_outbound_id \
  -dispatch SDR_dispatch_id \
  -phone +15551234567 \
  -agent stylme-voice
```

5. Test locally with `npm run voice:dev`. Deploy the agent from `Livekit-Agent` using the LiveKit CLI when ready; LiveKit Cloud builds the container, injects secrets, and manages agent capacity. Current deployment guidance is in [LiveKit agent deployment](https://docs.livekit.io/deploy/agents/).

The browser never receives trunk IDs, SIP credentials, API secrets, or provider keys. The admin UI may configure the human handoff number only; the Go binding CLI preserves server-managed telephony fields.

## 7. Scheduled jobs

For a long-running Go service, set `CALL_WORKER_ENABLED=true`; its internal dispatcher polls at `CALL_WORKER_INTERVAL`, so do not also schedule the dispatch endpoint.

For serverless Go deployment, leave the worker disabled and invoke:

```text
POST https://<go-host>/v1/runtime/dispatch?limit=5
X-Internal-Key: <AI_INTERNAL_API_KEY>
```

every minute. Schedule abandoned-checkout orchestration every five minutes:

```text
POST https://<go-host>/v1/workflows/abandoned-checkout
X-Internal-Key: <AI_INTERNAL_API_KEY>
Content-Type: application/json

{"limit":100}
```

The Go workflow securely fetches eligible candidates from FastAPI and dispatches up to the campaign concurrency. The legacy FastAPI-only recovery endpoint (`GET /api/v1/public/checkout-recovery/run` with `X-Cron-Secret`) is an alternative, not an additional job; do not enable both recovery schedulers.

## 8. Search taxonomy reconciliation cron

Advanced search automatically records page-one zero-result queries in `search_query_failures`. Queries are normalized, email/phone/card-like values are redacted, and repeated failures aggregate by a stable hash. Searches that later succeed mark the aggregate as recovered. AI or voice systems that search outside FastAPI can submit the same outcome through:

```text
POST /api/v1/internal/taxonomy-reconciler/search-outcome
X-Internal-Key: <AI_INTERNAL_API_KEY>
Content-Type: application/json

{"query":"clothes for udaipur","resultCount":0,"source":"ai","intent":{},"resolvedQuery":{}}
```

Run the reconciler daily or after a material taxonomy/catalogue update:

```text
POST /api/v1/public/taxonomy-reconciler/run
X-Cron-Secret: <CRON_SECRET>
Content-Type: application/json

{
  "maxQueries":30,
  "maxProducts":250,
  "graphDepth":4,
  "useAi":true,
  "rebuildGraph":false,
  "apply":true
}
```

For cron-job.org or another external scheduler, use the protected POST request above. The API also supports Vercel Cron's `GET` plus `Authorization: Bearer <CRON_SECRET>` convention if that scheduler is configured later. Use exactly one scheduler. The safe Vercel GET default is `TAXONOMY_RECONCILER_CRON_APPLY=false`, which builds the graph and stages proposals without changing product tags; set it to `true` only after reviewing live proposals and the confidence threshold.

`apply=true` does not accept arbitrary model output. It applies only allowlisted proposals that have direct product-text evidence or extremely strong catalogue co-occurrence, meet `TAXONOMY_RECONCILER_AUTO_APPLY_CONFIDENCE`, and still fit the field's current selection limit. AI-only context edges remain proposals for admin review. Start with `apply=false` while evaluating real failed-query traces.

The graph is rebuilt only when the live taxonomy or selected failure-query fingerprint changes, unless `rebuildGraph=true`. The OpenAI request uses the Responses API, `store=false`, low reasoning, and [strict Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs); provider failure falls back to the deterministic taxonomy/catalogue graph. Configure `OPENAI_API_KEY` and `TAXONOMY_RECONCILER_MODEL` to enable that optional pass.

The repository also includes a versioned 100-query Indian commerce demand pack covering Hindi, transliterated Hindi, Hinglish, and Indian English. It includes phrases such as `sundar`, `ekdam pretty`, `loose fit ka`, `white color ka`, `फूलों वाला`, wedding/college/festival needs, regional intent, moods, fabrics, and Gen Z/Gen Alpha language. Run it from the repository root:

```bash
npm run taxonomy:demand:seed       # idempotently seed the 100 demand queries
npm run taxonomy:retag:dry         # rebuild and inspect one batch; no product writes
npm run taxonomy:retag:full        # deterministic full-catalogue pass
npm run taxonomy:retag:resume      # continue from the persisted product cursor
npm run taxonomy:retag:full:ai     # optional graph rebuild with AI enrichment
```

`taxonomy:retag:full` resets the cursor and covers every eligible product, so it is the safest command after an interrupted or uncertain pass. The implementation caches graph traversal indexes once per batch, stages new proposals with one indexed existence read plus an unordered insert, prefetches all selected products in one query, and consolidates accepted values into one update per product. Existing proposal/admin states are never overwritten. At most 12 proposals are staged for a product and at most two per field; direct lexical matches auto-apply, while supported co-occurrence-only rows remain reviewable unless they meet the stricter policy threshold.

The 2026-07-24 production data pass seeded all 100 queries, scanned 47,725 eligible products, applied 102,585 controlled tag additions across 40,605 products, and left 75 co-occurrence proposals for human review. Audits confirmed zero updated forbidden product types, zero forbidden-text products, zero non-allowlisted applied fields, no active reconciler lock, and no running reconciliation record.

Admin endpoints:

- `GET /api/v1/admin/taxonomy-reconciler/queries`
- `GET /api/v1/admin/taxonomy-reconciler/runs`
- `GET /api/v1/admin/taxonomy-reconciler/proposals`
- `PATCH /api/v1/admin/taxonomy-reconciler/proposals/{id}/decision`
- `POST /api/v1/admin/taxonomy-reconciler/proposals/apply`
- `GET /api/v1/admin/taxonomy-reconciler/graph?includeGraph=true`
- `POST /api/v1/admin/taxonomy-reconciler/graph/preview`

The search fallback has four maximum levels: remove only failed lexical text; relax merchandising filters; retain only price/gender; then show broad eligible inventory ranked by graph signals. The API reports the selected level and whether a SwoopStyl delivery promise was relaxed. Forbidden intimate/sleep/swim/hosiery/thermal products remain excluded by both product type and product text at every fallback level and from retag scans.

Normal advanced search uses the same taxonomy intelligence before fallback. `POST /api/v1/search/advanced` normalizes the query, applies exact English/Hindi/Hinglish rules, repairs likely misspellings with edit-distance plus character-bigram cosine probability, expands Indian/occasion/mood concepts through the graph, and builds a weighted sparse taxonomy vector. MongoDB first selects products matching at least one semantic dimension, computes cosine similarity plus optional text relevance, retains the top-K candidate set, and only then joins active offers. Explicit URL filters remain hard constraints; contextual graph signals are ranking dimensions, not brittle AND filters.

Input classification is deterministic: textual labels are compared only with active database taxonomy labels/aliases; descriptor words such as `color`, `colour`, `rang`, and `रंग` are removed after their colour value is resolved so they cannot accidentally become lexical constraints; currency-marked amounts such as `Rs 5600` become a maximum budget; `under`, `lower than`, `cheaper than`, `at most`, `above`, `higher than`, and range phrases set the corresponding price bounds. A six-digit number is treated as a pincode only when SwoopStyl/one-day search is active and the number is the final query token. Sending a pincode while `swoopstyl=false` never applies a location filter.

Indirect language is expanded before retrieval. Activity verbs (`fast moving`, `running around`, `dance all night`), desired effects (`command the room`, `turn heads`), comfort/weather constraints, mood descriptions, recipient pronouns, and major Indian city contexts contribute soft ranking dimensions. Pronouns never become hard demographic filters. City signals are limited to broad climate, travel, occasion, and merchandising context; they do not assert culture or identity. The cron-time AI follows the same controlled contract when proposing new graph edges from failed searches, so request-time search can remain fast and auditable.

For simulated catalogue environments, an idempotent zone repair can add offer inventory to approved, already-serviceable seller locations without deleting existing inventory:

```bash
npm run swoopstyl:backfill -- --pincode 560041 --radius-km 100        # dry run
npm run swoopstyl:backfill -- --pincode 560041 --radius-km 100 --apply
```

Useful smoke queries:

```text
best clothes in udaipur
udaipur styled cloth
birthday wear
minimal
happy mood
funky personality
udipur styld clth
brthday wer
red floral cotton kurta lower than Rs 5600 swoopstyl 560041
fast moving clothes under Rs 3000
something to command the room
nothing loud for a chill day
best clothes in Mumbai
hot weather clothes in Chennai
```

The response exposes `intent.corrections`, `intent.rankingVector`, `intent.retrieval`, per-product `searchScore`, and page-level `retrieval`. These fields make the hackathon behavior inspectable without exposing private model prompts or accepting invented taxonomy values.

## 9. Tests and packaging

```bash
npm test
npm run test:e2e
npm run package:share
```

The end-to-end suite starts the storefront against the production-compatible API contract and checks desktop plus mobile filter behavior in Chromium. It verifies stable option ordering, preservation of draft selections when the mobile drawer closes, exact URL serialization, and state rehydration after navigation. `npm run setup` installs the required Chromium build.

The package command produces `dist/stylme-share-YYYY-MM-DD.zip` and a matching `.sha256` checksum. It excludes `.env`, raw/processed datasets, dependency folders, virtual environments, build caches, nested Git data, deployment state, and test artifacts. It includes `.env.example`, both setup/design guides, source, tests, manifests, and lockfiles.

## 10. Troubleshooting

- `air` missing: rerun `npm run setup`; the dev runner also looks directly in `go env GOBIN` or `go env GOPATH` `/bin`.
- MongoDB timeout/TLS error: allow the machine/deployment egress IP in Atlas and verify that special characters in the URI password are URL-encoded.
- FastAPI starts but the UI cannot connect: verify `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1` and `CORS_ORIGINS`.
- Go health fails: verify MongoDB plus `JWT_SECRET`, `AI_INTERNAL_API_KEY`, and `PYTHON_API_BASE_URL`.
- Voice worker exits during validation: set LiveKit credentials, provider keys used by the configured agents, and run `uv run -m livekit.agents download-files` in `Livekit-Agent`.
- SIP 403/no response: confirm Twilio credential/ACL settings, LiveKit trunk IDs, E.164 numbers, provider signalling/media allow-lists, and the dispatch rule.
- Reconciler cron returns 409: another run holds the bounded workflow lock; wait for its expiry or inspect `taxonomy_reconciliation_runs` before retrying.
- Reconciler produces no AI edges: verify `OPENAI_API_KEY`, review the run's credential-free `ai.reason`, and confirm failed queries exist. Deterministic graph/fallback behavior remains active without the provider.
- Retag proposal remains staged: AI-only edges and evidence below the automatic confidence threshold require an admin decision by design.

## 11. Context for an AI setup assistant

Give an assistant this file, `SYSTEM_DESIGN.md`, `.env.example`, and the exact failing command/output. Tell it:

- the repository root is the only local environment source;
- MongoDB taxonomy is authoritative and must be merged, never blindly replaced;
- `myntra_detailed` and `myntra_large` are the only catalogue records the migration may prune;
- no underwear, lingerie, intimate, sleepwear, swimwear, hosiery, or thermal underlayer product may pass the curated policy;
- browser code must never receive secrets or server-managed telephony identifiers;
- long-running dispatch and external dispatch cron are mutually exclusive;
- taxonomy reconciliation never invents metadata values, never infers identity-like facets through contextual paths, and never reintroduces forbidden product types;
- search must remain available when failure capture, the graph, or the AI provider is unavailable;
- every code change must keep relevant Python, Go, frontend, data, and voice tests passing.
