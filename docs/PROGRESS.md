# Phantom team progress and handoffs

All humans and coding agents: read this file before starting and pushing. Update your own section with the commit/branch, actual checks, and precise dependencies. Fetch before pushing; preserve other owners' entries. Do not treat another owner's pending work as complete.

## Ownership / current state

| Owner | Scope | State / evidence | Handoff |
|---|---|---|---|
| Abhik | Root/proxy scaffold, shared types, Store, schemas, model loop, routing, events, server | Phases 1.1–1.3, 2, 3, 4, 5 on main; `pnpm test` 58/58 and `tsc` pass; live Cerebras smoke passed; **Materialize wired and verified live end to end** | Core done. Next: help with demo hardening and the 5-route timing; see Abhik handoff below |
| Lakshay | Demo app and dashboard | Awaiting owner update | Use agreed SSE events and POST /phantom/materialize response |
| Garv | Materialize, replay gate, handler loading, reset/smoke, demo ops | Endpoint changes reviewed; 58 core + 8 isolated tests pass; strict typecheck passes; five-route live rehearsal blocked on votes/upvotes mismatch | HTTP wiring landed; two core blockers below; UI still pending |

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
- Root scaffold has arrived: `pnpm test` passes 47/47 after dependency resolution; Cerebras live verification remains pending.
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
- **Checks run:** `pnpm test` gives 47/47 (unit + Fastify `inject` integration with a fake model, no network). `pnpm exec tsc -p .` is clean. A live boot without a key gives health ok, `/api/*` → 502 `phantom_invalid` recorded and streamed over SSE, CORS preflight 204. **Live (1 Nov):** Cerebras spike done; results are in AGENTS.md section 22. The paced smoke through the proxy passed: ids `team_1`/`project_1`, all routes locked, upvote increments `votes`, the leaderboard is derived, and the repeat read is CACHED. Median latency 1.29 s.
- **⚠ Rate limit: the trial key allows 5 requests/min, 150/hour.** Clicking fast during the demo will hit it. The proxy now returns a fast `429 {error:"rate_limited"}` (no retry) with mode ERROR. Lakshay: show a friendly "slow down" toast on 429. Mitigations: GET cache, replay mode, pre-warm routes before presenting; ask the Cerebras team at the venue for a higher limit.
- **Fixed after live test:** `POST /projects/:id/upvote` used to reserve an id in a new `upvote` collection. Only plural last segments now become new collections, so action routes update the existing record.
- `.env` now sets `CEREBRAS_REASONING_EFFORT=low` (cuts reasoning tokens about 3×).
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

## Garv verified integration — 2026-11-01 12:40 IST

- Merged Abhik main through 722bfd7. Fixed event emitter typing and runtime generated-module import so core typecheck passes before generation.
- `pnpm test`: 47/47; isolated Materialize tests: 8/8; proxy typecheck: pass.
- **Real Codex test passed:** `pnpm --filter @phantom/proxy exec tsx ../../scripts/verify-materialize.ts`. Scripted Cerebras input creates team_1 via PHANTOM; actual Codex generates handlers; actual Vitest gate passes 4/4; then the real dispatcher creates team_2 via REAL and preserves team_1. Exactly one fake-model call. This verifies backend handoff but NOT live Cerebras or UI. Measured run: 38.293 seconds, one route.
- Windows fix: invoke installed Vitest through Node directly; nested pnpm shim failed under the child-process environment. Process errors now retain output tail for retries.
- Refreshed lockfile under the active 24-hour minimum-release-age policy (old lock included newly released Rollup). No age-policy bypass. Approved only esbuild's required install script. Root manifests/framework choices unchanged.
- **Abhik next:** wire materialize/retry endpoints and reset guard using exports above. Core `app.ts` cache currently keys by normalized route + query + version, omitting actual path: GET /teams/team_1 can leak into GET /teams/team_2. Please include path/params in the key and add a regression test. REAL/REPLAY recordings are excluded from future materializations because their recorded storeOps do not capture actual mutations.
- **Remaining:** endpoint/UI integration, live Cerebras smoke, full demo rehearsal. PR #1 may be merged for wiring; do not call the full app complete yet.

## Garv rehearsal / release work — 2026-11-01

- Local Cerebras key supplied and stored only in ignored .env; never shared through GitHub.
- Three consecutive clean-generated backend rehearsals with scripted Cerebras input and real Codex passed: 32.184s, 48.299s, 41.281s; 4/4 verification tests each.
- First **live Cerebras + live Codex** backend rehearsal passed: initial request 717ms; generation/verification/handoff 38.159s; 4/4 tests; team_2 created through REAL with team_1 preserved. Single-request latency, not a benchmark median.
- Added repeatable rehearsal recorder and JSON results, preflight checks, a terminal-recording MP4 renderer, and README operating instructions. UI backup video remains pending Lakshay's UI.
- Abhik: your latest core changes were pulled. Please wire materialize/retry/reset guard and fix the per-ID GET cache key noted above. Garv has not edited app.ts/server.ts.

## Garv release handoff — live multi-route blocker reproduced

- **Three live backend rehearsals PASS:** 38.159s / 38.185s / 38.249s handoff, 717ms / 659ms / 907ms initial request, 4/4 tests each. Clean generated directory and isolated store each run. Real Cerebras and real Codex used.
- **Multi-route live smoke FAILS at GET team_2:** cached response returns team_1 (Byte Me) instead of team_2 (Null Pointers). Recording seq 5 reports mode=CACHED, req.path=/teams/team_2, res.body.id=team_1. This is the known normalized-path cache collision, not a model or quota failure.
- Abhik owns app.ts: prepared `scripts/core-cache-fix.patch` with the one-line request-path cache-key fix; please apply and add your regression test. Garv deliberately did not overwrite your core file. Re-run `node scripts/smoke.mjs` after fix (default 14s API spacing).
- `node scripts/start-local.mjs` reliably resolves the root .env across Windows shells. `scripts/rehearse.mjs` saves timestamped terminal recordings and measurements; `scripts/render-recording.py` makes an MP4 from actual output.
- Backend-only backup MP4 generated locally; full UI backup still awaits frontend and endpoint wiring. No frontend packages are on main yet.
- Current checks: core 53/53 + proxy typecheck pass. Final app is NOT signed off while cache collision/endpoint/UI work remains.

### Abhik: Materialize wiring (1 Nov)

- **Wired:**
  - `POST /phantom/materialize` returns `202 {jobId}`, or `400` (unlocked or unrecorded route), `409` (a job is running) or `501`.
  - `POST /phantom/materialize/retry` (`202`/`409`) and `GET /phantom/materialize` (`{running, job}`).
  - `POST /phantom/reset` returns `409` while a job runs.
  - `server.ts` passes Garv's `realHandlers` map, `loadGenerated` and the controller. Activation runs through the core write queue.
- **Tests:** `test/materialize-wiring.test.ts` has 5 tests: the endpoints, error mapping, and a full pass through Garv's real `createMaterializer` with stubbed codex/vitest, which flips a route to REAL. Core 58/58; Garv's `scripts/materialize.test.ts` is 8/8 after the change below.
- **Live result:** real Cerebras recorded `POST /teams` and `GET /teams`; real Codex then generated `handlers.ts` and `tests/teams.test.ts`. The gate passed 7/7, both routes went REAL in **51 s**, and new requests were served by the generated code with the data carried over (`team_2`).
- **Codex model gotcha:** this laptop's global `~/.codex/config.toml` has `model = "gpt-6.1-sol"`, which the ChatGPT plan rejects (`model_not_found`), so the first live run failed cleanly (routes stayed PHANTOM). From the cached model list, `gpt-6-sol` works.
- **Change in Garv's `materialize.ts` (one line, please review):** codex args now include optional `-m $CODEX_MODEL` and `-c model_reasoning_effort=$CODEX_REASONING_EFFORT` from `.env`, via `config.codexModel`/`config.codexReasoningEffort` and a new `codexArgs` option. Empty means each person's own Codex config. **Check your model with:** `codex exec --skip-git-repo-check -s read-only -m <model> "Reply OK"`.

## Garv: latest HTTP verification — core 7f3231d

- Reviewed Abhik's optional CODEX_MODEL / CODEX_REASONING_EFFORT support; compatible with Garv's controller. No override needed on Garv's machine.
- Ran core suite: 58/58; strict proxy typecheck passes; isolated Materialize gate: 8/8.
- Added `scripts/verify-http-materialize.ts`: five real Cerebras routes, POST materialize, duplicate/reset 409 guards, GET job polling, then all five routes exercised as REAL with new data. It preserves generated artifacts, uses an isolated store, and writes diagnostic evidence on failure.
- **Two live attempts stop before Materialize:** project upvote data violates the demo's field contract. Exact stored record: `{id: "project_1", teamId: "team_1", title: "Phantom", pitch: "Backend before it exists", upvotes: 1}`. The expected `votes: 1` is missing. HTTP 200 alone is not success for the demo UI.
- **Abhik action:** establish/enforce the project's `votes` field before the first schema locks (e.g. feed the demo field contract into the model and validate against it). Current prompt only says conventional REST shape, so `upvotes` is a plausible model choice. Do not silently change the UI contract or relax the test to accept either field. Then rerun this five-route test.
- **Separate unresolved bug:** per-ID GET cache collision is still present in app.ts on 7f3231d; `scripts/core-cache-fix.patch` remains applicable.
- Full five-route generation timing cannot be claimed yet; this test deliberately does not materialize an already-invalid prototype. Previous one-route live runs and Abhik's two-route live run remain valid evidence for their scope.
- No frontend package exists on main yet, so UI checks and a UI backup video remain pending.
