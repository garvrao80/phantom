import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import { api, ApiError, onMode } from "../src/api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const json = (data: unknown, status = 200, mode = "PHANTOM") =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "x-phantom-mode": mode },
  });
describe("Hackathon Hub API flow", () => {
  it("creates a team and project, upvotes, and reads the server leaderboard using the agreed fields", async () => {
    const teams: any[] = [];
    const projects: any[] = [];
    const fetcher = vi.fn(async (url: string, options: RequestInit = {}) => {
      const method = options.method ?? "GET";
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      if (url === "/api/teams" && method === "POST") {
        expect(body).toEqual({ name: "Byte Me", members: ["Lakshay", "Garv"] });
        const team = { id: "team_1", ...body };
        teams.push(team);
        return json(team, 201);
      }
      if (url === "/api/teams") return json(teams);
      if (url === "/api/teams/team_1") return json(teams[0]);
      if (url === "/api/teams/team_1/projects") return json(projects);
      if (url === "/api/projects") {
        expect(body).toEqual({
          teamId: "team_1",
          title: "Phantom",
          pitch: "A backend before it exists",
        });
        const project = { id: "project_1", votes: 0, ...body };
        projects.push(project);
        return json(project, 201);
      }
      if (url === "/api/projects/project_1/upvote") {
        expect(method).toBe("POST");
        expect(options.body).toBeUndefined();
        projects[0].votes++;
        return json(projects[0], 200, "REAL");
      }
      if (url === "/api/leaderboard") return json(projects, 200, "REAL");
      throw new Error(`Unexpected ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Create the first team and make your mark.");
    await user.type(screen.getByLabelText("Team name"), "Byte Me");
    await user.type(screen.getByLabelText(/Members/), "Lakshay, Garv");
    await user.click(screen.getByRole("button", { name: /Create team/ }));
    await screen.findByRole("heading", { name: "Byte Me" });
    await user.type(screen.getByLabelText("Project title"), "Phantom");
    await user.type(
      screen.getByLabelText("The pitch"),
      "A backend before it exists",
    );
    await user.click(screen.getByRole("button", { name: /Add project/ }));
    await screen.findByRole("heading", { name: "Phantom" });
    await user.click(screen.getByRole("button", { name: "Upvote Phantom" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Upvote Phantom" }).textContent,
      ).toContain("1"),
    );
    await user.click(screen.getByRole("button", { name: "Leaderboard" }));
    await screen.findByRole("heading", { name: "Phantom" });
    expect(screen.getByRole("status").textContent).toContain("REAL");
    expect(fetcher.mock.calls.some(([url]) => url === "/api/leaderboard")).toBe(
      true,
    );
  });

  it("keeps the screen usable on a 502 and retries the failed read", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ error: "phantom_invalid" }, 502))
      .mockResolvedValue(json([]));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<App />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "You can retry",
    );
    await user.click(
      screen.getByRole("button", { name: "Retry" }),
    );
    await screen.findByText("Create the first team and make your mark.");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not create the project twice when its subsequent refresh fails", async () => {
    let posts = 0;
    let projectReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit = {}) => {
        if (url === "/api/teams")
          return json([{ id: "team_1", name: "Byte Me", members: [] }]);
        if (url === "/api/teams/team_1")
          return json({ id: "team_1", name: "Byte Me", members: [] });
        if (url === "/api/projects" && options.method === "POST") {
          posts++;
          return json({ id: "project_1" }, 201);
        }
        if (url.endsWith("/projects")) {
          projectReads++;
          return projectReads === 2
            ? json({ error: "unavailable" }, 502)
            : json([]);
        }
        throw new Error(url);
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Byte Me/ }));
    await screen.findByText(
      "Add your first project and give it a place to grow.",
    );
    await user.type(screen.getByLabelText("Project title"), "Phantom");
    await user.type(screen.getByLabelText("The pitch"), "Test");
    await user.click(screen.getByRole("button", { name: /Add project/ }));
    await screen.findByRole("alert");
    await user.click(
      screen.getByRole("button", { name: "Retry" }),
    );
    await waitFor(() => expect(projectReads).toBe(3));
    expect(posts).toBe(1);
  });
});

describe("API wrapper", () => {
  it("explains rate limits without automatically retrying a model request", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ error: "rate_limited" }, 429, "ERROR"));
    vi.stubGlobal("fetch", fetcher);
    await expect(api("GET", "/teams")).rejects.toMatchObject({ status: 429, message: expect.stringContaining("Wait a minute") });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("supports empty responses and broadcasts response modes", async () => {
    const listener = vi.fn();
    const unsubscribe = onMode(listener);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, {
            status: 204,
            headers: { "x-phantom-mode": "REAL" },
          }),
        ),
    );
    expect(await api("DELETE", "/teams/team_1")).toBeNull();
    expect(listener).toHaveBeenCalledWith("REAL");
    unsubscribe();
  });
  it("handles non-JSON proxy errors without leaking response HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>bad gateway</html>", { status: 502 }),
        ),
    );
    await expect(api("GET", "/teams")).rejects.toBeInstanceOf(ApiError);
  });
});
