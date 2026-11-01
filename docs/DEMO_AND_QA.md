# Phantom: the complete explainer and judging prep

Part 1 explains the project. Part 2 gets you ready for the demo. Part 3 is the judge Q&A bank. Read Part 1 until you can say it without looking.

---

# PART 1: What Phantom is

## 1.1 The problem, in one story

Priya builds the frontend of a new app. Arjun builds the backend. Priya finishes the "Create team" screen on Monday, but Arjun's `/teams` API won't be ready until Thursday. Priya can either:
- **wait** (wasted days), or
- **write fake data by hand**: a mock file saying "return this JSON". But mocks are dumb. If she creates a team and then refreshes, the team isn't there. She can't test the real flow. And when Arjun's real API arrives, its shape is different from her mock, so things break.

On top of that, nobody wrote down exactly what the API should look like. The real spec lives in Priya's head and in her frontend code.

## 1.2 What Phantom does

Phantom sits between the frontend and a backend that doesn't exist yet, and acts like the backend.

- When Priya's app calls `POST /api/teams`, Phantom asks a very fast AI model (on Cerebras) to answer the way a real backend would.
- Phantom keeps a **real data store**, so the team she created is still there when she refreshes. It behaves like a real backend, not a static mock.
- Phantom **locks the shape** of each API after the first answer, so the response doesn't change from call to call.
- Phantom **records every request and response**. That recording becomes the spec: "this is exactly what the frontend needs."
- When Priya presses **Materialize**, Codex reads the recording and writes the **real backend code plus tests**, generated from her actual clicks. Phantom runs the tests, and if they pass, it switches traffic to the real code. The app keeps working with no visible change.

**The analogy:** Phantom is a stand-in actor who plays the role perfectly during rehearsals, while taking notes so the real actor can learn the part exactly.

## 1.3 The key idea in one line

> **The frontend is the spec. Every click is a test.**

Normally you write the spec first, then the backend, then the frontend. Phantom flips it: build the frontend first, let the backend be answered for you, and generate the real backend from what the frontend actually used.

---

## 1.4 A full worked example (Hackathon Hub)

The demo app is "Hackathon Hub": teams, projects and upvotes. Zero backend code exists.

### Step 1: Create a team
The app sends:
```
POST /api/teams
{ "name": "Byte Me" }
```
Phantom does this:
1. **Route check:** is there a real handler for `POST /teams`? No, so this goes to **PHANTOM**.
2. **Reserve an id:** the next team id is `team_1`. Phantom picks it, not the AI, so ids never collide.
3. **Build the prompt:** "You are the backend. Here's the request. The store has no teams yet. If you create a record, use id `team_1`. Reply as JSON: `{status, body, storeOps}`."
4. **Cerebras answers** in a fraction of a second:
```json
{
  "status": 201,
  "body": { "id": "team_1", "name": "Byte Me", "members": [], "createdAt": "2026-11-01T10:02:00Z" },
  "storeOps": [ { "op": "insert", "collection": "teams", "id": "team_1",
                  "record": { "id": "team_1", "name": "Byte Me", "members": [], "createdAt": "2026-11-01T10:02:00Z" } } ]
}
```
5. **Validate:** it's valid JSON with a real status code, the insert uses the reserved id, and POST is allowed to change data.
6. **Apply:** Phantom (not the AI) writes `team_1` into `store.json`.
7. **Lock the schema:** `POST /teams` now always returns `{id: string, name: string, members: array, createdAt: string}`.
8. **Record** the whole exchange to `recordings.jsonl`, and show a purple **PHANTOM** row in the dashboard with its latency.
9. **Return** the `body` to the app with status 201.

### Step 2: Refresh the team list
```
GET /api/teams
```
- The store now holds `team_1`, so the AI sees it in the snapshot and returns `[ { "id": "team_1", "name": "Byte Me", ... } ]`.
- **GET is not allowed to change data.** If the AI tried to send storeOps, Phantom would reject the response.
- **Result:** the team you created is really there. A static mock can't do this.

### Step 3: Upvote a project
```
POST /api/projects/proj_3/upvote
```
- The AI sees `proj_3` has `votes: 4` and returns `{ "id": "proj_3", "votes": 5 }` with an update op `{op:"update", collection:"projects", id:"proj_3", patch:{votes:5}}`.
- If the AI tried to update a project that doesn't exist, Phantom would reject it and retry once.

### Step 4: Leaderboard (a derived view)
```
GET /api/leaderboard
```
- There is no "leaderboard" collection. Phantom sends the AI the project data (small stores go in whole), and the AI sorts by votes.
- **This is why an AI is useful here:** computed views just work without anyone writing them.

### Step 5: Materialize
You press **Materialize** on the "teams" and "projects" routes. Phantom hands Codex:
- the locked schemas (the exact shapes),
- the recordings (real requests and responses),
- `store.ts` (the same data layer Phantom uses),
- and a task: "write Fastify handlers in `generated/`, write tests that replay every recording, and run them until they pass."

Codex writes something like:
```ts
// generated/routes/teams.ts
app.post('/teams', async (req, reply) => {
  const id = store.reserveId('teams');
  const team = { id, name: req.body.name, members: [], createdAt: new Date().toISOString() };
  store.insert('teams', id, team);
  return reply.code(201).send(team);
});
```
and a test built from your click:
```ts
// generated/tests/teams.test.ts: replayed from recording #1
it('POST /teams creates a team', async () => {
  const res = await app.inject({ method: 'POST', url: '/teams', payload: { name: 'Byte Me' } });
  expect(res.statusCode).toBe(201);
  expect(res.json()).toMatchSchema(lockedSchemas['POST /teams'].response);
});
```
Phantom **runs the tests itself**. It never trusts the agent's word. When they pass, those routes flip to **REAL** (the dashboard rows turn green).

### Step 6: Same app, real backend
You click "Create team" again. The response now comes from real code: same URL, same shape, same data file. The frontend has no idea anything changed.

---

## 1.5 What it uses, and why

| Piece | What it is | Why we chose it |
|---|---|---|
| **Cerebras** (`gpt-oss-120b`) | A company with giant AI chips that run open models very fast | A backend has to answer in well under a second. Slow models feel broken. Speed is the whole reason this can work. |
| **Codex** | OpenAI's coding agent (CLI/SDK) | It writes the real backend and tests **inside the product**, which is the Materialize step. We also used it to build Phantom itself. |
| **Fastify proxy** (Node/TypeScript) | The middleman server | It catches every `/api/*` call and decides PHANTOM or REAL. |
| **JSON-file store** | One file of collections | It keeps state, so data stays consistent. The real code later uses the same file. |
| **Schema lock** (JSON Schema + ajv) | A strict shape check per route | It stops the AI from changing response shapes. |
| **Recorder** (`recordings.jsonl`) | A log of every exchange | It becomes the spec and the source of the tests. |
| **Dashboard** (React, live updates) | A live request log with PHANTOM/REAL badges | It makes an invisible backend visible on stage. |
| **Vitest** | Test runner | It proves the generated code matches what the frontend used. |

## 1.6 The three rules that make the AI trustworthy

These are the most important technical points to explain to judges:
1. **The AI suggests, the code decides.** The AI returns a response and *proposed* data changes. Phantom's own code checks the changes and applies them. The AI never touches the store directly.
2. **Shapes are locked.** After the first answer, every later answer on that route must match the same schema, or it gets retried.
3. **Reads can't write, and ids come from Phantom.** These remove the most common ways the data could go inconsistent.

## 1.7 How it differs from what exists

| Tool | What it does | What Phantom adds |
|---|---|---|
| Mock servers (Mockoon, MSW, Prism, Postman mocks) | Return fixed, hand-written responses, or responses from a spec | No hand-writing, real state, and it turns into real code |
| LLM "fake API" tools | An AI makes up responses | A data store, locked shapes, and a path to a real backend with tests |
| Spec-first codegen (OpenAPI generators) | Generate a server from a written spec | No spec needed; the spec comes from real usage |

**What to say:** "We found nothing that combines all three: a stateful AI backend, recording as the spec, and generating a tested backend from that recording." Don't claim to be the first.

---

# PART 2: Demo prep

## 2.1 Setup (an hour before)
- [ ] Laptop on **your phone hotspot**, tested.
- [ ] `pnpm reset && pnpm dev` works from a clean state in under 30 seconds.
- [ ] Two windows side by side: **Hackathon Hub** on the left, the **dashboard** on the right. Font size large enough for the back row.
- [ ] Editor open on the **empty `generated/` folder**. It's your "no backend" proof.
- [ ] Seed one or two teams *only if* you want a non-empty start. A clean start is more convincing.
- [ ] Materialize **pre-run once** on a copy, so you know how long it takes.
- [ ] **Backup video** of a full run saved locally, one click away.
- [ ] Cerebras credit and rate limit checked. GET cache on.
- [ ] Notifications off, and close every terminal that shows API keys.
- [ ] Decide roles: one person talks, one person drives the laptop.

## 2.2 The 3-minute script

| Time | Say | Do |
|---|---|---|
| 0:00 | "Every frontend dev has waited on a backend. Mocks don't remember anything, and they drift from the real API." | Title slide |
| 0:15 | "This app has no backend. Zero lines." | Show the empty `generated/` folder |
| 0:25 | "Watch the right side. Every call is answered by a model on Cerebras, in about [your number] milliseconds." | Create a team. A PHANTOM row appears |
| 0:45 | "It's not a static mock. There's a real store, so data persists." | Refresh. The team is still there. Upvote a project |
| 1:00 | "Give me a team name." | **A judge names a team.** Type it in. This proves it isn't scripted |
| 1:15 | "The shape of every API is now locked, and every click was recorded. That recording is the spec." | Show the schema or the recording count |
| 1:30 | "Now let's make it real." | Press **Materialize**. Codex output streams in |
| 1:30–2:20 | Narrate while it runs: "Codex is writing the handlers and replaying our clicks as tests. Phantom runs the tests itself; it doesn't trust the agent." | Point at test names as they appear |
| 2:20 | "[N] tests, all passing. Watch the rows flip." | PHANTOM rows turn green: REAL |
| 2:30 | "Same app, same data, real code." | Create another team: REAL. Open one generated file for 5 seconds |
| 2:45 | "The frontend is the spec. Every click is a test. This is Phantom." | End slide |

## 2.3 Demo rules
- **Say your real numbers** (latency, test count, Materialize time). Measure them in rehearsal. Never quote a number you didn't measure.
- **If Materialize is slow**, keep narrating. If it goes past about 90 seconds, say "here's the run from earlier" and play the backup. Then do the REAL flip live; the flip itself is instant.
- **If you see a red error row**, turn it into a feature: "That's the schema lock catching a bad answer and retrying. That's why it's safe."
- **If the network dies**, switch to the video without apologising.
- **Don't** show code for more than 10 seconds, scroll slides back and forth, or explain the stack before showing the magic.

## 2.4 Rehearsal plan
1. Three full timed runs from a clean reset.
2. One run where a teammate plays a hostile judge and interrupts.
3. One run with the Wi-Fi off, to practise the fallback.
4. Practise the 30-second version, in case the judges arrive late or are rushed.

**30-second version:** "Phantom lets you build a frontend before the backend exists. A fast model on Cerebras answers as the backend, with a real data store, so data stays consistent. Every call is recorded, and one click has Codex turn that recording into a real backend plus tests, then switches over live. The frontend becomes the spec."

---

# PART 3: Judge Q&A bank

Keep answers to about 20 seconds. Be honest; judges reward "here's the limit, and here's how we'd handle it" far more than bluffing.

## A. Concept

**Q: Isn't this just a mock server?**
A: A mock returns fixed data and forgets everything. Phantom has real state (create, refresh, it's still there), needs no hand-written responses, and, most importantly, turns into a real backend with tests. A mock is a dead end; Phantom is the first draft of the real backend.

**Q: Why not just ask Codex to write the backend from the start?**
A: Because at the start you don't know exactly what the frontend needs. With Phantom, the requirements come from real usage: real request shapes, real edge cases. Codex then writes against a spec and a test suite instead of guessing. You also get the tests for free.

**Q: Who is this for?**
A: Frontend developers blocked on backends, small teams and solo devs prototyping fast, hackathon teams, and product teams that want working prototypes without committing to a backend design.

**Q: What does "the frontend is the spec" mean?**
A: Whatever the frontend actually calls, with whatever data, becomes the definition of the API. There's no separate spec document to drift out of date.

## B. Technical

**Q: How do you stop the AI from hallucinating?**
A: Three ways. First, the AI only *proposes* data changes, and our code checks and applies them. Second, the schema lock forces every response on a route to keep the same shape. Third, reads can't write, and ids come from our code. Bad answers get retried once, then fail loudly.

**Q: What if the AI answers the same request differently twice?**
A: Shapes can't change, because of the lock. Values come from the store, so they're consistent. We use temperature 0 and cache identical reads when the data hasn't changed.

**Q: How big can the data get?**
A: For the AI path we send a snapshot of the relevant collections, capped at about 50 records. Phantom is for development data, not production volume. Once a route is materialized, there's no limit; it's normal code.

**Q: What's the latency?**
A: [Say your measured median.] That's why Cerebras matters: on a typical GPU-hosted model this would feel like a broken app.

**Q: How do you handle complex business logic, like payments or permissions?**
A: Phantom is good at CRUD and derived views. For complex logic, the materialized code is a tested starting point that a developer reviews and extends. We're not claiming to replace backend engineers. We remove the waiting and write the boring 80%.

**Q: What does Codex actually generate?**
A: Fastify route handlers using the same data layer, plus Vitest tests that replay each recorded request. Phantom runs the tests itself and only switches a route to real code when they pass. [Open a file if they want to see it.]

**Q: What if the generated code is wrong?**
A: Then the tests fail, and the route stays PHANTOM. Nothing switches on the agent's word. We can re-run Codex with the failure output.

**Q: Does it work with any frontend?**
A: Anything that makes HTTP calls. You point your API base URL at Phantom. React, mobile, curl, it doesn't matter.

**Q: How do you handle auth?**
A: Out of scope for today. The natural design is to pass auth headers through and let a real auth service own them. Phantom shouldn't invent security.

**Q: How do you match `/teams/42` and `/teams/57` as the same route?**
A: Path normalisation: segments that look like ids (numbers, UUIDs, `prefix_N`) become `:id`, so both lock to `GET /teams/:id`.

**Q: What happens on the very first GET, before any data exists?**
A: It returns an empty list. We don't lock the shape on an empty list; we wait until we see a real item. [Only claim this if you built it.]

## C. Sponsor usage

**Q: Why Cerebras specifically?**
A: Because the model *is* the backend, so every click waits on it. Sub-second answers are what make the app feel real. Speed isn't a nice-to-have here; it's the product.

**Q: How is Codex used? Just to write your code?**
A: Both. We built Phantom with Codex, and Codex also runs *inside* the product as the Materialize step. It turns recorded traffic into a real backend and tests, live.

**Q: Could you use a different model?**
A: Yes. The API is OpenAI-compatible. But slower models make the phantom backend feel laggy, and gpt-oss is open-weight, so a company could run it in-house.

## D. Reliability and security

**Q: What if Cerebras goes down?**
A: Cached reads keep working, and there's a replay mode that serves recorded responses. Materialized routes don't need the model at all.

**Q: Isn't sending app data to an AI a privacy risk?**
A: In development you use fake or seed data. For companies, gpt-oss is an open-weight model, so Phantom could run fully in-house with no data leaving.

**Q: Could the generated code be insecure?**
A: It's reviewed code, like any pull request. Phantom gives you code plus tests, not an automatic production deploy. Adding a security scan step to Materialize is an obvious next feature.

**Q: Would you use this in production?**
A: The phantom mode, no; it's a development tool. The materialized code, yes, after review, because it's ordinary code with tests.

## E. Business and monetization

**Q: How would you make money?**
A: It's a developer tool, so the usual model applies:
1. **Free tier:** local, open-source core, with your own API key. This builds adoption.
2. **Team plan (per seat per month):** hosted Phantom with shared recordings, a shared spec, history, and CI integration that runs the generated contract tests on every pull request.
3. **Usage-based:** included phantom calls and Materialize runs, then pay per use. This also covers our model costs.
4. **Enterprise:** self-hosted with an in-house model (gpt-oss is open-weight), SSO, audit logs and support.

**Q: Who pays?**
A: Engineering teams, because waiting on backends costs developer time, which is their most expensive resource. The buyer is an engineering manager or a CTO at a startup.

**Q: What's the market?**
A: API tooling is an established category with paying customers: Postman sells mock servers and API testing, and SmartBear bought Stoplight for API design tooling. Phantom is a new wedge into that space: usage-first instead of spec-first. [Don't quote market-size figures you haven't checked.]

**Q: What's your moat? Couldn't Postman build this?**
A: Honestly, the idea can be copied. The value is in the workflow: the guarded store, schema locking, the recording format, and reliable materialization. Over time, the moat is the data: recordings across many apps make better generation and better tests. Speed to market and developer love are the real moat for dev tools.

**Q: What does it cost to run?**
A: About a tenth of a cent per phantom request at current Cerebras prices, by our estimate. Today's whole build ran on [your actual spend]. Materialized routes cost nothing to run.

**Q: Go-to-market?**
A: An open-source CLI (`npx phantom`), a VS Code extension, hackathon and bootcamp communities (where the pain is sharpest), then team upsell when they want shared recordings and CI.

## F. Future and scope

**Q: What would you build next?**
A: Export an OpenAPI spec from the locked schemas. A drift check that replays recordings against real code after every change. Per-route pinning. Plugins for databases like Postgres. Auth passthrough.

**Q: What was the hardest part?**
A: [Be honest. Likely answers: keeping the AI consistent, which led to the schema lock and storeOps design; or making Materialize reliable within a demo time limit.]

**Q: What didn't work?**
A: [Have one real example ready. Judges love this, for example: "At first the AI would edit the store directly in its reply and data got corrupted, so we moved to proposed ops that our code applies."]

**Q: How much did Codex write versus you?**
A: [Be honest, with a rough split. For example: "Codex wrote most of the scaffolding and UI; we designed the contracts, the guard rules and the prompts, and debugged the consistency problems."]

## G. Curveballs

**Q: Does this put backend developers out of work?**
A: No. It removes waiting and boilerplate. Backend devs still own data modelling, business rules, security and scale; they just start from a tested draft that matches what the frontend needs.

**Q: What if two frontends want different shapes for the same route?**
A: The lock picks the first shape, and a mismatch shows up as a visible error. That's a useful signal: the teams need to agree. Versioned routes would be a future feature.

**Q: Can I try it right now?**
A: Yes. [Hand over the laptop or the QR code if it's on the hotspot.] This is a strong move if your demo is stable.

---

## Things to never say
- "It's the first ever." Say "we found nothing that combines all three."
- Latency or test numbers you didn't measure.
- "It's production-ready." Say it's a dev tool whose output is reviewable code.
- Made-up market-size numbers.
