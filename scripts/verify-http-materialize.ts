// Five-route LIVE Cerebras + Codex rehearsal through the actual HTTP route handlers.
// Stop the proxy first; generated artifacts are backed up and restored.
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, renameSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createApp } from '../packages/proxy/src/app.ts';
import { cerebrasClient } from '../packages/proxy/src/model.ts';
import { materialize, retryMaterialize, isMaterializing, getMaterializeJob } from '../packages/proxy/src/materialize.ts';
import { realHandlers, loadGenerated } from '../packages/proxy/src/realHandlers.ts';
import { GENERATED_DIR, PROXY_DIR } from '../packages/proxy/src/config.ts';
if (!process.env.CEREBRAS_API_KEY) throw new Error('Load the ignored local .env first');
assert.equal(GENERATED_DIR, resolve(PROXY_DIR, 'generated'));
const dir = mkdtempSync(resolve(tmpdir(), 'phantom-http-rehearsal-'));
const backup = resolve(dir, 'generated-backup');
if (existsSync(GENERATED_DIR)) renameSync(GENERATED_DIR, backup);
mkdirSync(GENERATED_DIR, { recursive: true });
const { app, ctx } = await createApp({ dataDir: resolve(dir, 'data'), generatedDir: GENERATED_DIR, model: cerebrasClient(), modelName: 'live-cerebras', realHandlers, loadGenerated, materializer: { start: materialize, retry: retryMaterialize, isRunning: isMaterializing, getLastJob: getMaterializeJob } });
const latencies: number[] = [];
let lastCall = 0;
async function api(method: 'GET' | 'POST', url: string, payload?: unknown, mode = 'PHANTOM') {
  if (mode === 'PHANTOM') { const wait = 14000 - (Date.now() - lastCall); if (wait > 0) await new Promise(r => setTimeout(r, wait)); lastCall = Date.now(); }
  const start = Date.now();
  const response = await app.inject({ method, url, ...(payload !== undefined ? { payload: payload as any } : {}) });
  assert(response.statusCode >= 200 && response.statusCode < 300, `${url}: ${response.statusCode} ${response.body}`);
  assert.equal(response.headers['x-phantom-mode'], mode);
  if (mode === 'PHANTOM') latencies.push(Date.now() - start);
  console.log(`${mode} ${method} ${url}: ${response.statusCode}`);
  return response.json();
}
try {
  const team = await api('POST', '/api/teams', { name: 'Before', members: ['Garv'] });
  const teams = await api('GET', '/api/teams'); assert(teams.some((t: any) => t.id === team.id));
  const detail = await api('GET', `/api/teams/${team.id}`); assert.equal(detail.name, 'Before');
  const project = await api('POST', '/api/projects', { teamId: team.id, title: 'Phantom', pitch: 'Backend before it exists' });
  await api('POST', `/api/projects/${project.id}/upvote`, {});
  const votesBefore = ctx.store.get('projects', project.id)?.votes;
  assert.equal(votesBefore, 1, `Expected stored project.votes=1; actual project: ${JSON.stringify(ctx.store.get('projects', project.id))}`);
  const routes = ['POST /teams', 'GET /teams', 'GET /teams/:id', 'POST /projects', 'POST /projects/:id/upvote'];
  const start = Date.now();
  const accepted = await app.inject({ method: 'POST', url: '/phantom/materialize', payload: { routes } });
  assert.equal(accepted.statusCode, 202, accepted.body);
  const jobId = accepted.json().jobId;
  assert.equal((await app.inject({ method: 'POST', url: '/phantom/reset' })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: '/phantom/materialize', payload: { routes } })).statusCode, 409);
  console.log(`HTTP accepted ${jobId}; reset and duplicate start correctly rejected`);
  let phase = '';
  while (true) {
    const response = await app.inject({ method: 'GET', url: '/phantom/materialize' });
    const status = response.json(); assert.equal(status.job.jobId, jobId);
    if (status.job.phase !== phase) { phase = status.job.phase; console.log(`Phase: ${phase}`); }
    if (!status.running) { assert.equal(status.job.phase, 'done', status.job.error); break; }
    await new Promise(r => setTimeout(r, 1000));
  }
  const materializeMs = Date.now() - start;
  const after = await api('POST', '/api/teams', { name: 'After', members: ['Garv'] }, 'REAL');
  assert.notEqual(after.id, team.id);
  assert.equal((await api('GET', `/api/teams/${after.id}`, undefined, 'REAL')).name, 'After');
  const list = await api('GET', '/api/teams', undefined, 'REAL');
  assert(list.some((t: any) => t.id === team.id) && list.some((t: any) => t.id === after.id));
  const nextProject = await api('POST', '/api/projects', { teamId: after.id, title: 'Second', pitch: 'Fresh input' }, 'REAL');
  assert.notEqual(nextProject.id, project.id);
  await api('POST', `/api/projects/${project.id}/upvote`, {}, 'REAL');
  assert.equal(ctx.store.get('projects', project.id)?.votes, 2);
  const report = { success: true, at: new Date().toISOString(), scope: 'five routes; live models; real HTTP handlers via Fastify inject; no UI', materializeMs, phantomLatenciesMs: latencies, tests: getMaterializeJob()?.tests, guards: { reset: 409, duplicate: 409 }, preservedData: true };
  const target = resolve(PROXY_DIR, '../../data/http-rehearsal.json'); mkdirSync(resolve(PROXY_DIR, '../../data'), { recursive: true }); writeFileSync(target, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  const failure = { at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error), recordings: ctx.recorder.read({ limit: 100 }), store: ctx.store.dump() };
  mkdirSync(resolve(PROXY_DIR, '../../data'), { recursive: true });
  writeFileSync(resolve(PROXY_DIR, '../../data/http-rehearsal-failure.json'), JSON.stringify(failure, null, 2));
  throw error;
} finally {
  await app.close(); realHandlers.clear();
  assert.equal(GENERATED_DIR, resolve(PROXY_DIR, 'generated'));
  rmSync(GENERATED_DIR, { recursive: true, force: true });
  if (existsSync(backup)) renameSync(backup, GENERATED_DIR);
  rmSync(dir, { recursive: true, force: true });
}
