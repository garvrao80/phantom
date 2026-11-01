// Frontend-only test fixture. Never imported by either app or used by the real proxy.
// Run: node scratch/fake-events.mjs [--seed]. Listens only on loopback :4010.
import { createServer } from "node:http";
const clients = new Set();
let teams = [],
  projects = [],
  recordings = [],
  routes = {},
  seq = 0,
  nextTeam = 1,
  nextProject = 1,
  running = false;
const emit = (name, data) => {
  for (const client of clients)
    client.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
};
const send = (res, status, data, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(data));
};
function record(method, path, body, status, response, ops = []) {
  const key = `${method} ${path.replace(/\/(team|project)_\d+/g, "/:id")}`;
  const mode = routes[key]?.mode ?? "PHANTOM";
  const item = {
    seq: ++seq,
    ts: Date.now(),
    mode,
    ok: status < 400,
    routeKey: key,
    req: { method, path, params: {}, query: {}, body: body ?? null },
    res: { status, body: structuredClone(response) },
    storeOps: ops,
    latencyMs: mode === "REAL" ? 4 : 320,
    tokens: { in: 1450, out: 190 },
    retries: 0,
  };
  recordings.push(item);
  routes[key] = {
    key,
    mode,
    calls: (routes[key]?.calls ?? 0) + 1,
    lastLatencyMs: item.latencyMs,
    locked:
      (status < 300 && !(Array.isArray(response) && !response.length)) ||
      routes[key]?.locked ||
      false,
  };
  emit("request", item);
  emit("route", routes[key]);
  return mode;
}
if (process.argv.includes("--seed")) {
  teams = [
    { id: "team_1", name: "Byte Me", members: ["Aarav", "Mira", "Dev"] },
    { id: "team_2", name: "Null Pointers", members: ["Isha", "Kabir"] },
    { id: "team_3", name: "After Hours", members: ["Riya", "Zoya", "Arjun"] },
    { id: "team_4", name: "Ship Happens", members: ["Neel", "Tara"] },
  ];
  nextTeam = 5;
  projects = [
    {
      id: "project_1",
      teamId: "team_1",
      title: "Phantom",
      pitch: "Use a backend before it exists.",
      votes: 12,
    },
    {
      id: "project_2",
      teamId: "team_2",
      title: "Local Loop",
      pitch: "A little more community in every neighborhood.",
      votes: 8,
    },
  ];
  nextProject = 3;
  for (const team of teams)
    record(
      "POST",
      "/teams",
      { name: team.name, members: team.members },
      201,
      team,
    );
  record("GET", "/teams", null, 200, teams);
  record("GET", "/teams/team_1", null, 200, teams[0]);
  record(
    "GET",
    "/teams/team_1/projects",
    null,
    200,
    projects.filter((project) => project.teamId === "team_1"),
  );
  for (const project of projects)
    record(
      "POST",
      "/projects",
      { teamId: project.teamId, title: project.title, pitch: project.pitch },
      201,
      project,
    );
  record("GET", "/leaderboard", null, 200, projects);
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:4010");
  const path = url.pathname;
  const method = req.method;
  if (path === "/phantom/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": fixture connected\n\n");
    clients.add(res);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
    res.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body;
  try {
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    send(res, 400, { error: "Invalid JSON" });
    return;
  }
  if (path === "/phantom/health")
    return send(res, 200, {
      ok: true,
      model: "fixture · no model calls",
      replay: false,
    });
  if (path === "/phantom/routes") return send(res, 200, Object.values(routes));
  if (path === "/phantom/recordings")
    return send(res, 200, recordings.slice(-200));
  if (path === "/phantom/reset" && method === "POST") {
    if (running) return send(res, 409, { error: "A fixture job is running" });
    teams = [];
    projects = [];
    recordings = [];
    routes = {};
    seq = 0;
    nextTeam = 1;
    nextProject = 1;
    emit("reset", {});
    return send(res, 200, { ok: true });
  }
  if (path === "/phantom/materialize" && method === "POST") {
    if (running) return send(res, 409, { error: "A fixture job is running" });
    if (
      !Array.isArray(body?.routes) ||
      !body.routes.length ||
      body.routes.some((key) => !routes[key]?.locked)
    )
      return send(res, 400, { error: "Select locked routes" });
    const keys = body.routes;
    const jobId = `fixture_${Date.now()}`;
    running = true;
    send(res, 202, { jobId });
    ["context", "codex", "tests", "activate", "done"].forEach((phase, index) =>
      setTimeout(() => {
        if (phase === "done") {
          for (const key of keys) {
            routes[key].mode = "REAL";
            emit("route", routes[key]);
          }
          running = false;
        }
        emit("materialize", {
          jobId,
          phase,
          line: `[UI FIXTURE] ${phase} — simulated, no code generation or real verification`,
          ...(index >= 2 ? { tests: { passed: 8, failed: 0, total: 8 } } : {}),
        });
      }, index * 900),
    );
    return;
  }
  if (!path.startsWith("/api/"))
    return send(res, 404, { error: "Fixture endpoint not found" });
  const apiPath = path.slice(4);
  let status = 200;
  let data;
  let ops = [];
  if (apiPath === "/teams" && method === "GET") data = teams;
  else if (apiPath === "/teams" && method === "POST") {
    status = 201;
    data = { id: `team_${nextTeam++}`, ...body };
    teams.push(data);
    ops = [{ op: "insert", collection: "teams", id: data.id, record: data }];
  } else if (/^\/teams\/[^/]+\/projects$/.test(apiPath))
    data = projects.filter(
      (project) => project.teamId === apiPath.split("/")[2],
    );
  else if (/^\/teams\/[^/]+$/.test(apiPath))
    data = teams.find((team) => team.id === apiPath.split("/")[2]);
  else if (apiPath === "/projects" && method === "POST") {
    status = 201;
    data = { id: `project_${nextProject++}`, ...body, votes: 0 };
    projects.push(data);
    ops = [{ op: "insert", collection: "projects", id: data.id, record: data }];
  } else if (/^\/projects\/[^/]+\/upvote$/.test(apiPath) && method === "POST") {
    data = projects.find((project) => project.id === apiPath.split("/")[2]);
    if (data) {
      data.votes++;
      ops = [
        {
          op: "update",
          collection: "projects",
          id: data.id,
          patch: { votes: data.votes },
        },
      ];
    }
  } else if (apiPath === "/leaderboard")
    data = [...projects]
      .sort((a, b) => b.votes - a.votes)
      .map((project) => ({
        ...project,
        teamName: teams.find((team) => team.id === project.teamId)?.name,
      }));
  if (data === undefined) {
    status = 404;
    data = { error: "Not found in UI fixture" };
  }
  const mode = record(method, apiPath, body, status, data, ops);
  send(res, status, data, { "x-phantom-mode": mode });
});
server.listen(4010, "127.0.0.1", () =>
  console.log(
    "UI FIXTURE ONLY: http://127.0.0.1:4010 — no real model, codegen or test gate.",
  ),
);
