import { useEffect, useState } from "react";
import { useEvents } from "../useEvents";
import { control } from "../api";
import { isRunning } from "../state";
import { describeRoute } from "../describeRoute";
import { plainTerminalText } from "../plainTerminalText";
import type { Phase, Recording } from "../types";
import "../backend.css";

// Shape of GET /phantom/backend (packages/proxy/src/app.ts).
export type BackendStatus = {
  state: "none" | "building" | "live" | "failed";
  routes: { key: string; mode: string; calls: number; locked: boolean }[];
  job: {
    jobId: string;
    phase: Phase;
    tests?: { passed: number; failed: number; total: number };
    error?: string;
  } | null;
  code: { file: string; lines: number; source: string } | null;
  testFiles: string[];
};

const STEPS: { phase: Phase; label: string }[] = [
  { phase: "context", label: "Reading the app’s recorded clicks" },
  { phase: "codex", label: "Codex is writing the server code" },
  { phase: "tests", label: "Testing it against every recorded click" },
  { phase: "activate", label: "Switching the app over to it" },
];

function median(requests: Recording[], mode: "PHANTOM" | "REAL") {
  const values = requests
    .filter((r) => r.mode === mode && r.ok)
    .map((r) => r.latencyMs)
    .sort((a, b) => a - b);
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}
const ms = (value: number | null) =>
  value === null ? "—" : value < 1 ? "<1 ms" : `${Math.round(value)} ms`;

export function BackendPage() {
  const events = useEvents();
  const [backend, setBackend] = useState<BackendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const realCount = Object.values(events.routes).filter((r) => r.mode === "REAL").length;
  const phase = events.job?.phase;
  const routeCount = Object.keys(events.routes).length;

  useEffect(() => {
    document.title = "Phantom · Your backend";
  }, []);
  // Refresh whenever a feature appears, the job moves or routes flip, so the reveal happens the moment Materialize finishes.
  useEffect(() => {
    const controller = new AbortController();
    control<BackendStatus>("/backend", undefined, controller.signal)
      .then((status) => {
        setBackend(status);
        setError(null);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : "Cannot reach Phantom.");
      });
    return () => controller.abort();
  }, [phase, realCount, routeCount, events.resetVersion]);

  const state = isRunning(events.job) ? "building" : backend?.state ?? "none";
  const currentPhase = (isRunning(events.job) ? events.job?.phase : backend?.job?.phase) ?? "context";
  const stepIndex = STEPS.findIndex((s) => s.phase === currentPhase);
  const tests = events.job?.tests ?? backend?.job?.tests;
  // The proxy lists routes in the order the app first used them, which reads like the app's own story.
  const features = backend?.routes ?? [];
  const lastLine = plainTerminalText(
    [...(events.job?.lines ?? [])].reverse().find((l) => l.trim()) ?? "",
  ).slice(0, 140);

  return (
    <div className={`bk-shell bk-${state}`}>
      <header className="bk-top">
        <span className="bk-mark">
          phantom<span>.</span> <small>YOUR BACKEND</small>
        </span>
        <a className="bk-back" href="#/">
          ← Control room
        </a>
      </header>

      {error && (
        <p className="bk-error" role="alert">
          {error}
        </p>
      )}

      <section className="bk-hero" aria-live="polite">
        {state === "none" && (
          <>
            <div className="bk-ghost" aria-hidden="true">👻</div>
            <span className="bk-eyebrow">YOUR BACKEND</span>
            <h1>No backend yet.</h1>
            <p>
              The app works right now because an AI on Cerebras is <strong>standing in</strong> as its
              backend. No server code has been written.
            </p>
          </>
        )}
        {state === "building" && (
          <>
            <div className="bk-spinner" aria-hidden="true" />
            <span className="bk-eyebrow">BUILDING</span>
            <h1>Your backend is being built.</h1>
            <p>
              Codex is turning the app’s recorded clicks into real server code. Phantom tests it before
              anything switches over.
            </p>
          </>
        )}
        {state === "live" && (
          <>
            <div className="bk-check" aria-hidden="true">✓</div>
            <span className="bk-eyebrow">LIVE</span>
            <h1>Your backend is live.</h1>
            <p>
              Codex wrote this code just now, Phantom tested it, and the app is <strong>running on it</strong>.
            </p>
          </>
        )}
        {state === "failed" && (
          <>
            <div className="bk-ghost" aria-hidden="true">👻</div>
            <span className="bk-eyebrow">NOT SWITCHED</span>
            <h1>This build didn’t pass its tests.</h1>
            <p>Nothing was switched. The app keeps running on the AI stand-in until a build passes.</p>
          </>
        )}
      </section>

      {state === "live" && (
        <section className="bk-stats" aria-label="Backend summary">
          <div>
            <strong>{realCount || features.filter((f) => f.mode === "REAL").length}</strong>
            <span>features running on real code</span>
          </div>
          <div>
            <strong>{tests ? tests.passed : "—"}</strong>
            <span>tests passed</span>
          </div>
          <div>
            <strong>{backend?.code?.lines ?? "—"}</strong>
            <span>lines of code written by Codex</span>
          </div>
          {median(events.requests, "REAL") === null ? (
            <div>
              <strong>{ms(median(events.requests, "PHANTOM"))}</strong>
              <span>AI stand-in response time. Real code is measured on its first request.</span>
            </div>
          ) : (
            <div>
              <strong>
                {ms(median(events.requests, "PHANTOM"))} <em>→</em> {ms(median(events.requests, "REAL"))}
              </strong>
              <span>response time: AI stand-in → real code</span>
            </div>
          )}
        </section>
      )}

      <div className="bk-grid">
        {state === "building" && (
          <section className="bk-panel" aria-labelledby="bk-progress">
            <h2 id="bk-progress">Progress</h2>
            <ol className="bk-steps">
              {STEPS.map((step, i) => (
                <li key={step.phase} className={i < stepIndex ? "done" : i === stepIndex ? "now" : ""}>
                  <span>{i < stepIndex ? "✓" : i + 1}</span>
                  {step.label}
                </li>
              ))}
            </ol>
            {lastLine && <p className="bk-ticker">{lastLine}</p>}
          </section>
        )}
        <section className="bk-panel" aria-labelledby="bk-features">
          <h2 id="bk-features">What the backend does</h2>
          {features.length ? (
            <ul className="bk-features">
              {features.map((f, i) => (
                <li key={f.key} className={f.mode === "REAL" ? "real" : ""} style={{ animationDelay: `${i * 120}ms` }}>
                  <span className="bk-feature-name">{describeRoute(f.key)}</span>
                  <code>{f.key}</code>
                  <span className="bk-chip">{f.mode === "REAL" ? "✓ Real code" : "AI stand-in"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="bk-muted">Use the app. Phantom records every feature it needs.</p>
          )}
        </section>


        {state === "live" && backend?.code && (
          <section className="bk-panel bk-code" aria-labelledby="bk-code">
            <h2 id="bk-code">
              The code Codex wrote <code>{backend.code.file}</code>
            </h2>
            <pre tabIndex={0}>{backend.code.source}</pre>
            {backend.testFiles.length > 0 && (
              <p className="bk-muted">Checked by {backend.testFiles.join(", ")} and Phantom’s own replay tests.</p>
            )}
          </section>
        )}

        {(state === "none" || state === "failed") && (
          <section className="bk-panel" aria-labelledby="bk-how">
            <h2 id="bk-how">How it becomes real</h2>
            <ol className="bk-steps">
              {STEPS.map((step, i) => (
                <li key={step.phase}>
                  <span>{i + 1}</span>
                  {step.label}
                </li>
              ))}
            </ol>
            <p className="bk-muted">Press Materialize in the control room to start.</p>
            {state === "failed" && backend?.job?.error && <p className="bk-ticker">{backend.job.error.slice(0, 200)}</p>}
          </section>
        )}
      </div>

      <footer className="bk-foot">
        This page shows the backend Codex generated. The control room only watches the app’s traffic.
      </footer>
    </div>
  );
}
