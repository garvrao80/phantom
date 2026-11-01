// Live Codex, fake Cerebras input. Never runs against a production data store.
import { mkdtempSync, existsSync, rmSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../packages/proxy/src/app.ts';
import { fakeClient, cerebrasClient } from '../packages/proxy/src/model.ts';
import { materialize, isMaterializing, getMaterializeJob } from '../packages/proxy/src/materialize.ts';
import { realHandlers, loadGenerated } from '../packages/proxy/src/realHandlers.ts';
import { GENERATED_DIR, PROXY_DIR } from '../packages/proxy/src/config.ts';
const fresh = process.argv.includes('--fresh');
const live = process.argv.includes('--live-cerebras');
if (live && !process.env.CEREBRAS_API_KEY) throw new Error('CEREBRAS_API_KEY is missing; load the local .env before running');
if (existsSync(resolve(GENERATED_DIR, 'handlers.ts')) && !process.argv.includes('--retry-generated') && !fresh) throw new Error('Existing generated handlers: run in a clean disposable checkout or use --retry-generated for a prior test run');
const dir = mkdtempSync(resolve(tmpdir(), 'phantom-live-materialize-'));
const team = { id: 'team_1', name: 'Before' };
const scripted = fakeClient([{ status: 201, body: team, storeOps: [{ op: 'insert', collection: 'teams', id: team.id, record: team }] }]);
const model = live ? cerebrasClient() : scripted;
const savedGenerated = resolve(dir, 'saved-generated');
if (fresh) {
  assert.equal(GENERATED_DIR, resolve(PROXY_DIR, 'generated'));
  if (existsSync(GENERATED_DIR)) renameSync(GENERATED_DIR, savedGenerated);
  mkdirSync(GENERATED_DIR, { recursive: true });
}
const { app, ctx } = await createApp({ dataDir: resolve(dir, 'data'), generatedDir: GENERATED_DIR, model, modelName: live ? 'live-cerebras' : 'scripted-test-input', realHandlers });
try {
  const beforeStart = Date.now();
  const before = await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'Before' } });
  assert.equal(before.statusCode, 201); assert.equal(before.headers['x-phantom-mode'], 'PHANTOM');
  const phantomLatencyMs = Date.now() - beforeStart;
  console.log(`PHANTOM: created ${before.json().id}; name=${before.json().name}; request=${phantomLatencyMs} ms; source=${live ? 'live Cerebras' : 'scripted input'}`);
  const start = Date.now();
  const { jobId } = materialize(['POST /teams'], { schemas: ctx.schemas, readRecordings: o => ctx.recorder.read(o), loadGenerated, setMode: (k,m) => ctx.routes.setMode(k,m) });
  console.log(`Started ${jobId}`);
  let phase = '';
  while (isMaterializing()) {
    const status = getMaterializeJob();
    if (status?.phase !== phase) { phase = status?.phase ?? ''; console.log(`Phase: ${phase}`); }
    await new Promise(r => setTimeout(r, 1000));
  }
  const job = getMaterializeJob();
  assert.equal(job?.phase, 'done', job?.error);
  console.log(`Verification passed: ${job?.tests?.passed}/${job?.tests?.total} tests. Switching to REAL.`);
  const after = await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'After' } });
  assert.equal(after.statusCode, 201); assert.equal(after.headers['x-phantom-mode'], 'REAL');
  assert.equal(after.json().id, 'team_2'); assert.equal(after.json().name, 'After');
  assert.equal(ctx.store.get('teams', 'team_1')?.name, 'Before');
  assert.equal(ctx.store.get('teams', 'team_2')?.name, 'After');
  console.log(`REAL: created ${after.json().id}; name=${after.json().name}. Original team preserved.`);
  if (!live) assert.equal(scripted.calls.length, 1);
  const report = { success: true, at: new Date().toISOString(), source: live ? 'live-cerebras' : 'scripted-cerebras-input', freshGenerated: fresh, milliseconds: Date.now() - start, phantomLatencyMs, tests: job?.tests };
  const reportArg = process.argv.find(a => a.startsWith('--report='));
  if (reportArg) { const file = resolve(reportArg.slice(9)); writeFileSync(file, JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify(report));
} finally {
  await app.close(); realHandlers.clear();
  if (fresh) {
    assert.equal(GENERATED_DIR, resolve(PROXY_DIR, 'generated'));
    rmSync(GENERATED_DIR, { recursive: true, force: true });
    if (existsSync(savedGenerated)) renameSync(savedGenerated, GENERATED_DIR);
  }
  rmSync(dir, { recursive: true, force: true });
}
