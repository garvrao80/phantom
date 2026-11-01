import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAction, useResource } from "../useResource";
import type { Team as TeamData, Project, ReportError } from "../types";

export function Team({
  id,
  back,
  report,
}: {
  id: string;
  back: () => void;
  report: ReportError;
}) {
  const team = useResource<TeamData>(
    `/teams/${encodeURIComponent(id)}`,
    report,
  );
  const projects = useResource<Project[]>(
    `/teams/${encodeURIComponent(id)}/projects`,
    report,
  );
  const { pending, run } = useAction(report);
  const [title, setTitle] = useState("");
  const [pitch, setPitch] = useState("");
  function create(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !pitch.trim()) return;
    const body = { teamId: id, title: title.trim(), pitch: pitch.trim() };
    void run(async () => {
      await api("POST", "/projects", body);
      setTitle("");
      setPitch("");
      await projects.refresh();
    });
  }
  function upvote(projectId: string) {
    void run(async () => {
      await api("POST", `/projects/${encodeURIComponent(projectId)}/upvote`);
      await projects.refresh();
    });
  }
  return (
    <>
      <button className="back-link" onClick={back}>
        ← All teams
      </button>
      <section className="detail-hero">
        <span className="eyebrow">THE TEAM</span>
        <h1>
          {team.data?.name ??
            (team.loading ? "Loading team…" : "Team unavailable")}
        </h1>
        <p>
          {team.data?.members?.join(" · ") || "A space for your next big idea."}
        </p>
        {team.failed && (
          <button onClick={() => void team.refresh()}>Retry team</button>
        )}
      </section>
      <div className="hub-grid">
        <section>
          <div className="section-heading">
            <h2>
              On the workbench{" "}
              <span className="count">{projects.data?.length ?? "—"}</span>
            </h2>
            <button
              className="text-button"
              disabled={projects.loading}
              onClick={() => void projects.refresh()}
            >
              ↻ Refresh
            </button>
          </div>
          {projects.loading && !projects.data ? (
            <div className="empty-state" role="status">
              Opening the workbench…
            </div>
          ) : projects.failed && !projects.data ? (
            <div className="empty-state">
              <h3>Projects couldn’t load</h3>
              <button onClick={() => void projects.refresh()}>Try again</button>
            </div>
          ) : projects.data?.length === 0 ? (
            <div className="empty-state">
              <span className="empty-symbol">✳</span>
              <h3>An idea is all it takes.</h3>
              <p>Add your first project and give it a place to grow.</p>
            </div>
          ) : (
            <div className="project-list">
              {projects.data?.map((project) => (
                <article className="project-card" key={project.id}>
                  <div>
                    <span className="eyebrow">PROJECT</span>
                    <h3>{project.title}</h3>
                    <p>{project.pitch}</p>
                  </div>
                  <button
                    className="vote-button"
                    disabled={pending}
                    aria-label={`Upvote ${project.title}`}
                    onClick={() => upvote(project.id)}
                  >
                    ↑<strong>{project.votes ?? 0}</strong>
                    <span>votes</span>
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
        <aside className="form-card">
          <span className="eyebrow">FROM IDEA TO IMPACT</span>
          <h2>What are you building?</h2>
          <p>Give your idea a name and tell us why it should exist.</p>
          <form onSubmit={create}>
            <label htmlFor="project-title">Project title</label>
            <input
              id="project-title"
              required
              maxLength={100}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Your next big thing"
            />
            <label htmlFor="project-pitch">The pitch</label>
            <textarea
              id="project-pitch"
              rows={4}
              required
              maxLength={1000}
              value={pitch}
              onChange={(event) => setPitch(event.target.value)}
              placeholder="The problem. The idea. The possibility."
            />
            <button
              className="primary"
              disabled={pending || !team.data || !title.trim() || !pitch.trim()}
            >
              {pending ? "Working…" : "Add project"} <span>↗</span>
            </button>
          </form>
        </aside>
      </div>
    </>
  );
}
