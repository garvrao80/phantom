import type { Mode, Recording } from "../types";
export function requestMode(recording: Recording): Mode {
  return !recording.ok || recording.res.status >= 400
    ? "ERROR"
    : recording.cached
      ? "CACHED"
      : recording.mode;
}
export function ModeBadge({ mode }: { mode: Mode }) {
  return (
    <span className={`mode-badge mode-${mode.toLowerCase()}`}>
      <span />
      {mode}
    </span>
  );
}
