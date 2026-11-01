import Fastify, { type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { NOTES_FILE } from './config.ts';
import { resolve } from 'node:path';
import type { ApiRequest, ApiResponse, Handler, Mode, Recording } from './types.ts';
import { Store } from './store.ts';
import { SchemaRegistry } from './schemas.ts';
import { ResponseCache } from './cache.ts';
import { EventHub } from './events.ts';
import { Recorder } from './recorder.ts';
import { RouteRegistry } from './routes.ts';
import { runPhantom } from './phantom.ts';
import { normalisePath, routeKey, isRead } from './router.ts';
import type { ModelClient } from './model.ts';
import type { MaterializeDeps, Job } from './materialize.ts';

/** The Materialize controller (materialize.ts), injectable so tests can use a fake. */
export type Materializer = {
  start: (routes: string[], deps: MaterializeDeps, retryNote?: string) => { jobId: string };
  retry: (deps: MaterializeDeps) => { jobId: string };
  isRunning: () => boolean;
  getLastJob: () => Job | undefined;
};

export type AppOptions = {
  dataDir: string;
  generatedDir: string;
  model: ModelClient;
  modelName: string;
  replay?: boolean;
  snapshotLimit?: number;
  /** Plain-English domain notes included in every phantom prompt. Defaults to the contents of phantom.notes.md. */
  notes?: string;
  /** Route key → real handler. Filled by Materialize. */
  realHandlers?: Map<string, Handler>;
  /** Imports generated/handlers.ts and fills `realHandlers` for the given keys. */
  loadGenerated?: (keys: string[]) => Promise<void>;
  materializer?: Materializer;
};

const MAX_CODE_PREVIEW = 20_000;

export type PhantomContext = ReturnType<typeof createContext>;
export type DispatchResult = { mode: Mode; res: ApiResponse };

function createContext(opts: AppOptions) {
  mkdirSync(opts.dataDir, { recursive: true });
  const notes = opts.notes ?? (existsSync(NOTES_FILE) ? readFileSync(NOTES_FILE, 'utf8') : undefined);
  const events = new EventHub();
  const store = Store.load(resolve(opts.dataDir, 'store.json'));
  const schemas = new SchemaRegistry(resolve(opts.dataDir, 'schemas.json'));
  const routes = new RouteRegistry(resolve(opts.dataDir, 'routes.json'), events);
  const recorder = new Recorder(resolve(opts.dataDir, 'recordings.jsonl'), events);
  const cache = new ResponseCache();
  const realHandlers = opts.realHandlers ?? new Map<string, Handler>();
  const state = { replay: opts.replay ?? false };
  const snapshotLimit = opts.snapshotLimit ?? 50;

  // Writes run one at a time so two requests never get the same reserved id.
  let writeChain: Promise<unknown> = Promise.resolve();
  const serialWrite = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = writeChain.then(fn, fn);
    writeChain = next.catch(() => undefined);
    return next;
  };

  const record = (rec: Omit<Recording, 'seq' | 'ts'>) => {
    const saved = recorder.record(rec);
    routes.touch(rec.routeKey, rec.latencyMs, !!schemas.get(rec.routeKey));
    return saved;
  };

  const reqSummary = (req: ApiRequest) => ({
    method: req.method,
    path: req.path,
    params: req.params,
    query: req.query,
    body: req.body,
  });

  async function runReal(req: ApiRequest, handler: Handler): Promise<DispatchResult> {
    const t0 = Date.now();
    const storeBefore = store.snapshot(store.collections(), snapshotLimit);
    let res: ApiResponse;
    let error: string | undefined;
    try {
      res = await (isRead(req.method)
        ? handler({ params: req.params, query: req.query, body: req.body, store })
        : serialWrite(() => handler({ params: req.params, query: req.query, body: req.body, store })));
    } catch (e) {
      error = (e as Error).message;
      res = { status: 500, body: { error: 'real_handler_failed', detail: error } };
    }
    record({ mode: 'REAL', ok: res.status < 500, routeKey: req.routeKey, req: reqSummary(req), res, storeOps: [],
             storeBefore, latencyMs: Date.now() - t0, retries: 0, error });
    return { mode: 'REAL', res };
  }

  /** REAL → REPLAY → CACHED → PHANTOM (AGENTS.md 8.2). */
  async function dispatch(req: ApiRequest): Promise<DispatchResult> {
    const handler = realHandlers.get(req.routeKey);
    if (handler) return runReal(req, handler);

    if (state.replay) {
      const hit = recorder.latest(req.routeKey, req.path, req.query);
      const res = hit ? hit.res : { status: 503, body: { error: 'no_recording', detail: `nothing recorded for ${req.routeKey}` } };
      record({ mode: 'REPLAY', ok: !!hit, routeKey: req.routeKey, req: reqSummary(req), res, storeOps: [],
               storeBefore: { version: store.version, nextId: {}, collections: {} }, latencyMs: 0, retries: 0 });
      return { mode: 'REPLAY', res };
    }

    if (isRead(req.method)) {
      const key = cache.key(req.routeKey, req.path, req.query, store.version);
      const hit = cache.get(key);
      if (hit) {
        record({ mode: 'CACHED', ok: true, routeKey: req.routeKey, req: reqSummary(req), res: hit, storeOps: [],
                 storeBefore: store.snapshot(store.collections(), snapshotLimit), latencyMs: 0, retries: 0 });
        return { mode: 'CACHED', res: hit };
      }
      const out = await runPhantom(req, { store, schemas, model: opts.model, snapshotLimit, notes });
      record(out.rec);
      if (out.rec.ok) cache.set(key, out.res);
      return { mode: out.rec.mode, res: out.res };
    }

    const out = await serialWrite(() => runPhantom(req, { store, schemas, model: opts.model, snapshotLimit, notes }));
    record(out.rec);
    return { mode: out.rec.mode, res: out.res };
  }

  function reset() {
    store.reset();
    schemas.reset();
    routes.reset();
    recorder.reset();
    cache.clear();
    realHandlers.clear();
    mkdirSync(opts.generatedDir, { recursive: true });
    for (const f of readdirSync(opts.generatedDir))
      if (f !== '.gitkeep') rmSync(resolve(opts.generatedDir, f), { recursive: true, force: true });
    events.emit('reset', {});
  }

  const materializeDeps: MaterializeDeps = {
    schemas,
    readRecordings: (o) => recorder.read(o),
    // Activation goes through the write queue so it never lands in the middle of a mutation.
    loadGenerated: (keys) =>
      serialWrite(async () => {
        if (!opts.loadGenerated) throw new Error('loadGenerated is not configured');
        await opts.loadGenerated(keys);
      }),
    setMode: (key, mode) => routes.setMode(key, mode),
  };

  return { store, schemas, routes, recorder, cache, events, realHandlers, state, dispatch, reset, materializeDeps, opts };
}

export async function createApp(opts: AppOptions) {
  const ctx = createContext(opts);
  const app = Fastify({ logger: { level: 'warn' }, exposeHeadRoutes: false });
  await app.register(cors, { origin: true, exposedHeaders: ['x-phantom-mode'] });

  // Tolerate empty JSON bodies (e.g. POST /projects/:id/upvote with a content-type header but no body).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = String(body ?? '');
    if (!text.trim()) return done(null, null);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(Object.assign(new Error('invalid JSON body'), { statusCode: 400 }), undefined);
    }
  });

  app.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
    url: '/api/*',
    handler: async (request, reply) => {
      const { path, pattern, params } = normalisePath(request.url);
      const req: ApiRequest = {
        method: request.method,
        path,
        routeKey: routeKey(request.method, pattern),
        params,
        query: (request.query ?? {}) as Record<string, string>,
        body: request.body ?? null,
      };
      const out = await ctx.dispatch(req);
      reply.header('x-phantom-mode', out.mode).code(out.res.status);
      return out.res.status === 204 ? reply.send() : reply.send(out.res.body);
    },
  });

  app.get('/phantom/health', async () => ({ ok: true, model: opts.modelName, replay: ctx.state.replay }));

  app.get('/phantom/events', (request, reply) => {
    reply.hijack();
    ctx.events.addClient(reply.raw);
  });

  app.get('/phantom/routes', async () => {
    const keys = new Set([...ctx.routes.list().map((r) => r.key), ...Object.keys(ctx.schemas.all())]);
    return [...keys].sort().map((key) => {
      const info = ctx.routes.get(key) ?? { mode: 'PHANTOM', calls: 0, lastLatencyMs: 0, locked: false };
      const locked = ctx.schemas.get(key);
      return { key, ...info, mode: ctx.realHandlers.has(key) ? 'REAL' : info.mode, locked: !!locked, schema: locked ?? null };
    });
  });

  app.get<{ Querystring: { route?: string; limit?: string; okOnly?: string } }>('/phantom/recordings', async (request) =>
    ctx.recorder.read({
      route: request.query.route,
      limit: request.query.limit ? Number(request.query.limit) : 100,
      okOnly: request.query.okOnly === 'true',
    }),
  );

  app.get('/phantom/store', async () => ctx.store.dump());

  app.post<{ Body: { on?: boolean } | null }>('/phantom/replay', async (request) => {
    ctx.state.replay = !!request.body?.on;
    return { replay: ctx.state.replay };
  });

  app.post('/phantom/reset', async (_request, reply) => {
    if (opts.materializer?.isRunning()) return reply.code(409).send({ error: 'materialize_running' });
    ctx.reset();
    return { ok: true };
  });

  // Materialize (AGENTS.md section 12). The job runs in the background; progress arrives as `materialize` SSE events.
  const startJob = async (reply: FastifyReply, start: (m: Materializer) => { jobId: string }) => {
    const m = opts.materializer;
    if (!m) return reply.code(501).send({ error: 'materialize_unavailable' });
    if (m.isRunning()) return reply.code(409).send({ error: 'materialize_running' });
    try {
      return reply.code(202).send(start(m));
    } catch (e) {
      const message = (e as Error).message;
      return reply.code(/already running/i.test(message) ? 409 : 400).send({ error: 'materialize_rejected', detail: message });
    }
  };

  app.post<{ Body: { routes?: unknown } | null }>('/phantom/materialize', (request, reply) =>
    startJob(reply, (m) => m.start(request.body?.routes as string[], ctx.materializeDeps)),
  );

  app.post('/phantom/materialize/retry', (_request, reply) => startJob(reply, (m) => m.retry(ctx.materializeDeps)));

  // The generated backend itself, for the "Your backend" page: its state, routes and the code Codex wrote.
  app.get('/phantom/backend', async () => {
    const running = opts.materializer?.isRunning() ?? false;
    const job = opts.materializer?.getLastJob() ?? null;
    const real = ctx.realHandlers.size > 0;
    const state = running ? 'building' : real ? 'live' : job?.phase === 'failed' ? 'failed' : 'none';
    const routes = ctx.routes.list().map(({ key, mode, calls, locked }) => ({
      key, calls, locked, mode: ctx.realHandlers.has(key) ? 'REAL' : mode,
    }));
    const handlersFile = resolve(opts.generatedDir, 'handlers.ts');
    const code = real && existsSync(handlersFile) ? readFileSync(handlersFile, 'utf8') : null;
    const testsDir = resolve(opts.generatedDir, 'tests');
    const testFiles = real && existsSync(testsDir) ? readdirSync(testsDir).filter((f) => f.endsWith('.test.ts')) : [];
    return {
      state,
      routes,
      job: state === 'none' ? null : job,
      code: code === null ? null : {
        file: 'generated/handlers.ts',
        lines: code.split('\n').length,
        source: code.length > MAX_CODE_PREVIEW ? code.slice(0, MAX_CODE_PREVIEW) + '\n// …' : code,
      },
      testFiles: testFiles.map((f) => `generated/tests/${f}`),
    };
  });

  app.get('/phantom/materialize', async () => ({
    running: opts.materializer?.isRunning() ?? false,
    job: opts.materializer?.getLastJob() ?? null,
  }));

  app.addHook('onClose', async () => ctx.events.close());

  return { app, ctx };
}
