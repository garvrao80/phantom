import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAction, useResource } from "../useResource";
import type { Team, ReportError } from "../types";

export function Teams({
  openTeam,
  report,
}: {
  openTeam: (id: string) => void;
  report: ReportError;
}) {
  const teams = useResource<Team[]>("/teams", report);
  const { pending, run } = useAction(report);
  const [name, setName] = useState("");
  const [members, setMembers] = useState("");
  function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const body = {
      name: name.trim(),
      members: members
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    };
    void run(async () => {
      const team = await api<Team>("POST", "/teams", body);
      openTeam(team.id);
    });
  }
  return (
    <>
      <section className="hero">
        <div className="eyebrow">
          <span className="tiny-star">✳</span> NEW DELHI / DEVDAY EXCHANGE
        </div>
        <h1>
          Big ideas.
          <br />
          <span>Better together.</span>
        </h1>
        <p>
          Find your people. Build something that matters.
          <br />
          Your next great project starts with a team.
        </p>
        <div className="hero-index" aria-hidden="true">
          01<span>THE BUILDERS</span>
        </div>
      </section>
      <div className="hub-grid">
        <section aria-labelledby="teams-title">
          <div className="section-heading">
            <h2 id="teams-title">
              The teams{" "}
              <span className="count">{teams.data?.length ?? "—"}</span>
            </h2>
            <button
              className="text-button"
              onClick={() => void teams.refresh()}
              disabled={teams.loading}
            >
              ↻ Refresh
            </button>
          </div>
          {teams.loading && !teams.data ? (
            <div className="empty-state" role="status">
              Finding the builders…
            </div>
          ) : teams.failed && !teams.data ? (
            <div className="empty-state">
              <h3>Teams couldn’t load</h3>
              <button onClick={() => void teams.refresh()}>Try again</button>
            </div>
          ) : teams.data?.length === 0 ? (
            <div className="empty-state">
              <span className="empty-symbol">↗</span>
              <h3>Every great build starts here.</h3>
              <p>Create the first team and make your mark.</p>
            </div>
          ) : (
            <div className="team-grid">
              {teams.data?.map((team, index) => (
                <button
                  className="team-card"
                  key={team.id}
                  onClick={() => openTeam(team.id)}
                >
                  <div className="card-top">
                    <span className={`team-avatar color-${index % 4}`}>
                      {team.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="card-arrow">↗</span>
                  </div>
                  <h3>{team.name}</h3>
                  <p>
                    {team.members?.length ?? 0}{" "}
                    {(team.members?.length ?? 0) === 1 ? "builder" : "builders"}
                  </p>
                  <div className="member-names">
                    {team.members?.join(" · ") || "Room for a great idea"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
        <aside className="form-card">
          <span className="eyebrow">MAKE IT OFFICIAL</span>
          <h2>Assemble your team.</h2>
          <p>
            One name. A few good people.
            <br />
            Endless possibilities.
          </p>
          <form onSubmit={create}>
            <label htmlFor="team-name">Team name</label>
            <input
              id="team-name"
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Something worth remembering"
            />
            <label htmlFor="team-members">
              Members <span>(comma separated)</span>
            </label>
            <textarea
              id="team-members"
              rows={3}
              maxLength={600}
              value={members}
              onChange={(event) => setMembers(event.target.value)}
              placeholder="You, your co-builders…"
            />
            <button className="primary" disabled={pending || !name.trim()}>
              {pending ? "Creating team…" : "Create team"} <span>↗</span>
            </button>
          </form>
          <small>Build together. Ship together.</small>
        </aside>
      </div>
    </>
  );
}
