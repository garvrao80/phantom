# Phantom: Implementation Plan

This is the step-by-step build plan. `AGENTS.md` says **what** Phantom is (contracts, rules, behaviour). This file says **how** to build it: the order of work, the files to create, reference code for the core modules, commands to run, how to verify each step, and the commit to make.

**How to use this file**
- Work through the phases in order. Each step lists **Files**, **Do**, **Verify**, and **Commit**.
- The reference code is a strong starting point, not sacred. If you change a contract, update `AGENTS.md` in the same commit.
- When you hand a step to Codex, use the matching prompt in [Appendix A](#appendix-a-codex-prompts-per-step).
- `☐` marks a checkbox for the person doing the step.

---

## Contents
- [Phase 0: Spikes and setup (8:00–8:45)](#phase-0-spikes-and-setup-800845)
- [Phase 1: Scaffold (8:20–8:45)](#phase-1-scaffold-820845)
- [Phase 2: Store and router (8:45–9:30)](#phase-2-store-and-router-845930)
- [Phase 3: Schemas (9:30–10:00)](#phase-3-schemas-9301000)
- [Phase 4: The phantom loop (10:00–11:30)](#phase-4-the-phantom-loop-10001130)
- [Phase 5: Recorder, events, control API (11:30–12:30)](#phase-5-recorder-events-control-api-11301230)
- [Phase 6: Demo app and dashboard (13:00–14:30)](#phase-6-demo-app-and-dashboard-13001430)
- [Phase 7: Materialize (14:30–16:30)](#phase-7-materialize-14301630)
- [Phase 8: Hardening (16:30–17:30)](#phase-8-hardening-16301730)
- [Phase 9: Ship (17:30–18:15)](#phase-9-ship-17301815)
- [Parallel work map](#parallel-work-map)
- [Appendix A: Codex prompts per step](#appendix-a-codex-prompts-per-step)
- [Appendix B: Troubleshooting](#appendix-b-troubleshooting)

---

## Phase 0: Spikes and setup (8:00–8:45)

The goal is to remove the three unknowns before writing real code. Write every answer into the table in `AGENTS.md` section 22.

### 0.1 Machine setup
```bash
node -v            # need 20+
corepack enable    # gives pnpm
pnpm -v
codex --version
git -C ~/path/to/phantom pull
cp .env.example .env   # paste CEREBRAS_API_KEY
```
☐ Node 20+, pnpm and codex all work on every teammate's laptop.

### 0.2 Cerebras spike
Create `scratch/cerebras.mjs`. It's git-ignored scratch; don't commit it.
```js
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.CEREBRAS_API_KEY, baseURL: 'https://api.cerebras.ai/v1' });
const t = Date.now();
const r = await client.chat.completions.create({
  model: process.env.CEREBRAS_MODEL ?? 'gpt-oss-120b',
  temperature: 0,
  max_tokens: 400,
  response_format: { type: 'json_object' },
  // reasoning_effort: 'low',   // try with and without; record whether the API accepts it
  messages: [
    { role: 'system', content: 'Reply with JSON only: {"status":int,"body":any,"storeOps":[]}' },
    { role: 'user', content: 'GET /teams. Store is empty.' },
  ],
});
console.log(Date.now() - t, 'ms', r.usage, r.choices[0].message.content);
```
```bash
cd scratch && npm i openai && node --env-file=../.env cerebras.mjs
```
Record:
- ☐ the exact model id
- ☐ whether `response_format: json_object` works
- ☐ whether `json_schema` works
- ☐ whether `reasoning_effort` is accepted
- ☐ latency
- ☐ rate limits (from the console)

### 0.3 Codex non-interactive spike
```bash
mkdir -p scratch/codex-spike && cd scratch/codex-spike && git init -q
codex exec --help                         # read the flags; note the auto-approve / sandbox / cwd options
codex exec --full-auto "Create hello.ts that exports add(a,b) and a vitest test for it."
ls
```
- ☐ Record the exact command that writes files with **no prompts**. The flags may differ by version: look for `--full-auto`, `--sandbox workspace-write`, and `-C/--cd`.
- ☐ Record how long the run takes.

### 0.4 Decide roles
☐ Assign people per the [parallel work map](#parallel-work-map).

**Commit:** none. Scratch work isn't committed; the answers go into `AGENTS.md` section 22 as `docs: record day-0 spike results`.

---

## Phase 1: Scaffold (8:20–8:45)

### 1.1 Workspace root
**Files:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`

`pnpm-workspace.yaml`
```yaml
packages:
  - packages/*
```

`package.json`
```json
{
  "name": "phantom",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "pnpm -r --parallel --stream dev",
    "test": "pnpm --filter @phantom/proxy test",
    "reset": "node scripts/reset.mjs",
    "smoke": "bash scripts/smoke.sh"
  }
}
```

`tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "allowImportingTsExtensions": true, "noEmit": true, "resolveJsonModule": true
  }
}
```

### 1.2 Proxy package
```bash
mkdir -p packages/proxy/src packages/proxy/test && cd packages/proxy
pnpm init
pnpm add fastify @fastify/cors openai ajv ajv-formats
pnpm add -D typescript tsx vitest @types/node
```
`packages/proxy/package.json` (scripts and name):
```json
{
  "name": "@phantom/proxy",
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=../../.env src/server.ts",
    "test": "vitest run",
    "test:generated": "vitest run --config vitest.generated.config.ts"
  }
}
```
`packages/proxy/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "generated"] }`

`packages/proxy/vitest.config.ts`: our own tests only, never the generated ones.
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```
`packages/proxy/vitest.generated.config.ts`: only the Codex-written tests.
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['generated/tests/**/*.test.ts'] } });
```

**Important:** `tsx watch` must **not** restart when Codex writes into `generated/` or when the store file changes. If it does, add `--exclude generated --exclude ../../data` (check `tsx watch --help`), or run with plain `tsx` during the demo.

### 1.3 Minimal server
`packages/proxy/src/config.ts`
```ts
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const PROXY_DIR = resolve(here, '..');
export const ROOT_DIR = resolve(PROXY_DIR, '../..');
export const DATA_DIR = resolve(ROOT_DIR, 'data');
export const GENERATED_DIR = resolve(PROXY_DIR, 'generated');

export const config = {
  port: Number(process.env.PHANTOM_PORT ?? 4000),
  apiKey: process.env.CEREBRAS_API_KEY ?? '',
  model: process.env.CEREBRAS_MODEL ?? 'gpt-oss-120b',
  baseURL: process.env.CEREBRAS_BASE_URL ?? 'https://api.cerebras.ai/v1',
  replay: process.env.PHANTOM_REPLAY === 'true',
  snapshotLimit: Number(process.env.PHANTOM_SNAPSHOT_LIMIT ?? 50),
  maxTokens: Number(process.env.PHANTOM_MAX_TOKENS ?? 800),
  codexTimeoutMs: Number(process.env.CODEX_TIMEOUT_MS ?? 300_000),
};
```
`packages/proxy/src/server.ts` (first version)
```ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.ts';

const app = Fastify({ logger: { level: 'warn' } });
await app.register(cors, { origin: true, exposedHeaders: ['x-phantom-mode'] });
app.get('/phantom/health', async () => ({ ok: true, model: config.model, replay: config.replay }));
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`phantom proxy on :${config.port}`);
```

### 1.4 Frontend packages
```bash
cd packages && pnpm create vite demo-app --template react-ts && pnpm create vite dashboard --template react-ts
```
- Set the package names to `@phantom/demo-app` and `@phantom/dashboard`.
- Set the ports in each `vite.config.ts`: demo-app `5173`, dashboard `5174`.

demo-app `vite.config.ts`: send `/api` to the proxy, so the app never knows a proxy exists.
```ts
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
});
```
dashboard `vite.config.ts`: send `/phantom` to the proxy (SSE works through the Vite proxy).
```ts
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy: { '/phantom': 'http://localhost:4000' } },
});
```

### 1.5 Reset script
`scripts/reset.mjs`
```js
import { rmSync, readdirSync, mkdirSync } from 'node:fs';
const clean = (dir) => {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f !== '.gitkeep') rmSync(`${dir}/${f}`, { recursive: true, force: true });
};
clean('data');
clean('packages/proxy/generated');
try { await fetch('http://localhost:4000/phantom/reset', { method: 'POST' }); } catch {}
console.log('reset done');
```

**Verify**
```bash
pnpm install && pnpm dev
curl localhost:4000/phantom/health      # {"ok":true,...}
# open :5173 and :5174, both show the Vite starter page
```
**Commit:** `chore: scaffold pnpm workspace with proxy, dashboard and demo-app`

---

## Phase 2: Store and router (8:45–9:30)

### 2.1 `src/types.ts`
```ts
export type Rec = { id: string; [k: string]: unknown };
export type StoreOp =
  | { op: 'insert'; collection: string; id: string; record: Rec }
  | { op: 'update'; collection: string; id: string; patch: Record<string, unknown> }
  | { op: 'delete'; collection: string; id: string };
export type StoreData = {
  version: number;
  nextId: Record<string, number>;      // next number to hand out per collection (default 1)
  collections: Record<string, Record<string, Rec>>;
};
export type Mode = 'PHANTOM' | 'REAL' | 'CACHED' | 'REPLAY' | 'ERROR';
export type ApiRequest = {
  method: string; path: string; routeKey: string;
  params: Record<string, string>; query: Record<string, string>; body: unknown;
};
export type ApiResponse = { status: number; body: unknown };
export type Recording = {
  seq: number; ts: number; mode: Mode; ok: boolean; routeKey: string;
  req: Omit<ApiRequest, 'routeKey'>; res: ApiResponse;
  storeOps: StoreOp[]; storeBefore: StoreData;
  latencyMs: number; tokens?: { in: number; out: number }; retries: number; error?: string;
};
```

### 2.2 `src/store.ts`
```ts
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import type { Rec, StoreData, StoreOp } from './types.ts';

export const singular = (c: string) =>
  c.endsWith('ies') ? c.slice(0, -3) + 'y' : c.endsWith('s') ? c.slice(0, -1) : c;

const emptyData = (): StoreData => ({ version: 0, nextId: {}, collections: {} });
const COLLECTION_RE = /^[a-z][a-z0-9_]*$/;

export class Store {
  private constructor(private data: StoreData, private file?: string) {}

  static load(file: string) {
    const data = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as StoreData) : emptyData();
    return new Store(data, file);
  }
  static fromData(data: StoreData) { return new Store(structuredClone(data)); } // in-memory, never saved

  get version() { return this.data.version; }
  collections() { return Object.keys(this.data.collections); }
  get(col: string, id: string) { return this.data.collections[col]?.[id]; }
  list(col: string) { return Object.values(this.data.collections[col] ?? {}); }

  /** Next id for a collection. Does not advance; inserting it does. */
  peekId(col: string) { return `${singular(col)}_${this.data.nextId[col] ?? 1}`; }
  /** Alias used by generated handlers. */
  reserveId(col: string) { return this.peekId(col); }

  dryRun(ops: StoreOp[]): { ok: true } | { ok: false; reason: string } {
    const cols = structuredClone(this.data.collections);
    for (const op of ops) {
      if (!COLLECTION_RE.test(op.collection)) return { ok: false, reason: `bad collection name "${op.collection}"` };
      const c = (cols[op.collection] ??= {});
      if (op.op === 'insert') {
        if (c[op.id]) return { ok: false, reason: `insert: ${op.collection}/${op.id} already exists` };
        if (op.record?.id !== op.id) return { ok: false, reason: `insert: record.id must equal id` };
        c[op.id] = op.record;
      } else if (op.op === 'update') {
        if (!c[op.id]) return { ok: false, reason: `update: ${op.collection}/${op.id} not found` };
        c[op.id] = { ...c[op.id], ...op.patch, id: op.id };
      } else if (op.op === 'delete') {
        if (!c[op.id]) return { ok: false, reason: `delete: ${op.collection}/${op.id} not found` };
        delete c[op.id];
      } else return { ok: false, reason: `unknown op` };
    }
    return { ok: true };
  }

  applyOps(ops: StoreOp[]) {
    if (ops.length === 0) return;
    const check = this.dryRun(ops);
    if (!check.ok) throw new Error(check.reason);
    for (const op of ops) {
      const c = (this.data.collections[op.collection] ??= {});
      if (op.op === 'insert') {
        c[op.id] = op.record;
        const n = Number(op.id.split('_').pop());
        if (Number.isInteger(n)) this.data.nextId[op.collection] = Math.max(this.data.nextId[op.collection] ?? 1, n + 1);
      } else if (op.op === 'update') c[op.id] = { ...c[op.id], ...op.patch, id: op.id };
      else delete c[op.id];
    }
    this.data.version++;
    this.save();
  }

  /** The collections sent to the model, capped at `limit` most-recent records each. */
  snapshot(cols: string[], limit: number): StoreData {
    const out: StoreData = { version: this.data.version, nextId: {}, collections: {} };
    for (const col of cols) {
      const entries = Object.entries(this.data.collections[col] ?? {}).slice(-limit);
      out.collections[col] = Object.fromEntries(entries);
      out.nextId[col] = this.data.nextId[col] ?? 1;
    }
    return out;
  }
  sizeBytes() { return JSON.stringify(this.data.collections).length; }
  dump() { return structuredClone(this.data); }

  reset() { this.data = emptyData(); this.save(); }
  save() {
    if (!this.file) return;
    writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2));
    renameSync(this.file + '.tmp', this.file);
  }
}
```

### 2.3 `test/store.test.ts`
Cover:
- insert, update, delete
- insert on an existing id fails
- update or delete on a missing id fails
- `record.id !== id` fails
- a bad collection name fails
- a mixed batch where op 2 fails leaves the store **unchanged** (all-or-nothing)
- `version` bumps only when there are ops
- `peekId` gives `team_1`, then `team_2` after inserting `team_1`
- `singular` maps `teams` → `team`, `categories` → `category`
- `snapshot` respects `limit`
- `fromData` never writes to disk

### 2.4 `src/router.ts` (path part)
```ts
const ID_PATTERNS = [
  /^\d+$/,                                                             // 42
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,  // uuid
  /^[a-z]+_[A-Za-z0-9]*\d[A-Za-z0-9]*$/,                              // team_3, proj_a1 (must contain a digit)
  /^(?=.*\d)[A-Za-z0-9_-]{16,}$/,                                     // long opaque ids (must contain a digit)
];
export const isIdSegment = (s: string) => ID_PATTERNS.some((re) => re.test(s));

export function normalisePath(rawPath: string) {
  const path = rawPath.split('?')[0].replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  const params: Record<string, string> = {};
  let n = 0;
  const pattern = path.split('/').map((seg) => {
    if (!seg || !isIdSegment(seg)) return seg;
    const name = n++ === 0 ? 'id' : `id${n}`;
    params[name] = decodeURIComponent(seg);
    return `:${name}`;
  }).join('/');
  return { path, pattern, params };
}
export const routeKey = (method: string, pattern: string) => `${method.toUpperCase()} ${pattern}`;
export const isRead = (method: string) => ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
```
The segments must contain a digit so that collection names like `team_members` or `leaderboard_weekly` are **not** treated as ids.

### 2.5 `test/router.test.ts`
| input | pattern | params |
|---|---|---|
| `/api/teams` | `/teams` | `{}` |
| `/api/teams/` | `/teams` | `{}` |
| `/api/teams/42` | `/teams/:id` | `{id:"42"}` |
| `/api/teams/team_3/projects` | `/teams/:id/projects` | `{id:"team_3"}` |
| `/api/teams/team_3/members/user_9` | `/teams/:id/members/:id2` | `{id, id2}` |
| `/api/team_members` | `/team_members` | `{}` |
| `/api/leaderboard?x=1` | `/leaderboard` | `{}` |
| uuid segment | `/:id` | the uuid |

**Verify:** `pnpm test` is all green.
**Commit:** `proxy: add JSON store with all-or-nothing ops and path normalisation`

---

## Phase 3: Schemas (9:30–10:00)

### 3.1 `src/schemas.ts`
```ts
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

type JSONSchema = Record<string, any>;
export type Locked = { response: JSONSchema; status: number; lockedAt: number; sampleCount: number };

const UNKNOWN = (): JSONSchema => ({ 'x-unknown': true });

/** Infer a strict schema from one sample. Unknowns (null, empty arrays) can be refined once later. */
export function inferSchema(v: unknown): JSONSchema {
  if (v === null || v === undefined) return UNKNOWN();
  if (Array.isArray(v)) return { type: 'array', items: v.length ? inferSchema(v[0]) : UNKNOWN() };
  if (typeof v === 'object') {
    const props: Record<string, JSONSchema> = {};
    for (const [k, val] of Object.entries(v)) props[k] = inferSchema(val);
    return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
  }
  if (typeof v === 'number') return { type: 'number' };   // no integer/number split: avoids false failures
  return { type: typeof v };                               // string | boolean
}

/** Replace unknown nodes with schemas inferred from a new sample. Returns true if anything changed. */
export function refine(schema: JSONSchema, v: unknown): boolean {
  if (schema['x-unknown']) {
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return false;
    Object.assign(schema, inferSchema(v));
    delete schema['x-unknown'];
    return true;
  }
  let changed = false;
  if (schema.type === 'object' && v && typeof v === 'object' && !Array.isArray(v))
    for (const [k, s] of Object.entries(schema.properties ?? {})) changed = refine(s as JSONSchema, (v as any)[k]) || changed;
  if (schema.type === 'array' && Array.isArray(v)) for (const item of v) changed = refine(schema.items, item) || changed;
  return changed;
}

export class SchemaRegistry {
  private ajv = new Ajv({ strict: false, allErrors: true });
  private compiled = new Map<string, ValidateFunction>();
  private data: Record<string, Locked>;
  constructor(private file: string) {
    addFormats(this.ajv);
    this.data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  }
  get(key: string) { return this.data[key]; }
  all() { return this.data; }

  /** Call after a 2xx answer passes every other check. */
  observe(key: string, status: number, body: unknown) {
    const cur = this.data[key];
    if (!cur) {
      if (Array.isArray(body) && body.length === 0) return;      // don't lock on []
      this.data[key] = { response: inferSchema(body), status, lockedAt: Date.now(), sampleCount: 1 };
    } else {
      cur.sampleCount++;
      if (refine(cur.response, body)) this.compiled.delete(key);
    }
    this.save();
  }

  /** Returns a list of human-readable errors; empty means valid or not locked yet. */
  validate(key: string, status: number, body: unknown): string[] {
    const cur = this.data[key];
    if (!cur) return [];
    if (status !== cur.status) return [`expected status ${cur.status}, got ${status}`];
    let fn = this.compiled.get(key);
    if (!fn) { fn = this.ajv.compile(cur.response); this.compiled.set(key, fn); }
    return fn(body) ? [] : (fn.errors ?? []).map((e) => `${e.instancePath || 'body'} ${e.message}`);
  }
  reset() { this.data = {}; this.compiled.clear(); this.save(); }
  private save() { writeFileSync(this.file, JSON.stringify(this.data, null, 2)); }
}
```
How unknowns behave: `{ "x-unknown": true }` has no `type`, so ajv accepts any value there until it's refined. `strict: false` lets ajv ignore the custom keyword.

### 3.2 `test/schemas.test.ts`
- An object locks with all keys required and no extras: an extra key fails, and a missing key fails.
- A type change (string → number) fails.
- `[]` doesn't lock. Then `[{...}]` locks with the item schema.
- A `null` field accepts anything until a non-null sample refines it. After that, the refined type is enforced.
- A different 2xx status fails.
- Validation is skipped (`[]` errors) for an unlocked key.

**Commit:** `proxy: add schema inference, locking and validation`

---

## Phase 4: The phantom loop (10:00–11:30)

### 4.1 `src/model.ts`: injectable model client
```ts
import OpenAI from 'openai';
import { config } from './config.ts';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ModelResult = { text: string; tokensIn: number; tokensOut: number };
export interface ModelClient { complete(messages: ChatMessage[]): Promise<ModelResult> }

export function cerebrasClient(): ModelClient {
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  return {
    async complete(messages) {
      const r = await client.chat.completions.create({
        model: config.model,
        temperature: 0,
        max_tokens: config.maxTokens,
        response_format: { type: 'json_object' },   // switch to json_schema if Phase 0 confirmed support
        // reasoning_effort: 'low',                 // enable if Phase 0 confirmed support
        messages,
      } as any);
      return {
        text: r.choices[0]?.message?.content ?? '',
        tokensIn: r.usage?.prompt_tokens ?? 0,
        tokensOut: r.usage?.completion_tokens ?? 0,
      };
    },
  };
}

/** For tests: returns scripted answers in order. */
export function fakeClient(answers: (string | object)[]): ModelClient & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  return {
    calls,
    async complete(messages) {
      calls.push(messages);
      const a = answers.shift();
      if (a === undefined) throw new Error('fakeClient: no more answers');
      return { text: typeof a === 'string' ? a : JSON.stringify(a), tokensIn: 0, tokensOut: 0 };
    },
  };
}
```

### 4.2 `src/prompt.ts`
- Copy the **system message** and **user template** from `AGENTS.md` section 11 verbatim into constants.
- `buildMessages(ctx, retryReason?)` fills the template and returns `ChatMessage[]`.
- If `retryReason` is set, append the previous assistant answer and the user line "Your previous answer was rejected: … Return a corrected answer."

### 4.3 `src/snapshot.ts`: which collections to send
```ts
import { singular, type Store } from './store.ts';
import { isIdSegment } from './router.ts';

export function candidateCollections(store: Store, path: string, body: unknown): { send: string[]; create: string[] } {
  const existing = new Set(store.collections());
  const segs = path.split('/').filter((s) => s && !isIdSegment(s));
  const matched = new Set<string>();
  for (const s of segs) for (const c of existing) if (c === s || singular(c) === s || c === s + 's') matched.add(c);
  if (body && typeof body === 'object')
    for (const k of Object.keys(body)) if (k.endsWith('Id')) {
      const base = k.slice(0, -2);
      for (const c of existing) if (singular(c) === base) matched.add(c);
    }
  // new collection candidate: the last non-id segment (POST /teams → teams)
  const last = segs.at(-1);
  const create = last && /^[a-z][a-z0-9_]*$/.test(last) ? [...new Set([...matched, last])] : [...matched];
  const send = store.sizeBytes() < 8_000 ? [...existing] : [...matched];
  return { send, create };
}
```
`create` lists the collections that get a reserved id on a write request.

### 4.4 `src/validate.ts`: rules from `AGENTS.md` 7.2
```ts
import type { StoreOp } from './types.ts';
import type { Store } from './store.ts';
import type { SchemaRegistry } from './schemas.ts';
import { isRead } from './router.ts';

export type Answer = { status: number; body: unknown; storeOps: StoreOp[] };

export function parseAnswer(text: string): Answer {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  const a = JSON.parse(cleaned);
  const keys = Object.keys(a).sort().join(',');
  if (keys !== 'body,status,storeOps') throw new Error(`answer must have exactly status, body, storeOps (got ${keys})`);
  return a;
}

export function checkAnswer(a: Answer, ctx: { method: string; routeKey: string; reserved: Record<string, string> },
                            store: Store, schemas: SchemaRegistry): string | null {
  if (!Number.isInteger(a.status) || a.status < 100 || a.status > 599) return `invalid status ${a.status}`;
  if (!Array.isArray(a.storeOps)) return 'storeOps must be an array';
  if (isRead(ctx.method) && a.storeOps.length) return `${ctx.method} must not change data (storeOps must be [])`;
  for (const op of a.storeOps)
    if (op.op === 'insert' && ctx.reserved[op.collection] !== op.id)
      return `insert into ${op.collection} must use reserved id ${ctx.reserved[op.collection] ?? '(none reserved)'}`;
  const dry = store.dryRun(a.storeOps);
  if (!dry.ok) return dry.reason;
  if (a.status >= 400) {
    const b = a.body as any;
    if (!b || typeof b.error !== 'string') return '4xx/5xx body must be {"error": string}';
    return null;
  }
  if (a.status >= 200 && a.status < 300) {
    const errs = schemas.validate(ctx.routeKey, a.status, a.body);
    if (errs.length) return `body does not match locked schema: ${errs.slice(0, 3).join('; ')}`;
  }
  return null;
}
```

### 4.5 `src/phantom.ts`
```ts
import type { ApiRequest, ApiResponse, Recording } from './types.ts';
import type { Store } from './store.ts';
import type { SchemaRegistry } from './schemas.ts';
import type { ModelClient } from './model.ts';
import { buildMessages } from './prompt.ts';
import { candidateCollections } from './snapshot.ts';
import { parseAnswer, checkAnswer, type Answer } from './validate.ts';
import { isRead } from './router.ts';
import { config } from './config.ts';

export type PhantomDeps = { store: Store; schemas: SchemaRegistry; model: ModelClient };

export async function runPhantom(req: ApiRequest, deps: PhantomDeps):
    Promise<{ res: ApiResponse; rec: Omit<Recording, 'seq' | 'ts'> }> {
  const { store, schemas, model } = deps;
  const t0 = Date.now();
  const { send, create } = candidateCollections(store, req.path, req.body);
  const reserved = isRead(req.method) ? {} : Object.fromEntries(create.map((c) => [c, store.peekId(c)]));
  const storeBefore = store.snapshot([...new Set([...send, ...create])], config.snapshotLimit);
  const ctx = { req, routeKey: req.routeKey, locked: schemas.get(req.routeKey), reserved,
                collections: store.collections(), snapshot: storeBefore };

  let retryReason: string | undefined, lastText = '', tokens = { in: 0, out: 0 }, answer: Answer | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await model.complete(buildMessages(ctx, retryReason, lastText));
      tokens.in += r.tokensIn; tokens.out += r.tokensOut; lastText = r.text;
      const a = parseAnswer(r.text);
      const problem = checkAnswer(a, { method: req.method, routeKey: req.routeKey, reserved }, store, schemas);
      if (!problem) { answer = a; break; }
      retryReason = problem;
    } catch (e: any) { retryReason = `invalid JSON or call failure: ${e.message}`; }
  }

  const base = { routeKey: req.routeKey, req: { method: req.method, path: req.path, params: req.params,
                 query: req.query, body: req.body }, storeBefore, tokens };
  if (!answer) {
    const res = { status: 502, body: { error: 'phantom_invalid', detail: retryReason } };
    return { res, rec: { ...base, mode: 'ERROR', ok: false, res, storeOps: [], latencyMs: Date.now() - t0,
                         retries: 1, error: retryReason } };
  }
  store.applyOps(answer.storeOps);
  if (answer.status >= 200 && answer.status < 300) schemas.observe(req.routeKey, answer.status, answer.body);
  const res = { status: answer.status, body: answer.body };
  return { res, rec: { ...base, mode: 'PHANTOM', ok: true, res, storeOps: answer.storeOps,
                       latencyMs: Date.now() - t0, retries: retryReason ? 1 : 0 } };
}
```

**Concurrency note.** Two writes on the same store at once can both reserve the same id. Serialise **non-read** phantom calls with a tiny promise queue (`let chain = Promise.resolve(); chain = chain.then(() => runPhantom(...))`). Reads can run in parallel.

### 4.6 `src/cache.ts`
```ts
const cache = new Map<string, { status: number; body: unknown }>();
export const cacheKey = (routeKey: string, query: object, version: number) => `${routeKey}|${JSON.stringify(query)}|${version}`;
export const getCached = (k: string) => cache.get(k);
export const setCached = (k: string, v: { status: number; body: unknown }) => { if (v.status < 300) cache.set(k, v); };
export const clearCache = () => cache.clear();
```

### 4.7 Wire `/api/*` in `server.ts`
Create one shared `Store`, one `SchemaRegistry`, the `cerebrasClient()`, a write queue, and `realHandlers` (Phase 7; for now an empty `Map`). Then register:
```ts
app.all('/api/*', async (request, reply) => {
  const { path, pattern, params } = normalisePath(request.url);
  const req: ApiRequest = { method: request.method, path, routeKey: routeKey(request.method, pattern), params,
                            query: (request.query ?? {}) as Record<string, string>, body: request.body ?? null };
  const out = await dispatch(req);          // router.ts: REAL → REPLAY → CACHED → PHANTOM (AGENTS.md 8.2)
  reply.header('x-phantom-mode', out.mode).code(out.res.status).send(out.res.body);
});
```
`dispatch` does three things:
- It calls `recorder.record(...)` for every outcome (Phase 5; until then, `console.log` it).
- It caches ok GET results.
- It pushes writes through the queue.

### 4.8 Tests
**`test/validate.test.ts`:** one test per rule in `AGENTS.md` 7.2:
- wrong keys
- status out of range
- GET with ops
- insert with an unreserved id
- update on a missing id
- bad collection name
- schema mismatch
- 4xx without `error`

**`test/phantom.test.ts`:** uses `fakeClient`. Cover:
- the happy-path insert, after which the store has the record
- invalid then valid gives `retries: 1`, and the second prompt contains the reason
- invalid twice gives 502 `phantom_invalid` and an unchanged store
- the first 2xx locks the schema, and a later mismatching answer is retried
- a GET with ops is rejected

**Live check (with the real key):**
```bash
curl -s -XPOST localhost:4000/api/teams -H 'content-type: application/json' -d '{"name":"Byte Me"}' -i
curl -s localhost:4000/api/teams
curl -s -XPOST localhost:4000/api/projects -H 'content-type: application/json' -d '{"teamId":"team_1","title":"Phantom"}'
curl -s -XPOST localhost:4000/api/projects/project_1/upvote
curl -s localhost:4000/api/leaderboard
cat data/store.json
```
☐ The team persists. ☐ The ids are `team_1` and `project_1`. ☐ The upvote changes `votes`. ☐ The leaderboard is derived from projects. ☐ The `x-phantom-mode: PHANTOM` header is present.

**Commits:**
1. `proxy: add model client, prompt and snapshot selection`
2. `proxy: enforce answer validation rules with retry`
3. `proxy: serve /api/* through the phantom loop with cache`

---

## Phase 5: Recorder, events, control API (11:30–12:30)

### 5.1 `src/events.ts`
```ts
import type { ServerResponse } from 'node:http';
const clients = new Set<ServerResponse>();
export function addClient(res: ServerResponse) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive',
                       'access-control-allow-origin': '*' });
  res.write(': connected\n\n');
  clients.add(res);
  res.on('close', () => clients.delete(res));
}
export function emit(type: string, data: unknown) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}
setInterval(() => { for (const c of clients) c.write(': hb\n\n'); }, 15_000).unref();
```
In `server.ts`:
```ts
app.get('/phantom/events', (request, reply) => { reply.hijack(); addClient(reply.raw); });
```
`reply.hijack()` bypasses the cors plugin, which is why `addClient` sets the CORS header itself.

### 5.2 `src/recorder.ts`
- Holds `seq` (restored from the file's line count on boot).
- `record(rec)`:
  1. Adds `seq` and `ts`.
  2. Appends a JSON line to `data/recordings.jsonl`.
  3. Updates the routes registry (`calls++`, `lastLatencyMs`, `locked = !!schemas.get(key)`).
  4. Emits `request`, plus `route` if anything changed.
- `readRecordings({ route?, limit = 100, okOnly? })` reads the file and filters from the end.

`src/routes.ts` is the registry: a `Map<string, { mode, calls, lastLatencyMs, locked }>` persisted to `data/routes.json`. Expose `setMode(key, mode)`, `list()` and `reset()`.

### 5.3 Control endpoints (`AGENTS.md` section 9)
```
GET  /phantom/routes          → routes.list() merged with schemas.get(key)
GET  /phantom/recordings      → readRecordings({ route, limit })
GET  /phantom/store           → store.dump()
POST /phantom/reset           → store.reset(); schemas.reset(); routes.reset(); truncate recordings;
                                clearCache(); realHandlers.clear(); empty generated/ (keep .gitkeep); emit('reset', {})
GET  /phantom/health
```

### 5.4 Replay mode
When `config.replay` is on (or a runtime toggle `POST /phantom/replay {on}` is set):
- `dispatch` serves the **latest ok recording** with the same `routeKey` and `query`, with mode `REPLAY`.
- If there's no recording, it returns `503 { error: "no_recording" }`.

Use this while building the UI, so you don't spend Cerebras credit.

**Verify**
```bash
curl -N localhost:4000/phantom/events &      # leave running
curl -XPOST localhost:4000/api/teams -H 'content-type: application/json' -d '{"name":"A"}'
# the event stream prints a `request` event
wc -l data/recordings.jsonl
curl -XPOST localhost:4000/phantom/reset && cat data/store.json
```
**Commit:** `proxy: record exchanges, stream SSE events, add control endpoints and replay mode`

---

## Phase 6: Demo app and dashboard (13:00–14:30)

B can start this at 9:00 against `scratch/fake-events.mjs`, a small server that emits fake `request` events every second.

### 6.1 Demo app: Hackathon Hub (`packages/demo-app`)
**Files**
```
src/api.ts            fetch wrapper: JSON in/out, reads x-phantom-mode, throws ApiError on !ok
src/App.tsx           simple tab nav: Teams | Leaderboard
src/pages/Teams.tsx   list + "New team" form
src/pages/Team.tsx    team detail + projects + "Add project" form + upvote buttons
src/pages/Leaderboard.tsx
src/components/ModeBadge.tsx   small corner pill showing the last x-phantom-mode
src/components/Toast.tsx       error/retry toast
```
`src/api.ts`
```ts
export let lastMode = 'PHANTOM';
const listeners = new Set<(m: string) => void>();
export const onMode = (f: (m: string) => void) => (listeners.add(f), () => listeners.delete(f));

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {},
                                         body: body ? JSON.stringify(body) : undefined });
  lastMode = r.headers.get('x-phantom-mode') ?? lastMode; listeners.forEach((f) => f(lastMode));
  const data = r.status === 204 ? null : await r.json();
  if (!r.ok) throw Object.assign(new Error(data?.error ?? r.statusText), { status: r.status, data });
  return data as T;
}
```
**Rules**
- No hard-coded data. Every screen fetches.
- Handle loading and error states. A 502 shows a toast with Retry.
- Keep it visually clean: the judges look at it, but the dashboard is the star.

**Field contract.** Since the first call locks the shape, use these names consistently from the frontend:
- team: `{ name, members: string[] }`
- project: `{ teamId, title, pitch }`
- upvote: no body

### 6.2 Dashboard (`packages/dashboard`)
**Files**
```
src/useEvents.ts           EventSource('/phantom/events'); exposes requests[], routes map, job state; reconnects
src/App.tsx                layout: Header / RequestLog (60%) / RouteTable + MaterializePanel
src/components/Header.tsx  model, replay toggle, Reset, stats: calls, median latency, tokens, est. cost
src/components/RequestLog.tsx   newest-first rows; click to expand req/res/storeOps
src/components/ModeBadge.tsx    PHANTOM #A78BFA, REAL #5EE6A0, CACHED grey, REPLAY #5CC8F0, ERROR #F87171
src/components/RouteTable.tsx   key, mode, calls, 🔒, checkbox; "Materialize selected" button
src/components/MaterializePanel.tsx  phase stepper + streaming log + "N tests passed"
src/styles.css             tokens: --bg #12101A, --panel #1C1930, fonts Space Grotesk / JetBrains Mono
```
`src/useEvents.ts` (core)
```ts
import { useEffect, useState } from 'react';
export function useEvents() {
  const [requests, setRequests] = useState<any[]>([]);
  const [routes, setRoutes] = useState<Record<string, any>>({});
  const [job, setJob] = useState<any>(null);
  useEffect(() => {
    fetch('/phantom/routes').then((r) => r.json()).then((list) =>
      setRoutes(Object.fromEntries(list.map((x: any) => [x.key, x]))));
    fetch('/phantom/recordings?limit=200').then((r) => r.json()).then((l) => setRequests(l.reverse()));
    const es = new EventSource('/phantom/events');
    es.addEventListener('request', (e) => setRequests((r) => [JSON.parse(e.data), ...r].slice(0, 500)));
    es.addEventListener('route', (e) => { const d = JSON.parse(e.data); setRoutes((r) => ({ ...r, [d.key]: { ...r[d.key], ...d } })); });
    es.addEventListener('materialize', (e) => { const d = JSON.parse(e.data);
      setJob((j: any) => ({ ...(j?.jobId === d.jobId ? j : { lines: [] }), ...d, lines: d.line ? [...(j?.lines ?? []), d.line] : j?.lines ?? [] })); });
    es.addEventListener('reset', () => { setRequests([]); setRoutes({}); setJob(null); });
    return () => es.close();
  }, []);
  return { requests, routes, job };
}
```
**Stage readability**
- Base font is 16px or more.
- Log rows are 15px or more, in a mono font.
- The badges are large and coloured.
- When a route flips to REAL, its rows flash green for 600 ms (CSS transition).
- Respect `prefers-reduced-motion`.

**Estimated cost:** `tokensIn × inPrice + tokensOut × outPrice`, with the prices as constants at the top of `Header.tsx`. Fill them in from the Cerebras pricing page.

**Verify:** click every screen in Hackathon Hub. Every call shows in the dashboard, and Reset clears both apps (after a refresh).
**Commits:**
1. `demo-app: add Hackathon Hub screens on /api`
2. `dashboard: add live request log, route table and stats`

---

## Phase 7: Materialize (14:30–16:30)

C can write 7.1 and 7.2 from 10:00 onward; they only depend on types.

### 7.1 `src/realHandlers.ts`
```ts
import { copyFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { Store } from './store.ts';
import { GENERATED_DIR } from './config.ts';

export type HandlerCtx = { params: Record<string, string>; query: Record<string, string>; body: unknown; store: Store };
export type Handler = (ctx: HandlerCtx) => Promise<{ status: number; body: unknown }>;
export const realHandlers = new Map<string, Handler>();

/** Import generated/handlers.ts fresh (copy to a unique name to dodge the ESM cache) and activate `keys`. */
export async function loadGenerated(keys: string[]) {
  const src = resolve(GENERATED_DIR, 'handlers.ts');
  if (!existsSync(src)) throw new Error('generated/handlers.ts not found');
  const copy = resolve(GENERATED_DIR, `handlers.${Date.now()}.ts`);   // same folder, so relative imports still work
  copyFileSync(src, copy);
  const mod = await import(pathToFileURL(copy).href);
  for (const k of keys) {
    if (typeof mod.handlers?.[k] !== 'function') throw new Error(`handlers["${k}"] missing`);
    realHandlers.set(k, mod.handlers[k]);
  }
}
```
In `dispatch`, the REAL path calls the handler like this:
```ts
const t0 = Date.now(); const storeBefore = store.snapshot(store.collections(), config.snapshotLimit);
const res = await realHandlers.get(req.routeKey)!({ params: req.params, query: req.query, body: req.body, store });
record({ mode: 'REAL', ok: res.status < 500, routeKey: req.routeKey, req, res, storeOps: [], storeBefore, latencyMs: Date.now() - t0, retries: 0 });
```
Handlers write with `store.applyOps`, so REAL and PHANTOM share the same data.

### 7.2 `src/testing/replay.ts`
```ts
import Ajv from 'ajv';
import { expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../store.ts';
import type { Handler } from '../realHandlers.ts';
import type { Recording } from '../types.ts';
import { GENERATED_DIR } from '../config.ts';

const ctxDir = resolve(GENERATED_DIR, '.context');
const schemas = JSON.parse(readFileSync(resolve(ctxDir, 'schemas.json'), 'utf8'));
export const recordings: Recording[] = readFileSync(resolve(ctxDir, 'recordings.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));
export const recordingsFor = (key: string) => recordings.filter((r) => r.routeKey === key);

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
/** Remove values that legitimately differ between runs (timestamps). */
function stripVolatile(v: any): any {
  if (typeof v === 'string' && ISO.test(v)) return '<timestamp>';
  if (Array.isArray(v)) return v.map(stripVolatile);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripVolatile(x)]));
  return v;
}

export async function expectReplay(handlers: Record<string, Handler>, rec: Recording) {
  const handler = handlers[rec.routeKey];
  expect(handler, `handler for ${rec.routeKey}`).toBeTypeOf('function');
  const store = Store.fromData(rec.storeBefore);
  const res = await handler({ params: rec.req.params, query: rec.req.query, body: rec.req.body, store });
  expect(res.status).toBe(rec.res.status);
  const locked = schemas[rec.routeKey];
  if (locked && res.status < 300) {
    const ok = new Ajv({ strict: false }).validate(locked.response, res.body);
    expect(ok, `body matches locked schema for ${rec.routeKey}`).toBe(true);
  }
  expect(stripVolatile(res.body)).toEqual(stripVolatile(rec.res.body));
}
```
Ids are deterministic because `storeBefore.nextId` is restored, so `store.reserveId('teams')` returns the same id as in the recording.

**Known risk: ordering of derived lists.** If the model's leaderboard order ties differently from the code's, the test fails. To handle this, the task tells Codex to sort ties by `id`. If the recordings aren't consistent themselves, drop the inconsistent recordings from the context, and mention this in the pitch as the "drift check" feature.

### 7.3 `src/materialize.ts`
```ts
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { PROXY_DIR, GENERATED_DIR, config } from './config.ts';
import { emit } from './events.ts';

type Deps = { schemas: { all(): Record<string, any> }; readRecordings: (o: any) => any[];
              loadGenerated: (keys: string[]) => Promise<void>; setMode: (k: string, m: 'REAL') => void };
let running = false;

export async function materialize(routes: string[], deps: Deps, retryNote?: string) {
  if (running) throw new Error('a materialize job is already running');
  running = true;
  const jobId = `job_${Date.now()}`;
  const phase = (p: string, extra: object = {}) => emit('materialize', { jobId, phase: p, ...extra });
  try {
    // 1. context
    phase('context');
    const ctx = resolve(GENERATED_DIR, '.context'); mkdirSync(ctx, { recursive: true });
    mkdirSync(resolve(GENERATED_DIR, 'tests'), { recursive: true });
    const all = deps.schemas.all();
    writeFileSync(resolve(ctx, 'schemas.json'), JSON.stringify(Object.fromEntries(routes.map((k) => [k, all[k]])), null, 2));
    const recs = routes.flatMap((k) => dedupe(deps.readRecordings({ route: k, okOnly: true, limit: 200 })).slice(-20));
    writeFileSync(resolve(ctx, 'recordings.jsonl'), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    writeFileSync(resolve(ctx, 'api.md'), API_MD);
    writeFileSync(resolve(ctx, 'task.md'), taskMd(routes, retryNote));

    // 2. codex (verify flags in Phase 0)
    phase('codex');
    await run('codex', ['exec', '--full-auto', '-C', PROXY_DIR,
                        'Read generated/.context/task.md and complete it exactly.'],
              (line) => phase('codex', { line }), config.codexTimeoutMs);

    // 3. tests (we run them; never trust the agent's word)
    phase('tests');
    const out = resolve(ctx, 'results.json');
    await run('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.generated.config.ts', '--reporter=json',
                       `--outputFile=${out}`], (line) => phase('tests', { line }), 120_000, true);
    const r = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { numPassedTests: 0, numFailedTests: 1, numTotalTests: 1 };
    const tests = { passed: r.numPassedTests, failed: r.numFailedTests, total: r.numTotalTests };
    if (tests.total === 0 || tests.failed > 0) { phase('failed', { tests, line: 'tests failed: routes stay PHANTOM' }); return; }

    // 4. activate
    phase('activate', { tests });
    await deps.loadGenerated(routes);
    for (const k of routes) deps.setMode(k, 'REAL');           // setMode emits a `route` event
    phase('done', { tests });
  } catch (e: any) {
    phase('failed', { line: e.message });
  } finally { running = false; }
}

function run(cmd: string, args: string[], onLine: (l: string) => void, timeoutMs: number, allowFail = false) {
  return new Promise<void>((ok, fail) => {
    const p = spawn(cmd, args, { cwd: PROXY_DIR, env: process.env });
    for (const s of [p.stdout, p.stderr]) createInterface({ input: s }).on('line', onLine);
    const t = setTimeout(() => { p.kill('SIGTERM'); fail(new Error(`${cmd} timed out`)); }, timeoutMs);
    p.on('close', (code) => { clearTimeout(t); code === 0 || allowFail ? ok() : fail(new Error(`${cmd} exited ${code}`)); });
  });
}
const dedupe = (rs: any[]) => [...new Map(rs.map((r) => [JSON.stringify([r.req, r.res.status]), r])).values()];
```
- `taskMd(routes, retryNote)` returns the template from `AGENTS.md` 12.2 with the route list filled in. If `retryNote` is set (the failing test output), it appends it under "Previous attempt failed with:".
- `API_MD` is a string constant with the `Store`, `StoreOp`, `HandlerCtx` and `Handler` signatures.

**Endpoint:** `POST /phantom/materialize { routes }` validates that every route is locked, starts `materialize(...)` **without awaiting it**, and returns `{ jobId }` (`202`).

**Retry:** `POST /phantom/materialize/retry` re-runs with the last job's test output as `retryNote`.

### 7.4 Materialize the demo flow end to end
1. Click through Hackathon Hub until these routes are locked: `POST /teams`, `GET /teams`, `GET /teams/:id`, `POST /projects`, `POST /projects/:id/upvote`.
2. Select them in the dashboard and press **Materialize**.
3. Watch the phases. ☐ Codex writes `generated/handlers.ts` and `generated/tests/*.test.ts`. ☐ The tests pass. ☐ The routes turn REAL.
4. Click in the app again. ☐ The responses carry `x-phantom-mode: REAL`. ☐ The data from before is still there. ☐ New records get the next ids.
5. Note the wall time. ☐ Put it in `AGENTS.md` section 22.

**Commits:**
1. `proxy: add real handler loading and replay test helpers`
2. `proxy: add materialize job with codex, test gate and activation`
3. `dashboard: add materialize panel`

---

## Phase 8: Hardening (16:30–17:30)

### 8.1 Smoke script: `scripts/smoke.sh`
```bash
#!/usr/bin/env bash
set -euo pipefail
B=localhost:4000
j() { curl -sf -H 'content-type: application/json' "$@"; }
curl -sf -XPOST $B/phantom/reset >/dev/null
j -XPOST $B/api/teams -d '{"name":"Byte Me","members":["A","B"]}'
j -XPOST $B/api/teams -d '{"name":"Null Pointers","members":["C"]}'
j $B/api/teams | grep -q "Null Pointers"
j $B/api/teams/team_1 | grep -q "Byte Me"
j -XPOST $B/api/projects -d '{"teamId":"team_1","title":"Phantom","pitch":"backend before it exists"}'
for i in 1 2 3; do j -XPOST $B/api/projects/project_1/upvote >/dev/null; done
j $B/api/leaderboard
echo; echo "store:"; curl -sf $B/phantom/store
```
☐ Run it three times. ☐ It gives the same shapes each time. ☐ `votes` is 3. ☐ There are no 502s. If any of these fail, tighten the prompt.

### 8.2 Checklist
- ☐ The GET cache is on, and the dashboard shows CACHED rows.
- ☐ Non-read calls are serialised (fire 5 parallel POSTs: there are no duplicate ids).
- ☐ Replay mode works with Wi-Fi off.
- ☐ `pnpm reset` followed by a reload of both apps gives a clean state in under 30 seconds.
- ☐ `tsx watch` doesn't restart when `generated/` or `data/` changes.
- ☐ The dashboard is readable from 5 metres, and the colours are fine in a bright room.
- ☐ A 502 in the app shows a toast, not a blank page.
- ☐ Three full demo runs in a row, timed.
- ☐ Usage check: Cerebras spend so far is under $2.

**Commit:** `chore: add smoke script and demo hardening fixes`

---

## Phase 9: Ship (17:30–18:15)
- ☐ Record a full demo run (screen + voice) and save it **locally**.
- ☐ Fill in `AGENTS.md` section 22 with the measured numbers: median latency, Materialize time, test count, cost.
- ☐ Update the README with a screenshot or GIF of the dashboard and the real numbers.
- ☐ Update the deck numbers.
- ☐ Paste the submission description.
- ☐ Final commit and push: `docs: add demo numbers and screenshots`.

---

## Parallel work map

### Who owns what

| Person | Role | Owns (files) | Phases |
|---|---|---|---|
| **Abhik** | Core proxy | `packages/proxy/src/`: `config`, `types`, `store`, `router`, `schemas`, `model`, `prompt`, `snapshot`, `validate`, `phantom`, `cache`, `recorder`, `events`, `routes`, `server` + `test/` | 0.2, 1.1–1.3, 2, 3, 4, 5 |
| **Lakshay** | Frontends | `packages/demo-app/`, `packages/dashboard/`, `scratch/fake-events.mjs` | 1.4, 6 |
| **Garv** | Materialize + ops | `packages/proxy/src/realHandlers.ts`, `src/materialize.ts`, `src/testing/replay.ts`, `vitest.generated.config.ts`, `scripts/`, README, backup video | 0.3, 1.5, 7, 8.1, 9 |

**Rules for working in parallel**
- **Only edit files you own.** If you need a change in someone else's file, ask them, or pair on it.
- **`src/types.ts` is shared.** Abhik writes it first (by 8:50) and pushes immediately; after that, changes to it are announced in the team chat before pushing.
- **`server.ts` is Abhik's.** Garv gives Abhik the materialize endpoints and the REAL branch of `dispatch` as a small patch, or pairs with him at 14:30.
- **Pull often:** `git pull --rebase` before every push. Push small commits at least every hour.
- **The presenter** is decided by 16:30. Suggested: whoever explains it best in the 8.2 rehearsal; the other two drive the laptop and handle Q&A backup.

### Timeline

| Time | Abhik (core) | Lakshay (UI) | Garv (Materialize + ops) |
|---|---|---|---|
| 8:00–8:45 | Cerebras spike (0.2), scaffold root + proxy (1.1–1.3) | Machine setup, both Vite apps (1.4) | Codex spike (0.3), `scripts/reset.mjs` (1.5) |
| 8:45–10:00 | `types.ts` (push first), store, router, schemas + tests (2, 3) | Hackathon Hub screens (6.1) with a temporary in-file fake `api()` | `replay.ts`, `realHandlers.ts`, `vitest.generated.config.ts` (7.1, 7.2) |
| 10:00–11:30 | Phantom loop, validation, cache, `/api/*` + tests (4) | Dashboard (6.2) against `scratch/fake-events.mjs` | `materialize.ts`, `taskMd`, `API_MD` (7.3); the smoke script (8.1) |
| 11:30–12:30 | Recorder, events, routes registry, control endpoints, replay mode (5) | Switch the demo app to the real `/api`; switch the dashboard to real SSE | Test `materialize` by hand on a hand-written `recordings.jsonl` |
| 12:30–13:00 | **Lunch, all three: freeze the contracts** | | |
| 13:00–14:30 | Prompt tuning from smoke results; write queue; bug fixes | Polish both UIs; ModeBadge; toasts | Materialize against real recordings from Hackathon Hub |
| 14:30–16:30 | Pair with Garv: wire materialize into `server.ts` + REAL dispatch | Materialize panel (phase stepper, log, flip animation) | End-to-end Materialize (7.4); measure the time |
| 16:30–17:30 | Hardening checklist items for the proxy (8.2) | Stage readability, reduced motion, colours | Three timed demo runs; usage check |
| 17:30–18:15 | Fill `AGENTS.md` section 22 numbers | Screenshots/GIF for README and deck | Backup video, README, submission (9) |
| 18:15–20:00 | **Rehearse together, then present** | | |

**Merge points (all three stop and sync):**
- **8:50:** `types.ts` pushed. Everyone pulls.
- **12:30:** the contracts are frozen. Any change after this needs all three to agree.
- **14:30:** the first full end-to-end click-through on Abhik's laptop.
- **16:30:** the first full demo run. Decide the presenter.

**If someone is blocked:**
- Lakshay blocked on the API → keep using the fake `api()` and fake events; switch over at 11:30.
- Garv blocked on Codex flags → test `materialize` with a hand-written `generated/handlers.ts` so the test gate and activation path work; plug Codex in once the flags are known.
- Abhik behind on Phase 4 at 11:30 → Garv takes Phase 5 (recorder, events) from Abhik.

---

## Appendix A: Codex prompts per step

Start each with: *"Read AGENTS.md and docs/IMPLEMENTATION_PLAN.md first."*

| Step | Prompt |
|---|---|
| 1.1–1.5 | "Do Phase 1 of docs/IMPLEMENTATION_PLAN.md exactly: workspace root, proxy package with the given configs, config.ts, minimal server, both Vite apps with the given proxies and ports, scripts/reset.mjs. Run `pnpm install` and confirm `/phantom/health` works." |
| 2.1–2.5 | "Do Phase 2: create types.ts, store.ts and router.ts from the reference code, and write the tests listed in 2.3 and 2.5. Run `pnpm test` until green." |
| 3.1–3.2 | "Do Phase 3: schemas.ts from the reference code and the tests listed in 3.2. Keep `pnpm test` green." |
| 4.1–4.8 | "Do Phase 4: model.ts, prompt.ts (copy the prompt text from AGENTS.md section 11 verbatim), snapshot.ts, validate.ts, phantom.ts, cache.ts, the /api/* route and dispatch with a write queue. Write the tests in 4.8 using fakeClient. No network in tests." |
| 5.1–5.4 | "Do Phase 5: events.ts, recorder.ts, routes.ts, the control endpoints, and replay mode. Add tests for recorder and replay using a temp data dir." |
| 6.1 | "Do Phase 6.1: build Hackathon Hub in packages/demo-app as specified, using src/api.ts. Clean, minimal styling. Use exactly the field names in the field contract." |
| 6.2 | "Do Phase 6.2: build the dashboard in packages/dashboard as specified, with useEvents.ts, the listed components and style tokens. Make it readable from the back of a room." |
| 7.1–7.3 | "Do Phase 7.1–7.3: realHandlers.ts, testing/replay.ts, materialize.ts and the materialize endpoints. Use the `codex exec` flags recorded in AGENTS.md section 22. Never activate routes unless our own vitest run passes." |
| 8.1 | "Add scripts/smoke.sh from Phase 8.1 and fix anything it reveals." |

After each step: read the diff, run `pnpm test`, then commit with the message listed in the phase.

---

## Appendix B: Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Model returns prose or code fences | No JSON mode | `parseAnswer` strips fences; use `response_format: json_object` |
| Many retries on the same route | The lock came from a bad first sample | `POST /phantom/reset`, or delete that key from `data/schemas.json` and re-click |
| Shape differs between POST and GET of the same resource | They're separate route keys | Expected. Say in the prompt "list items must match the shape returned by the create endpoint". Optionally pass the related locked POST schema into the GET prompt |
| Duplicate ids | Parallel writes | Check the write queue in `dispatch` |
| `429` from Cerebras | Rate limit | GET cache, fewer clicks, replay mode, and wait out the window |
| Server restarts when Codex writes files | `tsx watch` sees `generated/` | Exclude it from the watcher, or run plain `tsx` |
| `import()` returns old handlers | ESM module cache | `loadGenerated` copies to a unique filename; check it's being used |
| Codex asks for approval and hangs | Wrong flags | Use the non-interactive flags recorded in Phase 0; the timeout kills it after `CODEX_TIMEOUT_MS` |
| Generated tests fail on lists | Tie order differs | Sort ties by `id` in the task; drop inconsistent recordings |
| Dashboard shows nothing | SSE blocked by the proxy or CORS | Open `localhost:4000/phantom/events` directly; check that `addClient` sets the headers |
| CORS error in demo-app | Calling `:4000` directly | Always call `/api/...` through the Vite proxy |
