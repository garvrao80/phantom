import type { Connection, Health, Recording, Route } from "../types";
// USD / million tokens, verified 2026-11-01: https://www.cerebras.ai/pricing
const INPUT_PRICE = Number(
  import.meta.env.VITE_INPUT_PRICE_PER_MILLION ?? 0.35,
);
const OUTPUT_PRICE = Number(
  import.meta.env.VITE_OUTPUT_PRICE_PER_MILLION ?? 0.75,
);
export function statistics(requests: Recording[]) {
  const latencies = requests
    .map((rec) => rec.latencyMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const mid = Math.floor(latencies.length / 2);
  const median = latencies.length
    ? latencies.length % 2
      ? latencies[mid]
      : (latencies[mid - 1] + latencies[mid]) / 2
    : null;
  // Cached / replay responses may retain the original token metadata, but do not incur a new model bill.
  const metered = requests.filter(
    (rec) => rec.mode === "PHANTOM" && !rec.cached,
  );
  const input = metered.reduce((sum, rec) => sum + (rec.tokens?.in ?? 0), 0);
  const output = metered.reduce((sum, rec) => sum + (rec.tokens?.out ?? 0), 0);
  return {
    median,
    input,
    output,
    tokens: input + output,
    cost: (input * INPUT_PRICE + output * OUTPUT_PRICE) / 1_000_000,
  };
}
export function Header({
  health,
  connection,
  requests,
  routes,
  busy,
  onReset,
  onReplay,
}: {
  health: Health | null;
  connection: Connection;
  requests: Recording[];
  routes: Route[];
  busy: boolean;
  onReset: () => void;
  onReplay: (on: boolean) => void;
}) {
  const stats = statistics(requests);
  const configuredPrices =
    import.meta.env.VITE_INPUT_PRICE_PER_MILLION !== undefined &&
    import.meta.env.VITE_OUTPUT_PRICE_PER_MILLION !== undefined;
  const canEstimate =
    (health?.model === "gpt-oss-120b" || configuredPrices) &&
    Number.isFinite(stats.cost);
  return (
    <>
      <header className="topbar">
        <a href="#main" className="wordmark">
          <svg viewBox="0 0 32 36" width="32" height="36" aria-hidden="true">
            <path
              d="M5 30V15a11 11 0 0 1 22 0v15l-5-4-6 4-6-4-5 4Z"
              fill="currentColor"
            />
            <path
              d="M12 15v4m8-4v4"
              stroke="#12101A"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
          <span>
            phantom<span className="wordmark-dot">.</span>
          </span>
          <span className="console-label">MISSION CONTROL</span>
        </a>
        <div className="top-actions">
          <span className={`connection connection-${connection}`} role="status">
            <i />
            {connection === "live"
              ? "Live connection"
              : connection === "connecting"
                ? "Connecting"
                : "Reconnecting"}
          </span>
          <button
            className="quiet-button reset-button"
            onClick={onReset}
            disabled={busy}
          >
            ↺ Reset session
          </button>
        </div>
      </header>
      <div className="page-intro">
        <div>
          <span className="eyebrow">THE FRONTEND IS THE SPEC.</span>
          <h1>Watch your backend become real.</h1>
          <p>Every request is a blueprint. Every click is a test.</p>
        </div>
        <div className="runtime-card">
          <span className="runtime-label">INFERENCE ENGINE</span>
          <strong>{health?.model ?? "Awaiting proxy"}</strong>
          <div>
            <span className="engine-dot" />
            Cerebras <span className="runtime-divider">/</span>
            <label
              className="replay-setting"
              title="Serve recorded responses instead of calling the model"
            >
              <input
                type="checkbox"
                role="switch"
                checked={health?.replay ?? false}
                disabled={busy || !health}
                onChange={(event) => onReplay(event.target.checked)}
                aria-label="Server replay mode"
              />{" "}
              Replay {health ? (health.replay ? "on" : "off") : "unknown"}
            </label>
          </div>
        </div>
      </div>
      <section className="stats-grid" aria-label="Session statistics">
        <div>
          <span>TOTAL CALLS</span>
          <strong>
            {routes
              .reduce((total, route) => total + route.calls, 0)
              .toLocaleString()}
            <small>requests</small>
          </strong>
        </div>
        <div>
          <span>MEDIAN LATENCY</span>
          <strong>
            {stats.median === null ? "—" : Math.round(stats.median)}
            <small>ms</small>
          </strong>
        </div>
        <div>
          <span>MODEL TOKENS</span>
          <strong>
            {stats.tokens.toLocaleString()}
            <small>in + out</small>
          </strong>
        </div>
        <div>
          <span>ESTIMATED COST</span>
          <strong>
            {canEstimate ? `$${stats.cost.toFixed(4)}` : "—"}
            <small>USD</small>
          </strong>
        </div>
      </section>
      <p className="stats-caption">
        Latency, tokens and cost cover the latest {requests.length} loaded
        requests (up to 500).{" "}
        {canEstimate ? (
          <a
            href="https://www.cerebras.ai/pricing"
            target="_blank"
            rel="noreferrer"
          >
            Rates: ${INPUT_PRICE} input / ${OUTPUT_PRICE} output per 1M tokens.
          </a>
        ) : (
          "Pricing unavailable for this model."
        )}
      </p>
    </>
  );
}
