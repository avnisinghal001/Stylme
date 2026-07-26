# StylMe web + voice agent architecture

## Decision

StylMe uses a small Go control plane and keeps the existing FastAPI service as
the catalogue/domain API. The Go service owns configurable agents, swarm DAGs,
campaign scheduling, the unified call lifecycle, short-lived AI web chats, and
LiveKit dispatch. It does not copy product, cart, order, profile, or seller
logic.

The implementation is in `Go-Backend/`. Its six Mongo collections are defined
in `schema.md` and seeded with three editable defaults:

1. `stylme-web-stylist`: contextual generative UI and controlled catalogue search.
2. `stylme-inbound-concierge`: one fast multilingual intake/router with direct specialist handoff.
3. `stylme-outbound-stylist`: consent-aware campaign calls and immediate opt-out.

## What was retained from Samora

The useful production patterns from `Desktop/Samora/b2b-agent-be` and its
workflow service were kept:

- The external/business ID is the idempotency identity; a phone number is only
  contact data.
- Campaign writes are status-gated and terminal campaigns cannot be restarted.
- Pending calls are atomically leased, and expired leases can be reclaimed.
- Each call stores a graph snapshot so later agent edits cannot rewrite history.
- Activity moves forward with explicit states, retry limits, and per-record errors.
- Inbound and outbound telephony both resolve through a tenant-owned number/trunk
  binding.

The unrelated Samora surface—billing, CRM, several telephony providers, Redis
coordination, AWS plumbing, separate inbound/outbound schemas, and duplicated
workflow tables—was intentionally left out. A Samora demo frontend also contains
hardcoded third-party credentials; those values must be rotated and are not
copied into StylMe.

## Collections

| Collection | Responsibility | Important invariant |
|---|---|---|
| `ai_agents` | Web/voice instructions, model/voice config, tools, capture fields | Every edit increments `revision` |
| `agent_swarms` | Reusable single-agent or multi-agent DAG | Server rejects cycles and unknown nodes |
| `campaigns` | Calling policy and aggregate counts | Only outbound; terminal state is sticky |
| `calls` | One inbound/outbound ledger and outbound queue | Unique `idempotency_key` |
| `ai_sessions` | One bounded web chat and generative components | TTL deletion; opaque session token stored only as SHA-256 |
| `provider_credentials` | Rotatable provider keys encrypted with AES-GCM | Browser/admin reads never return plaintext; DB-active key wins, environment is fallback |

Campaign recipients become pending documents in `calls`. This is why a separate
campaign-items collection is unnecessary and why a 30,000-contact campaign does
not risk MongoDB's per-document size limit.

## Web AI flow

```text
Hero AI Mode
  -> create short-lived ai_session
  -> load default web agent + FastAPI /filters + optional authenticated profile
  -> OpenAI emits strict JSON search plan
  -> Go removes any value not present in the live filter contract
  -> one FastAPI /search/advanced request
  -> generative filter chips + real product cards
  -> optional durable profile proposal (never automatically committed)
```

The navbar and `/search` remain deterministic and do not call an LLM. The AI
entry is explicitly labelled `AI Mode`, then opens a separate full-screen chat
so shoppers never confuse the two search modes.

## Voice flow

```text
Twilio number
  inbound -> LiveKit inbound trunk -> dispatch rule -> stylme-voice worker
  outbound <- LiveKit outbound trunk <- Go atomically claims a pending call

LiveKit worker
  -> obtains call/swarm graph snapshot from Go using X-Internal-Key
  -> Deepgram Nova-3 multilingual STT
  -> OpenAI LLM using the current node instructions/tools
  -> Sarvam bulbul:v3 TTS
  -> one mixed intake/router hands directly to the matching specialist
  -> a human escalation runs LiveKit WarmTransferTask
     -> caller is held while the admin-configured number is called
     -> the human hears a private context summary and accepts
     -> LiveKit moves the human into the caller's original room
     -> the AI disconnects while caller and human continue
  -> on room shutdown sends transcript to Go
  -> Go generates one disposition against every visited agent's capture contract
```

The LiveKit worker also enforces each voice agent's configured maximum call
duration. The outbound dispatcher enforces campaign status, timezone-aware
calling windows, retry limits, and maximum active-call concurrency before it
dials. Calls outside the window are returned to the pending queue for the next
opening; they are not counted as attempts.

Bulbul v3 is constrained to its 11 supported Indian language codes: English,
Hindi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Marathi, Punjabi,
and Odia. Each campaign selects one code; the same reusable graph can therefore
serve region-specific campaigns without cloning an agent.

### Campaign/graph decision

Five approaches were evaluated: cloning an agent for every campaign; hardcoded
campaign prompts; a separate workflow document per campaign; reusable agents
plus a swarm DAG with campaign overrides; and LLM-generated graphs. The selected
design is the fourth: campaigns choose the DAG's starting node and provide the
objective, greeting, language, instructions, and capture contract. It preserves
one auditable agent configuration, supports a single-node outbound graph or a
multi-level handoff, and avoids uncontrolled graph mutation.

## Runtime boundaries

- Browser-visible variables: only `NEXT_PUBLIC_AI_API_BASE_URL`.
- Server secrets: OpenAI, Deepgram, Sarvam, LiveKit, Twilio, JWT, and the internal
  runtime key. None receives a `NEXT_PUBLIC_` prefix.
- Agent Studio can rotate OpenAI, Deepgram, and Sarvam keys. Keys are encrypted
  before MongoDB storage, never returned to the browser, and fall back to the
  deployment environment when missing or expired.
- The root `.env` is the one local source. `next.config.ts`, FastAPI, Go, and the
  LiveKit worker resolve it from the repository root; production platforms must
  receive the same values through their secret settings.
- `CALL_WORKER_ENABLED=true` is valid only on a long-running Go deployment, not
  a request-only Vercel function.

## Deployment order

1. Deploy FastAPI and verify `/api/v1/health`, `/filters`, and `/search/advanced`.
2. Deploy the Go service with Mongo, JWT, OpenAI, FastAPI URL, LiveKit, and the
   internal key. Enable the call worker only there.
3. Set `NEXT_PUBLIC_AI_API_BASE_URL` in the frontend deployment and redeploy.
4. Deploy `Livekit-Agent` in LiveKit Cloud (Mumbai `ap-south` is the closest
   region for Indian calls) with the provider keys and Go runtime URL.
5. Configure Twilio/LiveKit trunks and copy the returned trunk/dispatch IDs into
   the default swarms in Agent Studio.

## Current deployment

- Storefront: `https://stylme-swoopstyl.vercel.app`
- Agent Studio: `https://stylme-swoopstyl.vercel.app/admin/agents`
- Go control plane: `https://stylme-ai-control-plane.vercel.app`
- Catalogue API: `https://stylme-swoopstyl-api.vercel.app/api/v1`
- LiveKit Cloud worker: `stylme-voice`, deployed in `ap-south` and running

The shared Twilio caller number, LiveKit inbound/outbound trunks, and individual
dispatch rule are bound to both default swarms and the checkout-recovery
campaign. Future number or trunk rotations can use `cmd/bind-telephony`.
The live human destination is intentionally different: an owner/admin edits it
in the inbound workflow settings, and the default is `+918126679138`.

## External cron contracts

Vercel Cron is not used. Point any external scheduler at this endpoint:

```http
POST https://stylme-ai-control-plane.vercel.app/v1/runtime/dispatch?limit=5
X-Internal-Key: <AI_INTERNAL_API_KEY; if empty, use CRON_SECRET>
```

There is no request body and the secret must stay in the header, never in the
URL. The bounded `limit` is 1–10. A `202` response means at least one pending
call was dispatched; `200` with no dispatched calls means none is currently eligible; `401` means the
header is missing or invalid. Run the scheduler no faster than once per second
for the default one-call-per-second policy. The endpoint itself still blocks
paused/draft/terminal campaigns, calls outside the configured local-time
window, and calls above `maxConcurrency`.

Example without printing the secret:

```bash
curl --request POST \
  --header "X-Internal-Key: $AI_INTERNAL_API_KEY" \
  'https://stylme-ai-control-plane.vercel.app/v1/runtime/dispatch?limit=5'
```

For the built-in abandoned checkout campaign, schedule this every five minutes:

```bash
curl --request POST \
  --header "X-Internal-Key: $AI_INTERNAL_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{"campaignId":"campaign_default_checkout_recovery","limit":100}' \
  https://stylme-ai-control-plane.vercel.app/v1/workflows/abandoned-checkout
```

That endpoint discovers eligible FastAPI checkout records, creates idempotent
call rows, and attempts an initial safe batch. Keep the one-minute dispatch cron
as the queue drain for calls delayed by concurrency or the calling window.

## Direct outbound trigger (Samora-compatible)

For a single immediate call without a campaign, use Samora's compact request
shape. The endpoint is generic: any active outbound swarm/agent can be selected,
and arbitrary business context stays inside controlled `metadata`, `context`,
and `participant` objects.

```http
POST https://stylme-ai-control-plane.vercel.app/v1/call/trigger
X-API-Key: <AI_INTERNAL_API_KEY; if empty, use CRON_SECRET>
Content-Type: application/json
```

```json
{
  "agent_id": "agent_default_outbound_stylist",
  "to_number": "+918200962735",
  "external_id": "demo-shopper-001",
  "metadata": {
    "idempotency_key": "manual-demo-001",
    "customer_name": "Riya Mehta",
    "preferred_language": "Hindi",
    "source": "manual_demo"
  },
  "context": {
    "intent": "Recommend a festive outfit under INR 2500",
    "size": "M",
    "delivery_pincode": "560001"
  }
}
```

`swarm_id`, `from_number`, and `participant` are also accepted. Missing IDs use
the default outbound swarm; a supplied agent must be part of the selected swarm.
All numbers are strict E.164 and the entire payload is capped at 16 KiB. A
successful LiveKit/SIP dispatch returns `202` and a real `call_id`; repeated
idempotency keys return the existing call without dialing again. The worker
loads the call's immutable graph snapshot plus its metadata/context, clearly
marked as untrusted factual data so embedded prompt instructions are ignored.

## One Twilio number for inbound and outbound

Use one Twilio Elastic SIP trunk configured in both directions and associate the
same purchased E.164 number with it.

1. In Twilio, create an Elastic SIP trunk whose termination domain ends with
   `pstn.twilio.com`. Associate the purchased phone number with this trunk.
2. For inbound calling, add the LiveKit project SIP endpoint as Twilio's
   origination URI: `sip:<livekit-sip-endpoint>;transport=tcp`.
3. For outbound calling, create a Twilio Credential List and attach it under the
   trunk's Termination authentication. Keep its username/password server-side.
4. Create the LiveKit inbound trunk:

   ```json
   {
     "trunk": {
       "name": "StylMe Twilio inbound",
       "numbers": ["+1XXXXXXXXXX"]
     }
   }
   ```

   ```bash
   lk sip inbound create inbound-trunk.json
   ```

5. Create an individual LiveKit dispatch rule for isolated per-caller rooms.
   Bind it to the inbound trunk in the LiveKit dashboard and use this JSON:

   ```json
   {
     "rule": {
       "dispatchRuleIndividual": {
         "roomPrefix": "stylme-inbound-"
       }
     },
     "name": "StylMe inbound",
     "roomConfig": {
       "agents": [{
         "agentName": "stylme-voice",
         "metadata": "{\"direction\":\"inbound\",\"swarmId\":\"swarm_default_inbound\"}"
       }]
     }
   }
   ```

   The equivalent CLI command is `lk sip dispatch create dispatch-rule.json`.
6. Create the LiveKit outbound trunk using Twilio's termination domain and the
   exact same Credential List username/password:

   ```json
   {
     "trunk": {
       "name": "StylMe Twilio outbound",
       "address": "<your-trunk>.pstn.twilio.com",
       "numbers": ["+1XXXXXXXXXX"]
     }
   }
   ```

   ```bash
   lk sip outbound create outbound-trunk.json \
     --auth-user "$SIP_AUTH_USERNAME" \
     --auth-pass "$SIP_AUTH_PASSWORD"
   ```

7. In `/admin/agents`, update the inbound/outbound default swarms with that same
   phone number plus the returned inbound trunk, outbound trunk, and dispatch
   rule IDs. Campaign `fromNumber` must match the configured E.164 number.

For an Indian destination, Twilio currently permits outbound calls only from an
international (non-Indian) caller number and requires recipient consent for
commercial calls. Trial accounts are also restricted to verified recipients,
the signup country, and trial limits, so a free US trial number is not a general
free production route to arbitrary Indian numbers.
