import { useResource } from "../useResource";
import type { LeaderboardEntry, ReportError } from "../types";
export function Leaderboard({ report }: { report: ReportError }) {
  const board = useResource<LeaderboardEntry[]>("/leaderboard", report);
  return (
    <>
      <section className="hero leaderboard-hero">
        <span className="eyebrow">GOOD IDEAS RISE</span>
        <h1>
          Built by you.
          <br />
          <span>Backed by everyone.</span>
        </h1>
        <p>The projects getting the room talking.</p>
        <div className="hero-index" aria-hidden="true">
          02<span>THE STANDOUTS</span>
        </div>
      </section>
      <section className="leaderboard">
        <div className="section-heading">
          <h2>The leaderboard</h2>
          <button
            className="text-button"
            disabled={board.loading}
            onClick={() => void board.refresh()}
          >
            ↻ Refresh rankings
          </button>
        </div>
        {board.loading && !board.data ? (
          <div className="empty-state" role="status">
            Loading the latest rankings…
          </div>
        ) : board.failed && !board.data ? (
          <div className="empty-state">
            <h3>Rankings couldn’t load</h3>
            <button onClick={() => void board.refresh()}>Try again</button>
          </div>
        ) : board.data?.length === 0 ? (
          <div className="empty-state">
            <span className="empty-symbol">↑</span>
            <h3>The next standout could be yours.</h3>
            <p>Add a project from your team page to get started.</p>
          </div>
        ) : (
          <ol className="ranking-list">
            {board.data?.map((project, index) => (
              <li key={project.id}>
                <span className="rank">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>{project.title}</h3>
                  <p>{project.pitch}</p>
                  {project.teamName && <small>{project.teamName}</small>}
                </div>
                <div className="score">
                  <strong>{project.votes ?? 0}</strong>
                  <span>votes</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
