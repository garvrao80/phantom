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

## Getting started (once scaffolded)

```bash
cp .env.example .env   # add CEREBRAS_API_KEY
pnpm install
pnpm dev               # proxy :4000, dashboard :5174, demo-app :5173
pnpm reset             # clean state
```

Built at the DevDay Exchange Community Hackathon, New Delhi, 2026.
