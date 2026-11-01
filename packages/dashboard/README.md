# Phantom dashboard — Lakshay

React 18 + Vite mission control for the Phantom proxy. Fonts are bundled locally, so the interface does not need Google Fonts or an internet connection.

From the repository root:

```sh
pnpm install
pnpm --filter @phantom/dashboard dev
pnpm --filter @phantom/dashboard test
pnpm --filter @phantom/dashboard build
```

Open `http://127.0.0.1:5174`. The Vite development server forwards `/phantom/*` to `http://127.0.0.1:4000`. `PHANTOM_PROXY_TARGET` overrides that upstream for local testing. Production static files require a reverse proxy for `/phantom/*`; `vite preview` alone does not supply a backend.

## Included

- Initial routes, recordings and health snapshots; live request/route/reset/materialize events; automatic EventSource reconnect and snapshot refresh.
- Newest-first expandable request log, method/path search, mode and route filters; bounded history (500 requests and 1,000 job log lines).
- Route counts, schema locks, selection restricted to locked PHANTOM routes, confirmed reset, server-backed replay toggle.
- Materialize job ID tracking, context/codex/tests/activate stepper, streaming output with follow control, failed-job retry, and success only on `done`.
- Responsive layout, keyboard-accessible controls, reduced-motion support, 15px request rows, short green route activation animation.
- True median latency; token/cost estimates exclude cached and replayed token metadata. Statistics clearly describe the loaded window rather than claiming lifetime totals.

## API handoff

- `GET /phantom/health`, `/routes`, `/recordings?limit=200`, `/events`
- `POST /phantom/replay {on: boolean}` → `{replay: boolean}`
- `POST /phantom/reset {}`
- `POST /phantom/materialize {routes: string[]}` → `202 {jobId}`
- `POST /phantom/materialize/retry {}` → `202 {jobId}`

The Materialize endpoints must be wired by the proxy owner. Backend reset/concurrency guards remain essential even though this UI disables reset, replay and generation while a known job runs. A full page reload cannot recover a previous job's status/logs until the server exposes a job-status endpoint; SSE has no replay cursor. Reconnect restores route and recording snapshots but cannot reconstruct missed job events. Do not interpret a stalled phase as success.

The default estimate uses GPT OSS 120B rates checked at https://www.cerebras.ai/pricing on 2026-11-01: $0.35 input / $0.75 output per million tokens. Override both `VITE_INPUT_PRICE_PER_MILLION` and `VITE_OUTPUT_PRICE_PER_MILLION` for a different model or rate. For an unknown model with no configured prices, the dashboard shows no estimate. Never put API secrets in `VITE_*` variables.

## Isolated visual testing

`scratch/fake-events.mjs` is a local UI fixture, not a backend implementation. It never calls Cerebras or Codex and does not prove generated-code verification.

```powershell
# Terminal 1, from the repository root
node scratch/fake-events.mjs --seed
# Terminal 2
$env:PHANTOM_PROXY_TARGET='http://127.0.0.1:4010'
pnpm --filter @phantom/dashboard dev
# Terminal 3, same environment override
$env:PHANTOM_PROXY_TARGET='http://127.0.0.1:4010'
pnpm --filter @phantom/demo-app dev
```

Omit `--seed` to verify empty states. Use normal `pnpm dev` without `PHANTOM_PROXY_TARGET` for the real proxy. Fixture data exists only in that process's memory. The production apps contain no mock data.

Tests include React interaction checks for replay, Materialize, reset, reconnect, early SSE messages and failure states, plus an HTTP integration test using the actual Fastify proxy with an injected model. Root `pnpm test` currently selects only the proxy; run the frontend package tests explicitly as shown above.
