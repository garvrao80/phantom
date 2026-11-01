import { useEffect, useRef, useState } from "react";
import { useEvents } from "./useEvents";
import { control } from "./api";
import { isRunning } from "./state";
import { Header } from "./components/Header";
import { RequestLog } from "./components/RequestLog";
import { RouteTable } from "./components/RouteTable";
import { MaterializePanel } from "./components/MaterializePanel";
export default function App() {
  const events = useEvents();
  const [selected, setSelected] = useState<string[]>([]);
  const [filterRoute, setFilterRoute] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const cancelReset = useRef<HTMLButtonElement>(null);
  const routes = Object.values(events.routes).sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  const running = isRunning(events.job);
  const connected = events.connection === "live";
  useEffect(() => {
    setSelected((previous) =>
      previous.filter(
        (key) =>
          events.routes[key]?.locked && events.routes[key]?.mode !== "REAL",
      ),
    );
  }, [events.routes]);
  useEffect(() => {
    setFilterRoute(null);
    setSelected([]);
    setConfirmReset(false);
  }, [events.resetVersion]);
  useEffect(() => {
    if (confirmReset) cancelReset.current?.focus();
  }, [confirmReset]);
  async function start(retry = false) {
    if (sending.current || running || !connected) return;
    sending.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await control<{ jobId: string }>(
        retry ? "/materialize/retry" : "/materialize",
        retry ? {} : { routes: selected },
      );
      if (!result?.jobId)
        throw new Error(
          "The proxy did not return a job ID. Reconnect before starting another job.",
        );
      events.beginJob(result.jobId);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not start materialization.",
      );
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  async function replay(on: boolean) {
    if (sending.current || running || !connected) return;
    sending.current = true;
    setPending(true);
    setError(null);
    try {
      await events.setReplay(on);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not change replay mode.",
      );
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  async function reset() {
    if (sending.current || running) return;
    sending.current = true;
    setPending(true);
    setError(null);
    try {
      await control("/reset", {});
      events.clear();
      events.reconnect();
      setConfirmReset(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Reset failed.");
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  return (
    <div className="dashboard-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header
        health={events.health}
        connection={events.connection}
        requests={events.requests}
        routes={routes}
        busy={pending || running || !connected}
        onReset={() => setConfirmReset(true)}
        onReplay={(on) => void replay(on)}
      />
      <main id="main">
        {(error || events.error || !connected) && (
          <div className="connection-banner" role="alert">
            <span>
              {error ??
                events.error ??
                "Connecting to the Phantom proxy. Existing data stays visible while the stream reconnects."}
            </span>
            <button
              onClick={() => {
                setError(null);
                events.reconnect();
              }}
            >
              Reconnect
            </button>
            {error && (
              <button
                aria-label="Dismiss action error"
                onClick={() => setError(null)}
              >
                ×
              </button>
            )}
          </div>
        )}
        <div className="workspace-grid">
          <RequestLog
            key={events.resetVersion}
            requests={events.requests}
            filterRoute={filterRoute}
            clearFilter={() => setFilterRoute(null)}
          />
          <aside className="control-column">
            <RouteTable
              routes={routes}
              selected={selected}
              setSelected={setSelected}
              busy={pending || running || !connected}
              materialize={() => void start()}
              inspect={setFilterRoute}
            />
            <MaterializePanel
              job={events.job}
              retry={() => void start(true)}
              pending={pending}
              connected={connected}
            />
          </aside>
        </div>
      </main>
      <footer className="dashboard-footer">
        <span>
          <span className="footer-dot" /> THE FRONTEND IS THE SPEC. EVERY CLICK
          IS A TEST.
        </span>
        <span>
          PHANTOM <span className="footer-divider">/</span> DEVDAY EXCHANGE ’26
        </span>
      </footer>
      {confirmReset && (
        <div
          className="modal-backdrop"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !pending) setConfirmReset(false);
            if (event.key === "Tab") {
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              );
              const first = buttons[0],
                last = buttons.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <section
            className="reset-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
            aria-describedby="reset-description"
          >
            <span className="eyebrow">START FRESH</span>
            <h2 id="reset-title">Reset this session?</h2>
            <p id="reset-description">
              This clears the store, recordings, locked schemas and generated
              handlers. Refresh Hackathon Hub afterwards.
            </p>
            <div>
              <button
                className="quiet-button"
                ref={cancelReset}
                disabled={pending}
                onClick={() => setConfirmReset(false)}
              >
                Keep session
              </button>
              <button
                className="danger-button"
                disabled={pending || running}
                onClick={() => void reset()}
              >
                {pending ? "Resetting…" : "Reset everything"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
