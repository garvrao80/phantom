# Phantom team progress and handoffs

All humans and coding agents: read this file before starting and pushing. Update your own section with the commit/branch, actual checks, and precise dependencies. Fetch before pushing; preserve other owners' entries. Do not treat another owner's pending work as complete.

## Ownership / current state

| Owner | Scope | State / evidence | Handoff |
|---|---|---|---|
| Abhik | Root/proxy scaffold, shared types, Store, schemas, model loop, routing, events, server | Awaiting owner update; main currently contains plans only | Push scaffold + types early; see Garv integration below |
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
