# Phantom team progress and handoffs

All humans and coding agents: read this file before starting and pushing. Update your own section with the commit/branch, actual checks, and precise dependencies. Fetch before pushing; preserve other owners' entries. Do not treat another owner's pending work as complete.

## Ownership / current state

| Owner | Scope | State / evidence | Handoff |
|---|---|---|---|
| Abhik | Root/proxy scaffold, shared types, Store, schemas, model loop, routing, events, server | Phases 1.1–1.3, 2, 3, 4, 5 on main; `pnpm test` 47/47 and `tsc` pass; live Cerebras not yet run (no key on this laptop) | Materialize wiring in `server.ts`/`app.ts` after garv/materialize merges; see Abhik handoff below |
| Lakshay | Demo app and dashboard | Awaiting owner update | Use agreed SSE events and POST /phantom/materialize response |
| Garv | Materialize, replay gate, handler loading, reset/smoke, demo ops | In progress on garv/materialize; 8 isolated tests pass; implementation on branch, core integration pending | Waiting on core scaffold; independent harness tests underway |

## Garv: integration contract

- `materialize(routes, deps, retryNote?)` returns `{ jobId }` synchronously; HTTP handler returns 202. Reject empty/unlocked routes and concurrent jobs before accepting. Background SSE events all use this jobId.
- Dependencies: `schemas.all()`, `readRecordings({route, okOnly, limit})`, `loadGenerated(keys)`, `setMode(key, 'REAL')`.
- `realHandlers` is a map; `loadGenerated(keys)` validates ALL selected handlers before changing the live map.
- Replay gate must check recorded response AND store mutations, with every selected recording exercised by a Phantom-owned test. Generated tests alone cannot authorize activation.
- Abhik owns `server.ts`: wire POST /phantom/materialize, the REAL dispatch path, and reset. Do not reset while a materialization job is running. Coordinate a write queue so activation never interleaves a mutation.
- Lakshay: phases are context/codex/tests/activate/done/failed. Never display success before done. Failed leaves routes on their previous implementation.
- Runtime contract needed: Store.fromData, dump, reserveId, applyOps; config.PROXY_DIR, GENERATED_DIR, codexTimeoutMs; events.emit.

## Verified facts / blockers

- 2026-11-01: local Node 24.14.1, pnpm 11.25.0, Codex CLI 0.166.0-alpha.5.1.
- This Codex CLI exposes `exec --sandbox workspace-write`; it does NOT expose the plan's `--full-auto`. Flags must be checked on the demo laptop too.
- Root `pnpm test` currently fails because there is no package.json on main. No full integration or live model success is claimed.
- Isolated checks: `node scripts/test-materialize-isolated.mjs ../materialize-harness` — 8/8 pass (activation, generation/test failure, evidence tampering, missing/skipped coverage, child process success/failure). Stub config/events are used: core integration is NOT verified. No secrets belong in this file.

## Update format

Owner / branch or commit / files changed / checks actually run / remaining blocker / next handoff.

## Garv latest handoff

- Exports: materialize, retryMaterialize, isMaterializing, getMaterializeJob. Catch validation/concurrency errors in the server endpoint (400/409). Reset must refuse while isMaterializing().
- activate/done events include tests: {passed,failed,total}. getMaterializeJob() exposes the latest job.
- Cross-platform smoke: node scripts/smoke.mjs (resets development state). Asserts three votes, distinct IDs and repeated per-team reads.
- src/testing/contract.test.ts is Phantom-owned. Generated code must not replace it.
- Pending: core integration/typecheck, live Cerebras smoke, timed full demos and backup recording.

- Real Codex spike succeeded: `codex exec --sandbox workspace-write --skip-git-repo-check -C <isolated-dir>` created hello.ts without an approval prompt using existing ChatGPT sign-in. This proves CLI access, not full Materialize correctness.
- Materialize module strict TypeScript check passes against isolated config/events stubs. Reset and smoke script syntax checks pass.
- Implementation branch: [garv/materialize](https://github.com/garvrao80/phantom/tree/garv/materialize). Pull/cherry-pick only after coordinating ownership. No core files were created or replaced.

## Abhik latest handoff

- **On main:** root workspace (`pnpm@9.15.9`), `packages/proxy` with config, types, store, router, schemas, model (Cerebras + `fakeClient`), prompt, snapshot, validate, phantom loop, cache, events, recorder, routes registry, `app.ts` (dispatch + `/phantom/*`), `server.ts`.
- **Checks run:** `pnpm test` gives 47/47 (unit + Fastify `inject` integration with a fake model, no network). `pnpm exec tsc -p .` is clean. A live boot without a key gives health ok, `/api/*` → 502 `phantom_invalid` recorded and streamed over SSE, CORS preflight 204. **Not run:** any live Cerebras call (no `.env` on this laptop), so the 0.2 spike answers in AGENTS.md section 22 are still open.
- **Run:** `pnpm install`, then `pnpm --filter @phantom/proxy dev` (port 4000). Data goes to `data/`; override it with `PHANTOM_DATA_DIR`.
- **For Garv:**
  - `Store.fromData/dump/reserveId/applyOps` are present.
  - `config.ts` exports `PROXY_DIR`, `GENERATED_DIR` and `config.codexTimeoutMs`.
  - `events.ts` exports a module-level `emit(type, data)` that broadcasts on every open hub.
  - `createApp({ realHandlers })` accepts your `realHandlers` Map; `ctx.dispatch` checks it first (REAL), and real writes go through the same write queue as phantom writes.
  - `ctx.routes.setMode(key, 'REAL')` emits the `route` event.
  - `recorder.read({ route, okOnly, limit })` is exposed as `ctx.recorder.read`.
  - `Handler`/`HandlerCtx` are also in `types.ts`, structurally identical to yours.
- **For Lakshay:**
  - Every `/api/*` response has `x-phantom-mode: PHANTOM|REAL|CACHED|REPLAY|ERROR`.
  - SSE events are `request` (a full recording line), `route` (`{key, mode, locked}`) and `reset`.
  - `GET /phantom/routes` returns `[{key, mode, calls, lastLatencyMs, locked, schema}]`.
  - `GET /phantom/recordings?limit=&route=&okOnly=` returns oldest-first.
  - `POST /phantom/replay {on}` and `POST /phantom/reset` are live.
- **Deviation from plan:** `/api/*` registers GET/POST/PUT/PATCH/DELETE/HEAD only, not OPTIONS, so CORS preflight keeps working.
- **Next (Abhik):** after garv/materialize lands, add `POST /phantom/materialize` (202, 400/409), `/retry`, and a reset guard while `isMaterializing()`, then run the live smoke with a real key.
