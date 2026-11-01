import { useCallback, useState } from "react";
import { Teams } from "./pages/Teams";
import { Team } from "./pages/Team";
import { Leaderboard } from "./pages/Leaderboard";
import { ModeBadge } from "./components/ModeBadge";
import { Toast, type Notice } from "./components/Toast";
import type { ReportError } from "./types";
export default function App() {
  const [tab, setTab] = useState<"teams" | "leaderboard">("teams");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const report = useCallback<ReportError>(
    (error, retry) =>
      setNotice({
        message:
          error instanceof Error ? error.message : "Something went wrong.",
        retry,
      }),
    [],
  );
  function navigate(next: typeof tab) {
    setTab(next);
    setTeamId(null);
    setNotice(null);
  }
  return (
    <div className="hub-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="hub-header">
        <button
          className="brand"
          onClick={() => navigate("teams")}
          aria-label="Hackathon Hub home"
        >
          <span className="brand-mark">
            h<span>↗</span>
          </span>
          <span>
            hackathon<span className="brand-light">hub</span>
          </span>
        </button>
        <nav aria-label="Main navigation">
          <button
            aria-current={tab === "teams" ? "page" : undefined}
            onClick={() => navigate("teams")}
          >
            Teams
          </button>
          <button
            aria-current={tab === "leaderboard" ? "page" : undefined}
            onClick={() => navigate("leaderboard")}
          >
            Leaderboard
          </button>
        </nav>
        <span className="event-tag">
          <span /> BUILD DAY ’26
        </span>
      </header>
      <main id="main">
        {tab === "leaderboard" ? (
          <Leaderboard report={report} />
        ) : teamId ? (
          <Team
            key={teamId}
            id={teamId}
            back={() => {
              setTeamId(null);
              setNotice(null);
            }}
            report={report}
          />
        ) : (
          <Teams
            openTeam={(id) => {
              setTeamId(id);
              setNotice(null);
            }}
            report={report}
          />
        )}
      </main>
      <footer className="hub-footer">
        <span>Made of ideas. Built by people.</span>
        <span>
          POWERED BY <strong>PHANTOM</strong>
        </span>
      </footer>
      <ModeBadge />
      <Toast notice={notice} dismiss={() => setNotice(null)} />
    </div>
  );
}
