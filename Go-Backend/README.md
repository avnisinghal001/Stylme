# StylMe AI control plane

This service is the small Go control plane for StylMe's configurable web and
voice agents. It intentionally does not duplicate the Python catalogue API.

It owns six MongoDB collections:

- `ai_agents`: versioned instructions, model/voice settings, tools, and capture contracts.
- `agent_swarms`: validated DAGs, managed SIP bindings, and an admin-editable human handoff number.
- `campaigns`: outbound campaign policy and counters.
- `calls`: the single inbound/outbound call record and outbound work queue.
- `ai_sessions`: short-lived web-chat context with a TTL index.
- `provider_credentials`: AES-GCM encrypted OpenAI, Deepgram, and Sarvam key
  rotations. Each provider is atomically upserted into one stable document;
  deployment keys bootstrap only when no active Mongo key exists. Admin reads
  expose only masked status, with OpenAI first; runtime reads are internal.

Pending outbound calls are the campaign queue, so there is no duplicate
`campaign_items` collection. Every scheduled target is idempotent by
`campaignId + externalId`.

## Run

The service walks upward to load the repository root `.env`; process
environment values still win.

```bash
go run ./cmd/api
```

Set `CALL_WORKER_ENABLED=true` only for a long-running deployment. Vercel-style
request functions must not run the dispatcher loop.

## Main API groups

- Public: `GET /v1/public/ai/config`, `POST /v1/web/sessions`,
  `POST /v1/web/sessions/{id}/messages`
- Owner/admin: `/v1/agents`, `GET /v1/tools`, `/v1/swarms`, `/v1/campaigns`, `/v1/calls`,
  `/v1/credentials`, `GET /v1/voices/sarvam`,
  `POST /v1/voices/sarvam/preview`, `POST /v1/calls/trigger`, and
  `POST /v1/admin/workflows/abandoned-checkout`
- LiveKit worker: `/v1/runtime/*` with `X-Internal-Key`
- Samora-compatible direct call: `POST /v1/call/trigger` with either
  `X-API-Key` or `X-Internal-Key`

For a serverless deployment, an external scheduler calls
`POST /v1/runtime/dispatch?limit=5` with `X-Internal-Key: <AI_INTERNAL_API_KEY>`, or the
`CRON_SECRET` value when no dedicated internal key is configured. A 202 response
means one pending call was dispatched; 200 means no call is currently eligible.
The limit is bounded to 1–10. Never put this key in a query string. Campaign status, timezone-aware calling
windows, and maximum active-call concurrency are enforced before dialing.

For abandoned checkout automation, cron-job.org can call
`POST /v1/workflows/abandoned-checkout` with the same header and an optional
`{"campaignId":"campaign_default_checkout_recovery","limit":100}` body. It
loads eligible checkout candidates from FastAPI, idempotently schedules them,
and dispatches the first safe batch. A separate one-minute queue-drain cron on
`/v1/runtime/dispatch?limit=5` handles later capacity and calling windows.

Campaigns select a reusable swarm and `entryNodeKey`, then own their language,
objective, greeting, campaign instructions, and capture questions. Calls save
that resolved campaign plus graph as an immutable snapshot.

The web agent uses OpenAI only to emit a strict, controlled search plan. The Go
service removes filter values not present in FastAPI's current `/filters`
contract before making one `/search/advanced` request. Profile updates are
returned as reviewable proposals and are never silently written.

The default inbound DAG uses one low-latency intake/router before its shopping,
orders, after-sales, and general specialists. Human escalation calls the number
configured in Agent Studio (default `+918126679138`) through the swarm's managed
outbound trunk; trunk IDs and caller ID remain hidden and cannot be overwritten
by browser payloads.

Agent Studio loads the complete Sarvam Bulbul v3 voice catalog from the control
plane. Preview synthesis is performed here with the encrypted Sarvam credential;
the API key is never sent to the browser. Saved voice configurations are checked
against the same speaker, language, model, and pace contract before persistence.

`GET /v1/tools` is the authoritative Agent Studio capability catalog. It marks
tools as ready, setup-required, always-on, or unavailable, and declares their
channel/direction compatibility. Agent saves reject unknown, duplicate, or
incompatible tool assignments; swarm saves reject unreachable nodes, invalid
agent/channel combinations, and outgoing routes whose source agent lacks the
handoff tool. The startup migration disables the legacy recovery-link flag until
an auditable messaging provider is connected.

The repository also includes a Vercel Go handler and a container build. Vercel
is suitable for the request APIs when an external scheduler drives dispatch;
the container entrypoint can instead enable the continuous worker with
`CALL_WORKER_ENABLED=true`.

## Direct-call trigger

The compatibility core is `{agent_id, to_number, metadata}`. `swarm_id`,
`from_number`, `external_id`, `participant`, and `context` are optional generic
extensions. `agent_id` must belong to the selected active outbound voice swarm;
if neither ID is supplied, the default outbound swarm and its entry agent are
used. Numbers are strict E.164. `metadata.idempotency_key` or the top-level
`idempotency_key` prevents duplicate calls.

```bash
curl --request POST \
  --header "X-API-Key: $AI_INTERNAL_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "agent_id": "agent_default_outbound_stylist",
    "to_number": "+918200962735",
    "metadata": {
      "idempotency_key": "replace-with-a-unique-business-event-id",
      "customer_name": "Riya Mehta",
      "source": "manual_demo"
    }
  }' \
  https://stylme-ai-control-plane.vercel.app/v1/call/trigger
```

A genuine dispatch returns `202` with `call_id` and `status: accepted`. Reusing
an idempotency key returns the prior call with `200`. Invalid input returns
`422`; a LiveKit/SIP dispatch failure returns `502` and still includes the
persisted `call_id` for diagnosis.
