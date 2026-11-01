import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { describeRoute } from "../src/describeRoute";
import { BackendPage, type BackendStatus } from "../src/pages/BackendPage";

describe("describeRoute", () => {
  it.each([
    ["POST /teams", "Create a team"],
    ["GET /teams", "List teams"],
    ["GET /teams/:id", "View a team"],
    ["GET /teams/:id/projects", "List a team’s projects"],
    ["POST /projects", "Create a project"],
    ["POST /projects/:id/upvote", "Upvote a project"],
    ["GET /leaderboard", "View the leaderboard"],
    ["DELETE /items/:id", "Delete an item"],
    ["PATCH /categories/:id", "Update a category"],
  ])("%s → %s", (key, text) => expect(describeRoute(key)).toBe(text));
});

class QuietEvents {
  onopen?: () => void;
  onerror?: () => void;
  addEventListener() {}
  close() {}
}
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
function serve(backend: BackendStatus) {
  vi.stubGlobal("EventSource", QuietEvents);
  vi.stubGlobal("fetch", vi.fn((url: string) =>
    Promise.resolve(json(
      url.endsWith("/backend") ? backend
        : url.endsWith("/routes") ? backend.routes.map((r) => ({ ...r, lastLatencyMs: 0 }))
        : url.includes("/recordings") ? []
        : url.endsWith("/materialize") ? { running: false, job: null }
        : { ok: true, model: "gpt-oss-120b", replay: false },
    )),
  ));
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const route = (key: string, mode: string) => ({ key, mode, calls: 1, locked: true });

describe("BackendPage", () => {
  it("says plainly that no backend exists yet", async () => {
    serve({ state: "none", routes: [route("POST /teams", "PHANTOM")], job: null, code: null, testFiles: [] });
    render(<BackendPage />);
    expect(await screen.findByRole("heading", { name: "No backend yet." })).toBeTruthy();
    expect(await screen.findByText("Create a team")).toBeTruthy();
    expect(screen.getByText("AI stand-in")).toBeTruthy();
  });

  it("reveals the live backend with its real code and test count", async () => {
    serve({
      state: "live",
      routes: [route("POST /teams", "REAL"), route("POST /projects/:id/upvote", "REAL")],
      job: { jobId: "job_1", phase: "done", tests: { passed: 17, failed: 0, total: 17 } },
      code: { file: "generated/handlers.ts", lines: 42, source: "export const handlers = { /* real */ };" },
      testFiles: ["generated/tests/teams.test.ts"],
    });
    render(<BackendPage />);
    expect(await screen.findByRole("heading", { name: "Your backend is live." })).toBeTruthy();
    expect(await screen.findByText("Upvote a project")).toBeTruthy();
    expect(screen.getAllByText("✓ Real code")).toHaveLength(2);
    expect(screen.getByText("17")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText(/\/\* real \*\//)).toBeTruthy();
  });

  it("explains a failed build without claiming success", async () => {
    serve({ state: "failed", routes: [route("POST /teams", "PHANTOM")], job: { jobId: "job_1", phase: "failed", error: "2 tests failed" }, code: null, testFiles: [] });
    render(<BackendPage />);
    expect(await screen.findByRole("heading", { name: "This build didn’t pass its tests." })).toBeTruthy();
    expect(screen.queryByText("✓ Real code")).toBeNull();
  });
});
