import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp, type Materializer } from '../src/app.ts';
import { createMaterializer } from '../src/materialize.ts';
import { fakeClient } from '../src/model.ts';
import type { Handler } from '../src/types.ts';
import { tempDir, testApp, ok } from './helpers.ts';

const insertTeam = (id: string, name: string) =>
  ok(201, { id, name }, [{ op: 'insert', collection: 'teams', id, record: { id, name } }]);

const fakeMaterializer = (over: Partial<Materializer> = {}): Materializer => ({
  start: vi.fn(() => ({ jobId: 'job_1' })),
  retry: vi.fn(() => ({ jobId: 'job_2' })),
  isRunning: vi.fn(() => false),
  getLastJob: vi.fn(() => undefined),
  ...over,
});

async function appWith(materializer?: Materializer, answers: object[] = []) {
  const dir = tempDir();
  const realHandlers = new Map<string, Handler>();
  const loadGenerated = vi.fn(async (keys: string[]) => {
    for (const k of keys) realHandlers.set(k, async () => ({ status: 201, body: { id: 'team_2', name: 'Real' } }));
  });
  const { app, ctx } = await createApp({
    dataDir: join(dir, 'data'), generatedDir: join(dir, 'generated'), model: fakeClient(answers), modelName: 'fake', notes: '',
    realHandlers, loadGenerated, materializer,
  });
  return { app, ctx, realHandlers, loadGenerated, dir };
}

describe('materialize endpoints', () => {
  it('returns 501 when no materializer is configured', async () => {
    const { app } = await testApp();
    expect((await app.inject({ method: 'POST', url: '/phantom/materialize', payload: { routes: [] } })).statusCode).toBe(501);
  });

  it('starts a job with 202 and passes working deps', async () => {
    const m = fakeMaterializer();
    const { app, ctx, loadGenerated } = await appWith(m, [insertTeam('team_1', 'A')]);
    await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'A' } });
    const r = await app.inject({ method: 'POST', url: '/phantom/materialize', payload: { routes: ['POST /teams'] } });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ jobId: 'job_1' });

    const [routes, deps] = (m.start as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(routes).toEqual(['POST /teams']);
    expect(Object.keys(deps.schemas.all())).toEqual(['POST /teams']);
    expect(deps.readRecordings({ route: 'POST /teams', okOnly: true, limit: 10 })).toHaveLength(1);
    await deps.loadGenerated(['POST /teams']);
    expect(loadGenerated).toHaveBeenCalledWith(['POST /teams']);
    deps.setMode('POST /teams', 'REAL');
    expect(ctx.routes.get('POST /teams')?.mode).toBe('REAL');
  });

  it('maps validation errors to 400 and concurrency to 409', async () => {
    const bad = fakeMaterializer({ start: () => { throw new Error('Select at least one locked route'); } });
    const r1 = await (await appWith(bad)).app.inject({ method: 'POST', url: '/phantom/materialize', payload: { routes: [] } });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().detail).toMatch(/locked route/);

    const busy = fakeMaterializer({ isRunning: () => true });
    const { app } = await appWith(busy);
    expect((await app.inject({ method: 'POST', url: '/phantom/materialize', payload: { routes: ['GET /x'] } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/phantom/materialize/retry' })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/phantom/reset' })).statusCode).toBe(409);
  });

  it('retries and reports the last job', async () => {
    const job = { jobId: 'job_1', routes: ['POST /teams'], phase: 'failed', error: 'tests failed' };
    const m = fakeMaterializer({ getLastJob: () => job });
    const { app } = await appWith(m);
    expect((await app.inject({ method: 'POST', url: '/phantom/materialize/retry' })).json()).toEqual({ jobId: 'job_2' });
    expect((await app.inject({ method: 'GET', url: '/phantom/materialize' })).json()).toEqual({ running: false, job });
  });
});

describe('backend status endpoint', () => {
  it('reports no backend, then building, then live with the generated code', async () => {
    let running = false;
    const m = fakeMaterializer({ isRunning: () => running, getLastJob: () => ({ jobId: 'job_1', routes: ['POST /teams'], phase: running ? 'codex' : 'done' }) });
    const { app, realHandlers, dir } = await appWith(m, [insertTeam('team_1', 'A')]);
    await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'A' } });
    const none = (await app.inject({ method: 'GET', url: '/phantom/backend' })).json();
    expect(none).toMatchObject({ state: 'none', job: null, code: null, testFiles: [] });
    expect(none.routes).toEqual([{ key: 'POST /teams', calls: 1, locked: true, mode: 'PHANTOM' }]);

    running = true;
    expect((await app.inject({ method: 'GET', url: '/phantom/backend' })).json()).toMatchObject({ state: 'building', job: { phase: 'codex' } });

    running = false;
    mkdirSync(join(dir, 'generated', 'tests'), { recursive: true });
    writeFileSync(join(dir, 'generated', 'handlers.ts'), 'export const handlers = {};\n// real\n');
    writeFileSync(join(dir, 'generated', 'tests', 'teams.test.ts'), '');
    realHandlers.set('POST /teams', async () => ({ status: 201, body: {} }));
    const live = (await app.inject({ method: 'GET', url: '/phantom/backend' })).json();
    expect(live).toMatchObject({ state: 'live', code: { file: 'generated/handlers.ts', lines: 3 }, testFiles: ['generated/tests/teams.test.ts'] });
    expect(live.code.source).toContain('// real');
    expect(live.routes[0].mode).toBe('REAL');
  });

  it('reports a failed build when nothing went REAL', async () => {
    const m = fakeMaterializer({ getLastJob: () => ({ jobId: 'job_1', routes: ['POST /teams'], phase: 'failed', error: 'tests failed' }) });
    const { app } = await appWith(m);
    expect((await app.inject({ method: 'GET', url: '/phantom/backend' })).json()).toMatchObject({ state: 'failed', job: { error: 'tests failed' } });
  });

  it('forgets an old failed job after a reset', async () => {
    const m = fakeMaterializer({ getLastJob: () => ({ jobId: 'job_old', routes: ['POST /teams'], phase: 'failed', error: 'old' }) });
    const { app } = await appWith(m);
    await app.inject({ method: 'POST', url: '/phantom/reset' });
    expect((await app.inject({ method: 'GET', url: '/phantom/backend' })).json()).toMatchObject({ state: 'none', job: null });
  });
});

describe('materialize end to end (stubbed codex and vitest)', () => {
  it('flips a recorded route to REAL through the real controller', async () => {
    const proxyDir = tempDir();
    for (const f of ['src/testing/replay.ts', 'src/testing/contract.test.ts', 'vitest.generated.config.ts']) {
      mkdirSync(join(proxyDir, f, '..'), { recursive: true });
      writeFileSync(join(proxyDir, f), '// gate');
    }
    let generatedDir = '';
    const events: { phase: string }[] = [];
    // Stand-ins for the two child processes: Codex "writes code"; Vitest reports every recording passing.
    const run = vi.fn(async (c: { command: string; args: string[] }) => {
      if (c.command === 'codex') return;
      const ctxDir = join(generatedDir, '.context');
      const recs = readFileSync(join(ctxDir, 'recordings.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      const assertionResults = [{ title: 'has recorded interactions to verify', status: 'passed' },
        ...recs.map((r) => ({ title: `replays #${r.seq} ${r.routeKey}`, status: 'passed' }))];
      const out = c.args.find((a) => a.startsWith('--outputFile='))!.slice('--outputFile='.length);
      writeFileSync(out, JSON.stringify({ success: true, numPassedTests: assertionResults.length, numFailedTests: 0,
        numTotalTests: assertionResults.length, testResults: [{ name: join(proxyDir, 'src/testing/contract.test.ts'), assertionResults }] }));
    });

    const dir = tempDir();
    generatedDir = join(dir, 'generated');
    const materializer = createMaterializer({ proxyDir, generatedDir, timeoutMs: 5_000, run: run as never,
                                              emit: (_n, data) => events.push(data) });
    const realHandlers = new Map<string, Handler>();
    const { app } = await createApp({
      dataDir: join(dir, 'data'), generatedDir, model: fakeClient([insertTeam('team_1', 'A')]), modelName: 'fake', notes: '',
      realHandlers,
      loadGenerated: async (keys) => { for (const k of keys) realHandlers.set(k, async () => ({ status: 201, body: { id: 'team_2', name: 'Real' } })); },
      materializer: { start: materializer.start, retry: materializer.retry, isRunning: materializer.isRunning, getLastJob: materializer.getLastJob },
    });

    await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'A' } });
    const started = await app.inject({ method: 'POST', url: '/phantom/materialize', payload: { routes: ['POST /teams'] } });
    expect(started.statusCode).toBe(202);
    await vi.waitFor(() => expect(materializer.getLastJob()?.phase).toMatch(/done|failed/), { timeout: 3_000 });
    expect(materializer.getLastJob()).toMatchObject({ phase: 'done', tests: { failed: 0 } });
    expect(events.map((e) => e.phase)).toEqual(expect.arrayContaining(['context', 'codex', 'tests', 'activate', 'done']));

    const r = await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'Real' } });
    expect(r.headers['x-phantom-mode']).toBe('REAL');
    const routes = (await app.inject({ method: 'GET', url: '/phantom/routes' })).json();
    expect(routes.find((x: { key: string }) => x.key === 'POST /teams').mode).toBe('REAL');
  });
});

describe('codex nudge', () => {
  async function runJob(writeOnAttempt: number) {
    const proxyDir = tempDir();
    for (const f of ['src/testing/replay.ts', 'src/testing/contract.test.ts', 'vitest.generated.config.ts']) {
      mkdirSync(join(proxyDir, f, '..'), { recursive: true });
      writeFileSync(join(proxyDir, f), '// gate');
    }
    const generatedDir = join(tempDir(), 'generated');
    let attempts = 0;
    const run = vi.fn(async (c: { command: string; args: string[]; input?: string }) => {
      if (c.command === 'codex') {
        attempts++;
        if (attempts === writeOnAttempt) writeFileSync(join(generatedDir, 'handlers.ts'), 'export const handlers = {};');
        return;
      }
      throw new Error('stop after codex');
    });
    const m = createMaterializer({ proxyDir, generatedDir, timeoutMs: 5_000, run: run as never, emit: () => {} });
    const deps = { schemas: { all: () => ({ 'POST /teams': {} }) }, readRecordings: () => [{ seq: 1, routeKey: 'POST /teams', ok: true, mode: 'PHANTOM' }],
                   loadGenerated: async () => {}, setMode: () => {} };
    m.start(['POST /teams'], deps as never);
    await vi.waitFor(() => expect(m.isRunning()).toBe(false));
    return { attempts, inputs: run.mock.calls.filter(([c]) => c.command === 'codex').map(([c]) => c.input) };
  }

  it('asks Codex once more when it stops without writing handlers.ts', async () => {
    const { attempts, inputs } = await runJob(2);
    expect(attempts).toBe(2);
    expect(inputs[1]).toMatch(/You stopped before writing generated\/handlers\.ts/);
  });

  it('does not nudge when the first attempt wrote the code', async () => {
    expect((await runJob(1)).attempts).toBe(1);
  });
});

