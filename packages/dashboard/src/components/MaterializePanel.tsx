import { useEffect, useRef, useState } from "react";
import type { Job } from "../types";
import { plainTerminalText } from "../plainTerminalText";
const phases = ["context", "codex", "tests", "activate"] as const;
export function MaterializePanel({
  job,
  retry,
  pending,
  connected,
}: {
  job: Job | null;
  retry: () => void;
  pending: boolean;
  connected: boolean;
}) {
  const log = useRef<HTMLPreElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [job?.lines.length, follow]);
  if (!job)
    return (
      <section className="materialize-idle">
        <span className="sparkle">✦</span>
        <div>
          <h3>From possibility to production code.</h3>
          <p>
            Materialize turns your recorded requests into real handlers, then
            verifies them before switching traffic.
          </p>
        </div>
      </section>
    );
  const index =
    job.phase === "done"
      ? phases.length
      : phases.indexOf(job.phase as (typeof phases)[number]);
  return (
    <section
      className={`panel job-panel job-${job.phase}`}
      aria-labelledby="job-title"
    >
      <div className="panel-heading">
        <h2 id="job-title">✦ Materialize</h2>
        <span className="job-id" title={job.jobId}>
          {job.jobId}
        </span>
      </div>
      <ol className="phase-stepper">
        {phases.map((phase, position) => (
          <li
            key={phase}
            className={
              index > position
                ? "complete"
                : index === position
                  ? "current"
                  : ""
            }
            aria-current={index === position ? "step" : undefined}
          >
            <span>
              {index > position ? "✓" : String(position + 1).padStart(2, "0")}
            </span>
            {phase}
          </li>
        ))}
      </ol>
      <div className="log-title">
        <span>JOB OUTPUT</span>
        <label>
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
          />{" "}
          Follow
        </label>
      </div>
      <pre className="job-log" ref={log} aria-label="Materialize job output">
        {job.lines.length ? plainTerminalText(job.lines.join("\n")) : "Waiting for job output…"}
      </pre>
      <div className="job-result" role="status">
        {job.phase === "done" ? (
          <>
            <strong>
              ✓{" "}
              {job.tests
                ? `${job.tests.passed} tests passed`
                : "Materialization complete"}
            </strong>
            <p>Verification complete. Selected routes are now REAL.</p>
            <a className="open-backend" href="#/backend" target="_blank" rel="noopener">
              Open your backend →
            </a>
          </>
        ) : job.phase === "failed" ? (
          <>
            <strong>Materialize failed</strong>
            <p>
              {job.tests
                ? `${job.tests.failed} of ${job.tests.total} tests failed. `
                : ""}
              Routes stay on their previous implementation.
            </p>
            <button
              className="quiet-button"
              disabled={pending || !connected}
              onClick={retry}
            >
              {pending ? "Starting retry…" : "↻ Retry with failure output"}
            </button>
          </>
        ) : (
          <>
            <strong>
              {connected
                ? `${job.phase === "activate" ? "Activating verified handlers" : job.phase === "tests" ? "Running independent verification" : job.phase === "codex" ? "Codex is building your backend" : "Preparing recorded context"}…`
                : "Connection lost. Waiting for job updates…"}
            </strong>
            {job.tests && (
              <p>
                {job.tests.passed} / {job.tests.total} tests passed. Waiting for
                completion.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
