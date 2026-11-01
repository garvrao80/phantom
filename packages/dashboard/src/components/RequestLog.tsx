import { useState } from "react";
import { ModeBadge, requestMode } from "./ModeBadge";
import type { Recording } from "../types";
export function RequestLog({
  requests,
  filterRoute,
  clearFilter,
}: {
  requests: Recording[];
  filterRoute: string | null;
  clearFilter: () => void;
}) {
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState("ALL");
  const shown = requests.filter(
    (rec) =>
      (!filterRoute || rec.routeKey === filterRoute) &&
      (mode === "ALL" || requestMode(rec) === mode) &&
      `${rec.req.method} ${rec.req.path}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="panel request-panel" aria-labelledby="request-title">
      <div className="panel-heading">
        <h2 id="request-title">
          <span className="section-icon">≋</span> Request stream{" "}
          <span className="number-label">{requests.length}</span>
        </h2>
        <span className="eyebrow compact">NEWEST FIRST</span>
      </div>
      <div className="log-filters">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search requests"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by method or path…"
          />
        </label>
        <select
          aria-label="Filter request mode"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
        >
          <option value="ALL">All modes</option>
          {["PHANTOM", "REAL", "CACHED", "REPLAY", "ERROR"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
      {filterRoute && (
        <div className="active-filter">
          <code>{filterRoute}</code>
          <button onClick={clearFilter}>Clear route filter ×</button>
        </div>
      )}
      <div className="log-column-labels" aria-hidden="true">
        <span>TIME / MODE</span>
        <span>REQUEST</span>
        <span>STATUS</span>
        <span>LATENCY</span>
      </div>
      <div className="request-list">
        {shown.map((rec) => (
          <details
            className={`request-entry ${requestMode(rec) === "ERROR" ? "failed-request" : ""}`}
            key={rec.seq}
          >
            <summary>
              <div className="request-meta">
                <time dateTime={new Date(rec.ts).toISOString()}>
                  {new Date(rec.ts).toLocaleTimeString("en-GB", {
                    hour12: false,
                  })}
                </time>
                <ModeBadge mode={requestMode(rec)} />
              </div>
              <div className="request-path">
                <span
                  className={`method method-${rec.req.method.toLowerCase()}`}
                >
                  {rec.req.method}
                </span>
                <span title={rec.req.path}>{rec.req.path}</span>
              </div>
              <span
                className={`status-code ${rec.res.status >= 400 ? "text-error" : ""}`}
              >
                {rec.res.status}
              </span>
              <span className="latency">
                {Math.round(rec.latencyMs)}
                <small>ms</small>
                <span className="expand-arrow">⌄</span>
              </span>
            </summary>
            <div className="request-detail">
              {[
                ["Request", rec.req],
                ["Response", rec.res],
                ["Store operations", rec.storeOps],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <h3>{String(label)}</h3>
                  <pre>{JSON.stringify(value, null, 2)}</pre>
                </div>
              ))}
              {rec.retries > 0 && <p>Validation retries: {rec.retries}</p>}
            </div>
          </details>
        ))}
        {!shown.length && (
          <div className="empty-log">
            <div className="signal-art" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <h3>
              {requests.length ? "No matching requests" : "Ready when you are."}
            </h3>
            <p>
              {requests.length
                ? "Try another filter to find your request."
                : "Use Hackathon Hub to send your first request. It will appear here as it happens."}
            </p>
            <code>/api/* → Phantom → your app</code>
          </div>
        )}
      </div>
      <div className="panel-footer">
        <span>{shown.length} requests shown</span>
        <span>● Recorded as they happen</span>
      </div>
    </section>
  );
}
