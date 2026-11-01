import { useEffect, useState } from "react";
import { lastMode, onMode } from "../api";
export function ModeBadge() {
  const [mode, setMode] = useState(lastMode);
  useEffect(() => onMode(setMode), []);
  return (
    <div className="connection-badge" role="status">
      <span className={`mode-dot ${mode.toLowerCase()}`} />
      {mode === "WAITING" ? (
        "Waiting for first response"
      ) : (
        <>
          Last response <strong>{mode}</strong>
        </>
      )}
    </div>
  );
}
