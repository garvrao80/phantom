# Phantom — Build Spec

> This is the single source of truth for **what** Phantom is. The step-by-step **how** (order, reference code, verify steps, owners) is in [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).
>
> This file is the single source of truth for building Phantom. Coding agents (Codex) and humans should read it before writing code. When the spec and the code disagree, fix one of them in the same commit.

**One-liner:** Phantom lets a frontend use a backend before it exists. Unbuilt API calls are answered live by a fast model on Cerebras, backed by a real data store so data stays consistent. Every request is recorded. Press **Materialize** and Codex turns the recorded traffic into a real backend plus tests, then the app switches over with no visible change.

**Tagline:** *The frontend is the spec. Every click is a test.*

---

## Table of contents
1. [Context](#1-context)
2. [How it works](#2-how-it-works)
3. [Architecture](#3-architecture)
4. [Tech stack](#4-tech-stack)
5. [Repo layout](#5-repo-layout)
6. [Configuration](#6-configuration)
7. [Data contracts](#7-data-contracts)
8. [Module specs](#8-module-specs)
9. [Proxy HTTP API](#9-proxy-http-api)
10. [Live events (SSE)](#10-live-events-sse)
11. [The phantom prompt](#11-the-phantom-prompt)
12. [Materialize](#12-materialize)
13. [Dashboard](#13-dashboard)
14. [Demo app: Hackathon Hub](#14-demo-app-hackathon-hub)
15. [Testing strategy](#15-testing-strategy)
16. [Milestones and acceptance criteria](#16-milestones-and-acceptance-criteria)
17. [Day schedule and team split](#17-day-schedule-and-team-split)
18. [Codex task prompts](#18-codex-task-prompts)
19. [Risks and fallbacks](#19-risks-and-fallbacks)
20. [Out of scope](#20-out-of-scope)
21. [Working conventions](#21-working-conventions)
22. [Open questions to verify on the day](#22-open-questions-to-verify-on-the-day)

---

## 1. Context

| | |
|---|---|
| Event | DevDay Exchange Community Hackathon, New Delhi, Sun 1 Nov 2026, 8 AM to 8 PM |
| Organisers | Codex Ambassadors (Codex community). Partner: **Cerebras** (fast inference) |
| Format | Open-ended; build something real in one day and demo it |

**The problem.** Frontend developers wait on backend APIs. Hand-written mocks return fixed data, forget everything ("I created a team, refreshed, and it's gone"), and drift from the real API when it lands. The real spec of what the frontend needs lives only in the frontend code.

**Phantom's answer:**
1. A fast model answers as the backend.
2. A real store keeps state, so data stays consistent.
3. Shapes are locked per route.
4. Every exchange is recorded.
5. One click has Codex generate the real backend plus contract tests from those recordings, and Phantom switches traffic to it once the tests pass.

**Sponsor fit:**
- **Cerebras:** the model *is* the backend, so every click waits on it. Sub-second responses are the product requirement, not a nice-to-have.
- **Codex:** it runs inside the product (Materialize), and we also build Phantom with it.

**Positioning:**
- Mock servers (Mockoon, MSW, Prism, Postman mocks) are static.
- LLM fake-API tools have no state and no path to real code.
- Spec-first codegen needs a written spec.
- Phantom combines a stateful model-backed backend, recording-as-spec, and generation of a tested backend. Say "we found nothing that combines all three". Never say "first".

---

## 2. How it works

```
frontend ──/api/*──▶ Phantom proxy ──▶ route key (method + normalised path)
                                   │
                    real handler exists? ──yes──▶ REAL handler ─┐
                                   │no                          │
                                   ▼                            │
                     build prompt (request + locked schema      │
                     + store snapshot + reserved id)            │
                                   ▼                            │
                     Cerebras ──▶ {status, body, storeOps}      │
                                   ▼                            │
                     validate (JSON, rules, schema) ─fail─▶ retry once ─fail─▶ 502
                                   ▼ ok                         │
                     apply storeOps to store (our code)         │
                     lock schema if first success               │
                                   ▼                            │
                     record exchange ◀──────────────────────────┘
                                   ▼
                     SSE event to dashboard, respond to frontend
```

**Three trust rules.** These are the core of the design; never weaken them:
1. **The model proposes, the code decides.** The model returns a response and *proposed* `storeOps`. Only our code mutates the store, after validation.
2. **Shapes are locked.** The first successful response on a route fixes its response schema. Every later response must validate against it.
3. **Reads can't write, and ids come from us.** GET, HEAD and OPTIONS must return `storeOps: []`. New record ids are reserved by the proxy and given to the model.

---

## 3. Architecture

```
 ┌──────────────┐      /api/*       ┌───────────────────────────────────┐
 │ demo-app     │ ────────────────▶ │ proxy (Fastify, :4000)            │
 │ (Vite :5173) │ ◀──────────────── │  router ─ phantom ─ store         │
 └──────────────┘                   │  schemas ─ recorder ─ realHandlers│
 ┌──────────────┐   SSE /phantom/   │  materialize                      │
 │ dashboard    │ ◀──── events ──── │                                   │
 │ (Vite :5174) │ ─ POST /phantom/* │                                   │
 └──────────────┘                   └───────┬─────────────────┬─────────┘
                                            ▼                 ▼
                                      Cerebras API     generated/handlers.ts
                                                        (written by Codex)
                                                              ▲
                                         codex exec (child process)
```

**Important design decision: no hot route registration in Fastify.** Fastify can't add routes after `listen()`. The proxy has **one catch-all** `/api/*` route. Inside it, the router looks up a `realHandlers` map (route key → handler function). Materialize fills that map by dynamically importing `generated/handlers.ts`. This makes the REAL/PHANTOM flip instant, with no server restart.

---

## 4. Tech stack

| Concern | Choice |
|---|---|
| Runtime | Node 20+, TypeScript (ESM), `tsx` for running TS directly |
| Package manager | pnpm workspaces |
| Proxy | Fastify 4/5 |
| Model client | `openai` npm SDK with `baseURL: https://api.cerebras.ai/v1` |
| Model | `gpt-oss-120b` (confirm the exact id in the Cerebras console) |
| Validation | `ajv` (+ `ajv-formats`) |
| Store | Single JSON file, kept in memory, written atomically (write tmp, then rename) |
| Live events | Server-Sent Events |
| Materialize | `codex exec` spawned via `child_process.spawn` (or `@openai/codex-sdk` if simpler) |
| Tests | Vitest |
| Frontends | React 18 + Vite; plain CSS or Tailwind; no component library needed |

---

## 5. Repo layout

```
phantom/
  AGENTS.md                  ← this file
  README.md
  docs/DEMO_AND_QA.md        demo script, setup checklist, judge Q&A
  package.json               pnpm workspace root; scripts: dev, reset, test
  pnpm-workspace.yaml
  .env.example
  data/                      runtime state (git-ignored except .gitkeep)
    store.json
    schemas.json
    routes.json              route key → { mode: "PHANTOM" | "REAL", calls, lastLatencyMs }
    recordings.jsonl
  packages/
    proxy/
      src/
        server.ts            Fastify app: /api/*, /phantom/* endpoints, SSE
        config.ts            env parsing
        router.ts            normalisePath(), routeKey(), dispatch()
        phantom.ts           buildPrompt(), callModel(), validateAnswer(), runPhantom()
        store.ts             Store class: load/save/get/list/insert/update/delete/applyOps/reserveId/snapshot
        schemas.ts           inferSchema(), lock(), validate()
        recorder.ts          record(), readRecordings(), SSE broadcast
        events.ts            SSE hub
        cache.ts             GET cache keyed by routeKey + query + store.version
        materialize.ts       buildContext(), runCodex(), runTests(), activate()
        realHandlers.ts      map + loadGenerated()
        testing/replay.ts    helpers used by generated tests
      generated/             written by Codex at runtime (git-ignored except .gitkeep)
        handlers.ts
        tests/*.test.ts
        .context/            schemas, recordings, task.md handed to Codex
      test/                  our own unit tests
    dashboard/               React app (section 13)
    demo-app/                React app (section 14)
```

---

## 6. Configuration

`.env` (never commit it; `.env.example` lists the keys):

| Var | Default | Meaning |
|---|---|---|
| `CEREBRAS_API_KEY` | — | Required |
| `CEREBRAS_MODEL` | `gpt-oss-120b` | Model id |
| `CEREBRAS_BASE_URL` | `https://api.cerebras.ai/v1` | |
| `PHANTOM_PORT` | `4000` | Proxy port |
| `PHANTOM_REPLAY` | `false` | Serve recorded responses instead of calling the model |
| `PHANTOM_SNAPSHOT_LIMIT` | `50` | Max records per collection in a prompt |
| `PHANTOM_MAX_TOKENS` | `800` | Model output cap |
| `CODEX_TIMEOUT_MS` | `300000` | Materialize timeout |

**Model request settings:**
- `temperature: 0`
- `max_tokens: PHANTOM_MAX_TOKENS`
- `reasoning_effort: "low"`, if the API accepts it. gpt-oss reasoning tokens are billed, so keep them low.
- `response_format: { type: "json_schema", ... }` if supported; otherwise `{ type: "json_object" }`. Always validate ourselves anyway.

---

## 7. Data contracts

### 7.1 Model answer
```json
{
  "status": 201,
  "body": { "id": "team_1", "name": "Byte Me", "members": [], "createdAt": "2026-11-01T10:02:00Z" },
  "storeOps": [
    { "op": "insert", "collection": "teams", "id": "team_1",
      "record": { "id": "team_1", "name": "Byte Me", "members": [], "createdAt": "2026-11-01T10:02:00Z" } }
  ]
}
```

`storeOps` item types:

| op | fields | semantics |
|---|---|---|
| `insert` | `collection`, `id`, `record` | Fails if the id exists. `record.id` must equal `id` |
| `update` | `collection`, `id`, `patch` | Shallow merge. Fails if the id is missing |
| `delete` | `collection`, `id` | Fails if the id is missing |

### 7.2 Validation rules (enforced by `validateAnswer`)
1. Parses as JSON with exactly the keys `status`, `body`, `storeOps`.
2. `status` is an integer from 100 to 599.
3. For a read method (`GET`, `HEAD`, `OPTIONS`), `storeOps` must be `[]`.
4. Every `insert` id must be in the **reserved ids** for this request.
5. Every `update` and `delete` must target an existing record (checked against a dry run on a store copy).
6. Collection names must match `/^[a-z][a-z0-9_]*$/`.
7. If the route has a locked response schema and `status` is 2xx, `body` must validate against it.
8. 4xx responses must have a body of `{ "error": string }`. They are not schema-locked and do not lock.

On failure: retry **once**, with the validation error appended to the prompt ("Your previous answer was invalid because …"). On a second failure, respond `502 { "error": "phantom_invalid", "detail": "<reason>" }` and record it with `ok: false`.

### 7.3 Route keys and path normalisation
- `routeKey = METHOD + " " + normalisedPath`, for example `GET /teams/:id`.
- Strip the `/api` prefix and any trailing slash.
- A segment becomes `:id` if it matches any of:
  - a number: `^\d+$`
  - a UUID: `^[0-9a-f]{8}-[0-9a-f]{4}-…$` (case-insensitive)
  - a prefixed id containing a digit: `^[a-z]+_[A-Za-z0-9]*\d[A-Za-z0-9]*$` (so `team_members` is **not** an id)
  - a long opaque string containing a digit: `^(?=.*\d)[A-Za-z0-9_-]{16,}$`
- Multiple id segments get numbered: `/teams/:id/members/:id2`.
- Path params are extracted and passed to the prompt and to real handlers as `params`.

### 7.4 Store file (`data/store.json`)
```json
{
  "version": 12,
  "nextId": { "teams": 3, "projects": 7 },
  "collections": {
    "teams":    { "team_1": { "id": "team_1", "name": "Byte Me" } },
    "projects": { "proj_1": { "id": "proj_1", "teamId": "team_1", "votes": 4 } }
  }
}
```
- `version` increments on every successful `applyOps` that has at least one op.
- `nextId[col]` is the **next number to hand out** (default 1). Inserting `team_n` sets it to at least `n + 1`.
- **Id format:** `<singular>_<n>`, for example `teams` → `team_1`. Singularise naively: drop a trailing `s`, or turn `ies` into `y`.
- Writes are atomic: write to `store.json.tmp`, then `rename`.

### 7.5 Reserved ids
Before each non-read call, `runPhantom` asks the store for **candidate collections** (section 8.4) and peeks the next id for each, for example `{ "teams": "team_3" }`. The model may use any of them for inserts. Peeking doesn't advance `nextId`; only an actual insert does. Non-read calls are serialised, so two requests never get the same id. Reads reserve nothing.

### 7.6 Schema registry (`data/schemas.json`)
```json
{
  "POST /teams": {
    "response": { "type": "object", "properties": { "id": {"type":"string"}, "...": {} },
                  "required": ["id","name","members","createdAt"], "additionalProperties": false },
    "status": 201,
    "lockedAt": 1730450000,
    "sampleCount": 1
  }
}
```
**Inference rules (`inferSchema`):**
- Primitives map to `string | number | boolean`. All numbers are `number`; there's no integer/number split, which avoids false failures.
- `null` becomes an unknown node (`{ "x-unknown": true }`, accepts anything), and is refined **once** when a non-null value appears. That one refinement is the only change allowed after the lock.
- Objects: `properties` from the keys, `required` = all keys seen, `additionalProperties: false`.
- Arrays: `items` inferred from the first element. An **empty array** gives unknown `items`, refinable once.
- **Don't lock on an empty top-level array** (`[]`). Wait for a response with at least one item.
- The locked `status` is the first 2xx status. Later 2xx responses must use the same one.

### 7.7 Recording line (`data/recordings.jsonl`)
```json
{
  "seq": 41, "ts": 1730450000123, "mode": "PHANTOM", "cached": false, "ok": true,
  "routeKey": "POST /teams",
  "req": { "method": "POST", "path": "/teams", "params": {}, "query": {}, "body": { "name": "Byte Me" } },
  "res": { "status": 201, "body": { "id": "team_1", "name": "Byte Me", "members": [], "createdAt": "..." } },
  "storeOps": [ { "op": "insert", "collection": "teams", "id": "team_1", "record": { } } ],
  "storeBefore": { "version": 11, "nextId": { "teams": 1 }, "collections": { "teams": {} } },
  "latencyMs": 380, "tokens": { "in": 1650, "out": 210 }, "retries": 0
}
```
`storeBefore` contains only the collections sent in the prompt (plus their `nextId`). Tests use it to replay from the same starting state.

### 7.8 Routes file (`data/routes.json`)
`{ "POST /teams": { "mode": "PHANTOM", "calls": 5, "lastLatencyMs": 410, "locked": true } }`

---

## 8. Module specs

### 8.1 `store.ts`
```ts
class Store {
  static load(path: string): Store
  save(): void                                   // atomic
  get version(): number
  get(col: string, id: string): Rec | undefined
  list(col: string): Rec[]
  collections(): string[]
  reserveId(col: string): string                 // does not advance nextId until commit
  dryRun(ops: StoreOp[]): { ok: true } | { ok: false; reason: string }
  applyOps(ops: StoreOp[]): void                 // validates via dryRun; throws on failure; bumps version; saves
  snapshot(cols: string[], limit: number): Snapshot
  reset(): void
}
```
`applyOps` is all-or-nothing.

### 8.2 `router.ts`
- `normalisePath(path) → { pattern, params }`
- `routeKey(method, pattern)`
- `dispatch(req)`:
  1. If `realHandlers.has(key)` → REAL.
  2. Else if `PHANTOM_REPLAY` → serve the last ok recording for this key and query.
  3. Else if a cache hit → PHANTOM·cached.
  4. Else → `runPhantom`.

### 8.3 `phantom.ts`
- `buildPrompt(ctx)` → messages (section 11).
- `callModel(messages)` → raw text + token usage + latency.
- `validateAnswer(answer, ctx)` → applies the rules in 7.2.
- `runPhantom(req)`: reserve ids → prompt → call → validate (retry once) → `applyOps` → lock or validate the schema → record → respond.

### 8.4 Snapshot selection (which collections go into the prompt)
1. Path segments that aren't ids are candidate collection names. Match each against existing collections, singular or plural (`team` ↔ `teams`).
2. Add collections referenced by foreign-key-looking fields in the request body (`teamId` → `teams`).
3. If the whole store serialises to under about 8 KB, send all of it. This is what makes derived views like `/leaderboard` work.
4. Otherwise send the matched collections, each capped at `PHANTOM_SNAPSHOT_LIMIT` (most recent first), plus the full list of collection names.
5. For a POST to a path with no matching collection, the path's last non-id segment becomes the **new** collection name candidate (`POST /teams` → `teams`), and gets a reserved id.

### 8.5 `schemas.ts`
`inferSchema(value)`, `lock(key, status, body)`, `refine(key, body)` (one-time unknown refinement), and `validate(key, status, body) → errors[]`.

### 8.6 `cache.ts`
Key: `routeKey + JSON(query) + store.version`. Only GET is cached, and only ok responses. Clear the cache on reset.

### 8.7 `recorder.ts`
Appends a line, increments `seq`, updates `routes.json` counters, and broadcasts a `request` event.

### 8.8 `realHandlers.ts`
```ts
type HandlerCtx = { params: Record<string,string>; query: Record<string,string>; body: unknown; store: Store };
type Handler = (ctx: HandlerCtx) => Promise<{ status: number; body: unknown }>;
export const realHandlers: Map<string, Handler>;
export async function loadGenerated(keys: string[]): Promise<void>; // copies handlers.ts to handlers.<ts>.ts, then import()s it to bypass the ESM cache
```
Real handlers use the **same `Store`** as Phantom, so data carries over.

---

## 9. Proxy HTTP API

| Method + path | Purpose |
|---|---|
| `ALL /api/*` | The app's API. PHANTOM or REAL |
| `GET /phantom/events` | SSE stream (section 10) |
| `GET /phantom/routes` | `[{ key, mode, calls, lastLatencyMs, locked, schema }]` |
| `GET /phantom/recordings?route=` | Recent recordings (default 100) |
| `GET /phantom/store` | Current store (for the dashboard) |
| `POST /phantom/materialize` | `{ routes: string[] }` → starts a job, returns `{ jobId }` |
| `POST /phantom/routes/:key/mode` | Manually pin `PHANTOM`/`REAL` (stretch) |
| `POST /phantom/reset` | Clear the store, schemas, routes, recordings, cache, `generated/` and realHandlers |
| `GET /phantom/health` | `{ ok, model, replay }` |

Add the response header `x-phantom-mode: PHANTOM | REAL | CACHED | REPLAY` to every `/api/*` response. Enable CORS for both Vite dev ports.

---

## 10. Live events (SSE)

Each event is `event: <type>\ndata: <json>\n\n`.

| type | data |
|---|---|
| `request` | The recording line (7.7) |
| `route` | `{ key, mode, locked }` on any change |
| `materialize` | `{ jobId, phase: "context"\|"codex"\|"tests"\|"activate"\|"done"\|"failed", line?: string, tests?: { passed, failed, total } }` |
| `reset` | `{}` |

Send a heartbeat comment every 15 s.

---

## 11. The phantom prompt

**System message (keep this text stable; tweak deliberately):**
```
You are the backend server for a web application. You receive exactly one HTTP request
and must respond as a consistent, conventional JSON REST API would.

Respond with a single JSON object and nothing else:
{"status": <int>, "body": <json>, "storeOps": [<op>...]}

Rules:
- The STORE below is the only source of truth. Never invent records that are not in the
  store unless this request creates them.
- GET/HEAD/OPTIONS requests must have "storeOps": [].
- To create a record, use one of the RESERVED IDS for its collection, and include an
  "insert" op whose record exactly matches what you return.
- To change a record, use "update" with only the changed fields in "patch".
- If a RESPONSE SCHEMA is given, a 2xx body MUST match it exactly: same fields, same types,
  no extra fields.
- If the request refers to a record that does not exist, return 404 {"error": "..."}.
- If the request is malformed, return 400 {"error": "..."}.
- Use camelCase field names. Timestamps are ISO 8601 strings. Lists are JSON arrays.
- Derived endpoints (e.g. /leaderboard, /stats) are computed from the store and are reads.
```

**User message template:**
```
REQUEST
{method} {path}
params: {params}
query: {query}
body: {body}

ROUTE: {routeKey}
RESPONSE SCHEMA: {schema JSON or "none yet — choose a sensible, conventional REST shape"}
EXPECTED STATUS: {locked status or "choose"}
RESERVED IDS: {json or "none (read request)"}
COLLECTIONS IN STORE: {names}
STORE:
{snapshot JSON}
```

**Retry addition:** `Your previous answer was rejected: {reason}. Return a corrected answer.`

---

## 12. Materialize

### 12.1 Flow
1. **context:** write `generated/.context/`:
   - `schemas.json`: only the selected routes.
   - `recordings.jsonl`: ok recordings for the selected routes, de-duplicated, max 20 per route.
   - `task.md`: section 12.2, filled in.
   - `api.md`: the `Store` and `HandlerCtx` type signatures from 8.1 and 8.8.
2. **codex:** spawn `codex exec` with `--cd packages/proxy`, non-interactive with auto-approval for edits inside the workspace (check the exact flags with `codex exec --help`). Pass "Read generated/.context/task.md and complete it." as the prompt. Stream stdout and stderr lines as `materialize` events. Kill it after `CODEX_TIMEOUT_MS`.
3. **tests:** **we** run `pnpm vitest run generated/tests --reporter=json` ourselves, parse the pass and fail counts, and emit them.
4. **activate:** only if every test passes. Call `loadGenerated(routes)`, set those routes to `REAL`, and emit `route` events.
5. **done/failed:** on failure, routes stay PHANTOM and the failing test output is shown in the dashboard. A "Retry" button re-runs Codex with the failure output appended to the task.

### 12.2 `task.md` template (written for Codex)
```
# Task: implement real handlers for these routes

Routes: {list}

Write `generated/handlers.ts` that exports:
  export const handlers: Record<string, Handler>
keyed by route key exactly as listed (e.g. "POST /teams", "GET /teams/:id").
Types and the Store API are in `generated/.context/api.md`. Import Store types from
"../src/store.ts" and Handler types from "../src/realHandlers.ts".

Requirements:
- Match each route's locked response schema in `generated/.context/schemas.json` exactly,
  including the success status code.
- Behave like the recorded examples in `generated/.context/recordings.jsonl`.
- Create ids with store.reserveId(collection) and persist with store.applyOps([...]).
- Return 404 {"error"} for missing records, 400 {"error"} for invalid input.
- No new dependencies. Do not edit files outside `generated/`.

Write tests in `generated/tests/<resource>.test.ts` using the helpers in
"../../src/testing/replay.ts": for EVERY recording, call
  await expectReplay(handlers, recording)
Run `pnpm vitest run generated/tests` and iterate until all tests pass.
```

### 12.3 `testing/replay.ts` (we write this before Materialize)
`expectReplay(handlers, rec)` does five things:
1. Builds a fresh in-memory `Store` from `rec.storeBefore`.
2. Calls `handlers[rec.routeKey]({ params, query, body, store })`.
3. Asserts the status equals `rec.res.status`.
4. Asserts the body validates against the locked schema.
5. Asserts **deterministic fields** are equal to the recording. "Deterministic" means every field except those whose recorded value is an ISO timestamp. Ids are deterministic because `nextId` is restored from `storeBefore`.

### 12.4 Demo scope
Materialize **one or two resources** (about 4–6 routes) on stage. Pre-run once to measure the time.

---

## 13. Dashboard

**Layout:** a header, a request log (left, about 60%) and a route table (right).
- **Header:** the Phantom logo, model name, replay toggle, a **Reset** button, and live stats (median latency, calls, tokens, estimated cost at the configured prices).
- **Request log:** newest first, one row per request:
  - time
  - a mode badge: **PHANTOM** (purple `#A78BFA`), **REAL** (green `#5EE6A0`), CACHED (grey), REPLAY (blue), or ERROR (red)
  - method and path
  - status
  - latency in ms
  - Clicking a row expands it to show the request, response and storeOps.
- **Route table:** route key, mode, calls, a locked 🔒 indicator, and a checkbox. The **Materialize selected** button sits under it.
- **Materialize panel:** opens when a job starts. It shows the phase stepper (context → codex → tests → activate) and a streaming log (monospace, auto-scroll). It finishes with a big "N tests passed" and the rows flip to REAL with a short highlight animation.
- **Style:** dark background `#12101A`, panels `#1C1930`, fonts Space Grotesk and JetBrains Mono. It must be readable from the back of a room: base font 16px or more, log rows 15px or more.

---

## 14. Demo app: Hackathon Hub

A tiny app about this event. **It must never contain backend logic or mock data**; every call goes to `/api/*` (Vite dev proxy → `:4000`).

| Screen | Calls |
|---|---|
| Teams list | `GET /api/teams` |
| Create team (name, members) | `POST /api/teams` |
| Team detail | `GET /api/teams/:id`, `GET /api/teams/:id/projects` |
| Add project (title, pitch) | `POST /api/projects` with `teamId` |
| Upvote | `POST /api/projects/:id/upvote` |
| Leaderboard | `GET /api/leaderboard` |

- Show a small corner badge with the `x-phantom-mode` header of the last response. It's subtle; the dashboard is the main display.
- Handle loading and error states cleanly. A 502 shows a "retry" toast, never a blank screen.

---

## 15. Testing strategy

| Layer | What | Where |
|---|---|---|
| Unit | `normalisePath`, `inferSchema`/`validate`, `Store.applyOps`/`dryRun`, `validateAnswer` (each rule in 7.2 has a test) | `packages/proxy/test/` |
| Model-free integration | `/api/*` with a **fake model client** that returns scripted answers. Covers retry, 502, lock, cache and replay | `packages/proxy/test/` |
| Live smoke | `scripts/smoke.sh`: 20 curl calls (create, read, update, derived), checking consistency against the real model | root |
| Generated | Contract tests written by Codex during Materialize | `generated/tests/` |

The model client is injected (`createPhantom({ model })`), so tests never hit the network.

---

## 16. Milestones and acceptance criteria

| # | Milestone | Done when |
|---|---|---|
| M0 | Spikes | A Cerebras key returns JSON from `gpt-oss-120b`. Structured-output support is known. `codex exec` runs non-interactively on the Linux laptop. Answers are written into section 22 |
| M1 | Scaffold | `pnpm dev` starts the proxy, dashboard and demo-app; `/phantom/health` is ok |
| M2 | Store + router | Unit tests for 8.1 and 7.3 pass |
| M3 | Phantom loop | `curl -XPOST /api/teams -d '{"name":"A"}'` then `curl /api/teams` shows team A. storeOps are applied by our code |
| M4 | Guards | Every rule in 7.2 is enforced and unit-tested. Schema lock works. 20 smoke calls stay consistent |
| M5 | Recorder + SSE | Every call is in `recordings.jsonl` and visible live in a bare dashboard |
| M6 | Demo app + dashboard | Hackathon Hub is fully clickable through Phantom, and the dashboard matches section 13 |
| M7 | Materialize | One click → Codex writes handlers and tests → we run the tests → the routes flip to REAL → the app keeps working with the same data |
| M8 | Hardening | Three clean demo runs in a row from `pnpm reset`. GET cache on. Replay mode works offline |
| M9 | Ship | README done, backup video recorded, numbers measured |

---

## 17. Day schedule and team split

| Time | Work |
|---|---|
| 8:00–8:45 | M0 + M1 |
| 8:45–10:30 | M2 + M3 |
| 10:30–11:30 | M4 |
| 11:30–12:30 | M5 |
| 12:30–1:00 | Lunch; freeze contracts (section 7) |
| 1:00–2:30 | M6 |
| 2:30–4:30 | M7 |
| 4:30–5:30 | M8 |
| 5:30–6:15 | M9 |
| 6:15–8:00 | Rehearse and present |

**Team split:**
- **Abhik (core proxy):** store, router, schemas, phantom loop, guards, recorder, events, control API
- **Lakshay (frontends):** Hackathon Hub + dashboard, against fakes until the core lands
- **Garv (Materialize + ops):** Codex spawn, `replay.ts`, test gate, activation, reset, smoke script, backup video, README

Full hour-by-hour split, file ownership and merge points: [docs/IMPLEMENTATION_PLAN.md → Parallel work map](docs/IMPLEMENTATION_PLAN.md#parallel-work-map).

**Cut lines:**
- At 2:30 with an unstable loop: keep a terminal log only, no dashboard polish.
- At 4:30 with flaky Materialize: pre-run it, show the recorded run, and do the flip live.

**Stretch (only after M8):**
- per-route pinning
- a drift check (replay recordings against REAL and show a diff)
- OpenAPI export from locked schemas

---

## 18. Codex task prompts

Run these in order. Each prompt assumes Codex has read this file.

1. "Read AGENTS.md. Scaffold the repo per section 5: pnpm workspace, packages/proxy (Fastify, TS, tsx, vitest), packages/dashboard and packages/demo-app (React + Vite). Root scripts `dev` (all three in parallel), `test`, `reset`. Add .env.example from section 6 and `GET /phantom/health`. No features yet."
2. "Implement `store.ts` exactly per sections 7.4, 7.5 and 8.1, with unit tests for insert/update/delete, all-or-nothing applyOps, dryRun failures, reserveId, snapshot limits and atomic save."
3. "Implement `router.ts` per 7.3 and 8.2 with unit tests covering every normalisation rule."
4. "Implement `schemas.ts` per 7.6 and 8.5 with unit tests: lock, empty-array no-lock, one-time null refinement, integer→number widening, extra-field rejection."
5. "Implement `phantom.ts`, `cache.ts` and the `/api/*` catch-all per sections 7.2, 8.3, 8.4, 8.6 and 11. The model client is injected. Add integration tests with a fake model covering every rule in 7.2, retry, and 502."
6. "Implement `recorder.ts`, `events.ts` and the `/phantom/*` endpoints per sections 7.7, 7.8, 9 and 10."
7. "Build `packages/demo-app` per section 14 and `packages/dashboard` per section 13."
8. "Implement `realHandlers.ts`, `testing/replay.ts` and `materialize.ts` per sections 8.8 and 12. Codex is spawned as a child process; stream its output over SSE; we run the tests ourselves and activate only on a full pass."
9. "Add `scripts/smoke.sh` per section 15, make `pnpm reset` per section 9, and implement replay mode."

After each prompt: run the tests, read the diff, and commit.

---

## 19. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Venue Wi-Fi | Phone hotspot; everything else runs locally |
| Cerebras rate limit or credit (we have about $5) | GET cache, `reasoning_effort: low`, capped snapshots, and replay mode during UI work. Check usage at lunch |
| Model breaks the schema | Lock + retry + a visible red row; present it as a feature |
| Codex slow on stage | Pre-run; show the recorded Materialize; do the REAL flip live |
| Generated code wrong | Tests gate the flip; Retry with the failure output |
| Data mismatch between PHANTOM and REAL | Same `Store` instance and file for both |
| Key leak | `.env` is git-ignored; never show a terminal with keys on stage |

---

## 20. Out of scope (today)
- Auth, users, multi-tenancy
- Any database other than the JSON file
- Non-JSON APIs, file uploads, websockets through the proxy
- Arbitrary third-party frontends (the demo app is enough)
- Production deployment

---

## 21. Working conventions
- **Branch:** work on `main` with small commits. Use short-lived branches only when two people touch the same package.
- **Commits:** imperative, scoped messages, for example `proxy: enforce read-only storeOps`.
- **Before each commit:** `pnpm test` passes.
- **Never commit:** `.env`, `data/*` runtime files, `generated/*` (except `.gitkeep`), `node_modules`.
- **Changing a contract** in section 7 means updating this file in the same commit.

---

## 22. Open questions to verify on the day

Fill these in during M0.

| Question | Answer |
|---|---|
| Exact Cerebras model id for gpt-oss-120b | |
| Does Cerebras accept `response_format: json_schema` for it? | |
| Does it accept `reasoning_effort`? | |
| Requests/min and tokens/min limit on our key | |
| Exact `codex exec` flags for non-interactive, auto-approved edits in a directory | |
| Is `@openai/codex-sdk` simpler than spawning the CLI? | |
| Measured median phantom latency | |
| Materialize wall time for 5 routes | |
