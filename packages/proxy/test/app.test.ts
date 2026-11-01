import { describe, it, expect } from 'vitest';
import { writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { testApp, ok } from './helpers.ts';

const insertTeam = (id: string, name: string) =>
  ok(201, { id, name }, [{ op: 'insert', collection: 'teams', id, record: { id, name } }]);

describe('/api/* phantom loop', () => {
  it('creates a record through the model and our store', async () => {
    const { app, ctx, model } = await testApp([insertTeam('team_1', 'Byte Me'), ok(200, [{ id: 'team_1', name: 'Byte Me' }])]);
    const r1 = await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'Byte Me' } });
    expect(r1.statusCode).toBe(201);
    expect(r1.headers['x-phantom-mode']).toBe('PHANTOM');
    expect(ctx.store.get('teams', 'team_1')).toEqual({ id: 'team_1', name: 'Byte Me' });
    expect(model.calls[0][1].content).toContain('RESERVED IDS: {"teams":"team_1"}');

    const r2 = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(r2.json()).toEqual([{ id: 'team_1', name: 'Byte Me' }]);
    expect(model.calls[1][1].content).toContain('RESERVED IDS: none (read request)');
    expect(model.calls[1][1].content).toContain('"team_1"');
  });

  it('retries once with the rejection reason', async () => {
    const { app, model } = await testApp(['not json', insertTeam('team_1', 'A')]);
    const r = await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'A' } });
    expect(r.statusCode).toBe(201);
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1].at(-1)!.content).toMatch(/previous answer was rejected/);
  });

  it('returns 502 after two bad answers and leaves the store unchanged', async () => {
    const { app, ctx } = await testApp([ok(200, [], [{ op: 'delete', collection: 'teams', id: 'x' }]), new Error('429 rate limited')]);
    const r = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toBe('phantom_invalid');
    expect(r.headers['x-phantom-mode']).toBe('ERROR');
    expect(ctx.store.version).toBe(0);
    expect(ctx.recorder.read().at(-1)).toMatchObject({ ok: false, mode: 'ERROR', retries: 1 });
  });

  it('fails fast with 429 on a model rate limit, without retrying', async () => {
    const { app, model } = await testApp([Object.assign(new Error('Too Many Requests'), { status: 429 })]);
    const r = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(r.statusCode).toBe(429);
    expect(r.json().error).toBe('rate_limited');
    expect(model.calls).toHaveLength(1);
  });

  it('locks the schema and retries answers that break it', async () => {
    const { app, model } = await testApp([
      ok(200, [{ id: 'team_1', name: 'A' }]),
      insertTeam('team_1', 'A'),
      ok(200, [{ id: 'team_1', title: 'A' }]),
      ok(200, [{ id: 'team_1', name: 'A' }]),
    ]);
    await app.inject({ method: 'GET', url: '/api/teams' });
    await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'A' } });
    const r = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(r.json()).toEqual([{ id: 'team_1', name: 'A' }]);
    expect(model.calls[3].at(-1)!.content).toMatch(/locked schema/);
  });

  it('serves repeated reads from the cache until the store changes', async () => {
    const { app, model } = await testApp([ok(200, { total: 0 }), insertTeam('team_1', 'A'), ok(200, { total: 1 })]);
    await app.inject({ method: 'GET', url: '/api/stats' });
    const cached = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(cached.headers['x-phantom-mode']).toBe('CACHED');
    await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'A' } });
    const fresh = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(fresh.json()).toEqual({ total: 1 });
    expect(model.calls).toHaveLength(3);
  });

  it('caches per actual path, not per route pattern', async () => {
    const { app, model } = await testApp([ok(200, { id: 'team_1', name: 'A' }), ok(200, { id: 'team_2', name: 'B' })]);
    await app.inject({ method: 'GET', url: '/api/teams/team_1' });
    const r = await app.inject({ method: 'GET', url: '/api/teams/team_2' });
    expect(r.headers['x-phantom-mode']).toBe('PHANTOM');
    expect(r.json()).toEqual({ id: 'team_2', name: 'B' });
    expect((await app.inject({ method: 'GET', url: '/api/teams/team_1' })).headers['x-phantom-mode']).toBe('CACHED');
    expect(model.calls).toHaveLength(2);
  });

  it('serialises writes so ids never collide', async () => {
    const { app, ctx } = await testApp([insertTeam('team_1', 'A'), insertTeam('team_2', 'B')]);
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'A' } }),
      app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'B' } }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(ctx.store.list('teams')).toHaveLength(2);
  });

  it('accepts a POST with a JSON content-type and no body', async () => {
    const { app } = await testApp([ok(404, { error: 'project not found' })]);
    const r = await app.inject({ method: 'POST', url: '/api/projects/project_1/upvote', headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(404);
  });

  it('routes to a real handler when one is registered', async () => {
    const { app, ctx, model } = await testApp();
    ctx.realHandlers.set('GET /teams/:id', async ({ params }) => ({ status: 200, body: { id: params.id, real: true } }));
    const r = await app.inject({ method: 'GET', url: '/api/teams/team_1' });
    expect(r.headers['x-phantom-mode']).toBe('REAL');
    expect(r.json()).toEqual({ id: 'team_1', real: true });
    expect(model.calls).toHaveLength(0);
  });
});

describe('/phantom/* control API', () => {
  it('records exchanges and reports routes', async () => {
    const { app } = await testApp([insertTeam('team_1', 'A')]);
    await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'A' } });
    const recs = (await app.inject({ method: 'GET', url: '/phantom/recordings' })).json();
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ seq: 1, routeKey: 'POST /teams', mode: 'PHANTOM', ok: true });
    expect(recs[0].storeBefore.nextId).toEqual({ teams: 1 });
    const routes = (await app.inject({ method: 'GET', url: '/phantom/routes' })).json();
    expect(routes[0]).toMatchObject({ key: 'POST /teams', mode: 'PHANTOM', calls: 1, locked: true });
  });

  it('replays recorded responses without calling the model', async () => {
    const { app, model } = await testApp([ok(200, [{ id: 'team_1', name: 'A' }])]);
    await app.inject({ method: 'GET', url: '/api/teams' });
    await app.inject({ method: 'POST', url: '/phantom/replay', payload: { on: true } });
    const r = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(r.headers['x-phantom-mode']).toBe('REPLAY');
    expect(r.json()).toEqual([{ id: 'team_1', name: 'A' }]);
    const missing = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(missing.statusCode).toBe(503);
    expect(model.calls).toHaveLength(1);
  });

  it('replays per actual path, not per route pattern', async () => {
    const { app } = await testApp([ok(200, { id: 'team_1', name: 'A' })]);
    await app.inject({ method: 'GET', url: '/api/teams/team_1' });
    await app.inject({ method: 'POST', url: '/phantom/replay', payload: { on: true } });
    expect((await app.inject({ method: 'GET', url: '/api/teams/team_1' })).json()).toEqual({ id: 'team_1', name: 'A' });
    expect((await app.inject({ method: 'GET', url: '/api/teams/team_2' })).statusCode).toBe(503);
  });

  it('resets everything, including generated files', async () => {
    const { app, ctx, generatedDir } = await testApp([insertTeam('team_1', 'A')]);
    await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'A' } });
    writeFileSync(join(generatedDir, '.gitkeep'), '');
    writeFileSync(join(generatedDir, 'handlers.ts'), 'export const handlers = {}');
    ctx.realHandlers.set('GET /x', async () => ({ status: 200, body: {} }));
    await app.inject({ method: 'POST', url: '/phantom/reset' });
    expect(ctx.store.version).toBe(0);
    expect(ctx.schemas.all()).toEqual({});
    expect(ctx.recorder.read()).toEqual([]);
    expect(ctx.realHandlers.size).toBe(0);
    expect(readdirSync(generatedDir)).toEqual(['.gitkeep']);
    expect(existsSync(join(generatedDir, 'handlers.ts'))).toBe(false);
  });

  it('reports health', async () => {
    const { app } = await testApp();
    expect((await app.inject({ method: 'GET', url: '/phantom/health' })).json()).toEqual({ ok: true, model: 'fake', replay: false });
  });
});

describe('app notes', () => {
  it('includes the notes in every phantom prompt', async () => {
    const dir = (await import('./helpers.ts')).tempDir();
    const { createApp } = await import('../src/app.ts');
    const { fakeClient } = await import('../src/model.ts');
    const model = fakeClient([ok(200, [])]);
    const { app } = await createApp({ dataDir: join(dir, 'data'), generatedDir: join(dir, 'gen'), model, modelName: 'fake',
                                      notes: '- A project has `votes`, starting at 0.' });
    await app.inject({ method: 'GET', url: '/api/projects' });
    expect(model.calls[0][1].content).toMatch(/^APP NOTES[^\n]*\n- A project has `votes`, starting at 0\./);
  });
});
