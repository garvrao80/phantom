# Phantom

**Use a backend before it exists.**

Phantom sits between your frontend and a backend that hasn't been written yet. Unbuilt API calls are answered live by a fast model on Cerebras, backed by a real data store so data stays consistent. Every request is recorded. Press **Materialize** and Codex turns the recorded traffic into a real backend plus contract tests. Once the tests pass, Phantom switches traffic over, and the app doesn't notice.

> The frontend is the spec. Every click is a test.

## How it works

1. The frontend calls `/api/*` on the Phantom proxy.
2. If a real handler exists for the route, the call goes to it (**REAL**). Otherwise Phantom asks the model (**PHANTOM**).
3. The model returns `{ status, body, storeOps }`. Phantom validates the answer, applies the store changes itself, and locks the route's response shape.
4. Every exchange is recorded to `data/recordings.jsonl` and streamed to the dashboard.
5. **Materialize:** Codex writes handlers and tests from the recordings. Phantom runs the tests and flips the routes to REAL on a full pass.

## Trust rules

- The model proposes; our code decides. Only Phantom mutates the store.
- Response shapes are locked per route after the first success.
- Reads can't write, and new ids are reserved by Phantom.

## Team

Garv · Abhik · Lakshay

## Stack

Node + TypeScript, Fastify, Cerebras (`gpt-oss-120b`, OpenAI-compatible API), ajv, Server-Sent Events, Codex (`codex exec`), Vitest, React + Vite.

## Repo

| Path | What |
|---|---|
| `AGENTS.md` | Full build spec: contracts, modules, milestones, prompts |
| `docs/IMPLEMENTATION_PLAN.md` | Step-by-step build plan with reference code and who does what |
| `docs/DEMO_AND_QA.md` | Walkthrough example, demo script, judge Q&A |
| `packages/proxy` | The Phantom proxy |
| `packages/dashboard` | Live request log and Materialize UI |
| `packages/demo-app` | Hackathon Hub, the demo frontend with no backend |

## Run locally

Requires Node 20+, pnpm, and a signed-in Codex CLI. Hosting and storage run locally; AI calls use your own hackathon access/credits.

1. Copy `.env.example` to `.env` and set `CEREBRAS_API_KEY` on the machine running Phantom. Never commit the key. A teammate's ignored `.env` is not transferred by GitHub.
2. Run `pnpm install`.
3. Run `node scripts/start-local.mjs` for the backend on port 4000.
4. When the frontend packages have landed, use `pnpm dev` to start all packages (demo app 5173, dashboard 5174).

PowerShell: use `Copy-Item .env.example .env`; macOS/Linux: `cp .env.example .env`.

## Verification

```bash
pnpm test
pnpm --filter @phantom/proxy typecheck
node scripts/preflight.mjs
```

The preflight checks key and frontend presence without displaying credential values. It does not prove API access.

With the proxy running and a real Cerebras key loaded:

```bash
node scripts/smoke.mjs
```

**Smoke resets development state.** It verifies persisted teams, distinct per-team reads, project creation, and three upvotes. Do not run against anyone else's active demo. API requests are paced 14 seconds apart by default for the trial key's rate limit; `PHANTOM_SMOKE_DELAY_MS` can adjust this after limits are confirmed.

### Backend handoff rehearsal

Stop the development proxy first. This temporarily replaces generated artifacts, restores them afterward, and uses an isolated store. The default uses scripted Cerebras input and **real Codex generation and real replay tests**:

```bash
node scripts/rehearse.mjs --runs=3
```

Results and genuine terminal recordings are saved in `data/rehearsals/`. They are backend-only evidence, not a UI demo video. To exercise real Cerebras too, load the local key:

```bash
node --env-file=.env scripts/rehearse.mjs --runs=3 --live-cerebras
```

Do not publish the scripted-input request latency as Cerebras latency. Generation timings are measured, not guaranteed.

## Current evidence and remaining integration

- Core suite: 58 tests passing; strict proxy TypeScript check passing.
- Materialize failure/activation harness: 8 tests passing.
- Real Codex generated and verified a one-route backend, then the real dispatcher created new data while preserving existing data. One measured run took 38.293 seconds, with 4 replay/generated tests passing.
- Three one-route rehearsals with live Cerebras and real Codex passed: handoff times 38.159s, 38.185s, 38.249s; initial API requests 717ms, 659ms, 907ms. Each run passed 4 tests and preserved data after switching to REAL. This is a small local sample, not a general benchmark.
- Multi-route verification currently exposes a per-ID GET cache collision (team_2 can receive team_1) and an application-contract mismatch (live model uses `upvotes` instead of the required `votes`). The fix is handed to the core owner in docs/PROGRESS.md. Materialize HTTP endpoints, retry, job status and reset guard have landed; final UI verification is pending. See [team progress](docs/PROGRESS.md) for current ownership and evidence.

## Team coordination

Every contributor and coding agent must read and update [docs/PROGRESS.md](docs/PROGRESS.md). Ownership and interface rules are in [the implementation plan](docs/IMPLEMENTATION_PLAN.md). Update measured results only after executing the check; label scripted inputs and offline fallback recordings clearly.

Built at the DevDay Exchange Community Hackathon, New Delhi, 2026.

### Five-route HTTP rehearsal

With the proxy stopped, run `node --env-file=.env packages/proxy/node_modules/tsx/dist/cli.mjs scripts/verify-http-materialize.ts`. This uses real Cerebras, the actual Fastify HTTP handlers, and real Codex. It exercises five routes, checks reset/concurrent-job guards, and verifies new data after handoff. It is paced for the trial API limit. Failures save request/response/store evidence to ignored `data/http-rehearsal-failure.json`; success saves `data/http-rehearsal.json`. Frontend behavior is not covered.
