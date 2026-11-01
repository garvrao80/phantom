// Live Codex, fake Cerebras input. Never runs against a production data store.
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../packages/proxy/src/app.ts';
import { fakeClient } from '../packages/proxy/src/model.ts';
import { materialize, isMaterializing, getMaterializeJob } from '../packages/proxy/src/materialize.ts';
import { realHandlers, loadGenerated } from '../packages/proxy/src/realHandlers.ts';
import { GENERATED_DIR } from '../packages/proxy/src/config.ts';
if (existsSync(resolve(GENERATED_DIR, 'handlers.ts')) && !process.argv.includes('--retry-generated')) throw new Error('Existing generated handlers: run in a clean disposable checkout or use --retry-generated for a prior test run');
const dir = mkdtempSync(resolve(tmpdir(), 'phantom-live-materialize-'));
const team = { id: 'team_1', name: 'Before' };
const model = fakeClient([{ status: 201, body: team, storeOps: [{ op: 'insert', collection: 'teams', id: team.id, record: team }] }]);
const { app, ctx } = await createApp({ dataDir: resolve(dir, 'data'), generatedDir: GENERATED_DIR, model, modelName: 'scripted-test-input', realHandlers });
try {
  const before = await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'Before' } });
  assert.equal(before.statusCode, 201); assert.equal(before.headers['x-phantom-mode'], 'PHANTOM');
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
  const after = await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'After' } });
  assert.equal(after.statusCode, 201); assert.equal(after.headers['x-phantom-mode'], 'REAL');
  assert.equal(after.json().id, 'team_2'); assert.equal(after.json().name, 'After');
  assert.equal(ctx.store.get('teams', 'team_1')?.name, 'Before');
  assert.equal(ctx.store.get('teams', 'team_2')?.name, 'After');
  assert.equal(model.calls.length, 1);
  console.log(JSON.stringify({ success: true, milliseconds: Date.now() - start, tests: job?.tests, modelCalls: model.calls.length }));
} finally { await app.close(); realHandlers.clear(); rmSync(dir, { recursive: true, force: true }); }
