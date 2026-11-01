# Phantom team progress and handoffs

All humans and coding agents: read this file before starting and pushing. Update your own section with the commit/branch, actual checks, and precise dependencies. Fetch before pushing; preserve other owners' entries. Do not treat another owner's pending work as complete.

## Ownership / current state

| Owner | Scope | State / evidence | Handoff |
|---|---|---|---|
| Abhik | Root/proxy scaffold, shared types, Store, schemas, model loop, routing, events, server | Awaiting owner update; main currently contains plans only | Push scaffold + types early; see Garv integration below |
| Lakshay | Demo app and dashboard | Awaiting owner update | Use agreed SSE events and POST /phantom/materialize response |
| Garv | Materialize, replay gate, handler loading, reset/smoke, demo ops | In progress on garv/materialize; initial code local, not yet validated against core | Waiting on core scaffold; independent harness tests underway |

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
- Reset script syntax checked; remaining tests are pending. No secrets belong in this file.

## Update format

Owner / branch or commit / files changed / checks actually run / remaining blocker / next handoff.
