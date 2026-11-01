// Live acceptance check. Start clean, isolated apps; this consumes real model calls.
// PHANTOM_VERIFY_RESET=1 additionally tests destructive reset on that isolated server.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.PHANTOM_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'playwright');
const hubUrl = process.env.PHANTOM_VERIFY_HUB ?? 'http://127.0.0.1:5273';
const dashUrl = process.env.PHANTOM_VERIFY_DASH ?? 'http://127.0.0.1:5274';
const proxyUrl = process.env.PHANTOM_VERIFY_PROXY ?? 'http://127.0.0.1:4100';
const output = resolve('data/final-ui-verification');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const calls = [], errors = [];
let paced = true, last = 0, queue = Promise.resolve();
await context.route('**/api/**', route => {
  const next = queue.then(async () => {
    if (paced) {
      const remaining = 14000 - (Date.now() - last);
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
      last = Date.now();
    }
    await route.continue();
  });
  queue = next.catch(() => {});
  return next;
});
context.on('page', page => {
  page.setDefaultTimeout(65000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', response => {
    if (response.url().includes('/api/')) {
      const item = { path: new URL(response.url()).pathname, status: response.status(), mode: response.headers()['x-phantom-mode'] };
      calls.push(item); console.log(JSON.stringify(item));
    }
  });
});
async function control(path, body) {
  return fetch(`${proxyUrl}/phantom${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
async function real(path) {
  const res = await fetch(`${proxyUrl}/api${path}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-phantom-mode'), 'REAL');
  return res.json();
}
const hub = await context.newPage(), dash = await context.newPage(), backend = await context.newPage();
try {
  const initial = await (await control('/backend')).json();
  assert.equal(initial.state, 'none', 'Use a clean isolated server');
  assert.equal(initial.routes.length, 0, 'Use a clean isolated store');
  await Promise.all([hub.goto(hubUrl), dash.goto(dashUrl), backend.goto(`${dashUrl}/#/backend`)]);
  await backend.getByRole('heading', { name: 'No backend yet.', exact: true }).waitFor();
  await hub.getByLabel('Team name', { exact: true }).fill('Final Verification');
  await hub.locator('#team-members').fill('Garv, Abhik, Lakshay');
  await hub.getByRole('button', { name: /Create team/ }).click();
  await hub.getByRole('heading', { name: 'Final Verification', exact: true }).waitFor();
  await hub.getByLabel('Project title', { exact: true }).fill('Verified Project');
  await hub.getByLabel('The pitch', { exact: true }).fill('A real backend from real frontend usage.');
  await hub.getByRole('button', { name: /Add project/ }).click();
  await hub.getByRole('heading', { name: 'Verified Project', exact: true }).waitFor();
  const vote = hub.getByRole('button', { name: 'Upvote Verified Project', exact: true });
  await vote.click(); await vote.getByText('1', { exact: true }).waitFor();
  await hub.getByRole('button', { name: /All teams/ }).click();
  await hub.getByRole('heading', { name: 'Final Verification', exact: true }).waitFor();
  await hub.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  await hub.getByRole('heading', { name: 'Verified Project', exact: true }).waitFor();
  await hub.locator('.ranking-list .score strong').getByText('1', { exact: true }).waitFor();
  const routes = await (await control('/routes')).json();
  assert.equal(routes.filter(r => r.locked).length, 7, 'Every app route should have a schema');
  await dash.getByRole('button', { name: 'Select all', exact: true }).click();
  const started = Date.now();
  await dash.getByRole('button', { name: /Materialize selected/ }).click();
  await backend.getByRole('heading', { name: 'Your backend is being built.', exact: true }).waitFor();
  const status = await (await control('/materialize')).json();
  assert.equal(status.running, true);
  assert.equal((await control('/reset', {})).status, 409);
  assert.equal((await control('/materialize', { routes: routes.map(r => r.key) })).status, 409);
  await dash.reload();
  await dash.getByText('Reconnected to a running job', { exact: false }).waitFor();
  console.log('Seven routes requested; reset/concurrent guards and dashboard reload recovery passed');
  while (true) {
    const state = await (await control('/materialize')).json();
    if (!state.running) {
      assert.equal(state.job.phase, 'done', state.job.error);
      break;
    }
    assert(Date.now() - started < 630000, 'Materialize exceeded two allowed Codex invocations');
    await new Promise(r => setTimeout(r, 1000));
  }
  await dash.getByRole('link', { name: 'Open your backend →' }).waitFor();
  await backend.getByRole('heading', { name: 'Your backend is live.', exact: true }).waitFor();
  const materializeMs = Date.now() - started;
  const reveal = await (await control('/backend')).json();
  assert.equal(reveal.state, 'live'); assert.equal(reveal.routes.filter(r => r.mode === 'REAL').length, 7);
  assert(reveal.code.source.length > 0); assert(reveal.code.lines > 0); assert(reveal.testFiles.length > 0);
  assert(reveal.job.tests.passed > 0); assert.equal(reveal.job.tests.failed, 0);
  paced = false;
  const realStart = calls.length;
  await hub.getByRole('button', { name: 'Teams', exact: true }).click();
  await hub.getByLabel('Team name', { exact: true }).fill('After Generation');
  await hub.getByRole('button', { name: /Create team/ }).click();
  await hub.getByRole('heading', { name: 'After Generation', exact: true }).waitFor();
  await hub.getByLabel('Project title', { exact: true }).fill('Fresh Real Project');
  await hub.getByLabel('The pitch', { exact: true }).fill('Generated handlers accept new inputs.');
  await hub.getByRole('button', { name: /Add project/ }).click();
  await hub.getByRole('heading', { name: 'Fresh Real Project', exact: true }).waitFor();
  const freshVote = hub.getByRole('button', { name: 'Upvote Fresh Real Project', exact: true });
  for (let n = 1; n <= 3; n++) { await freshVote.click(); await freshVote.getByText(String(n), { exact: true }).waitFor(); }
  const teams = await real('/teams');
  assert.equal(teams.length, 2);
  for (const team of [...teams, ...teams].reverse()) assert.equal((await real(`/teams/${team.id}`)).name, team.name);
  await hub.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  await hub.getByRole('heading', { name: 'Fresh Real Project', exact: true }).waitFor();
  const rankings = await real('/leaderboard');
  assert.equal(rankings[0].title, 'Fresh Real Project'); assert.equal(rankings[0].votes, 3);
  assert.equal(rankings.find(p => p.title === 'Verified Project').votes, 1);
  assert(calls.slice(realStart).length >= 8);
  assert(calls.slice(realStart).every(r => r.mode === 'REAL'), JSON.stringify(calls.slice(realStart)));
  assert(calls.every(r => r.status < 400), JSON.stringify(calls)); assert.deepEqual(errors, []);
  await backend.screenshot({ path: resolve(output, 'backend-live.png'), fullPage: true });
  await hub.screenshot({ path: resolve(output, 'leaderboard-real.png'), fullPage: true });
  let resetVerified = false;
  if (process.env.PHANTOM_VERIFY_RESET === '1') {
    assert.equal((await control('/reset', {})).status, 200);
    await backend.getByRole('heading', { name: 'No backend yet.', exact: true }).waitFor();
    const cleared = await (await control('/backend')).json();
    assert.equal(cleared.job, null); assert.equal(cleared.code, null); assert.equal(cleared.routes.length, 0);
    resetVerified = true;
  }
  const report = { success: true, at: new Date().toISOString(), liveModels: true, routes: 7, materializeMs, tests: reveal.job.tests, reloadRecovery: true, resetGuard: 409, duplicateGuard: 409, resetVerified, preservedData: true, freshInputs: true, calls, errors };
  writeFileSync(resolve(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  await Promise.all([hub.screenshot({ path: resolve(output, 'hub-failure.png') }), dash.screenshot({ path: resolve(output, 'dash-failure.png') })]);
  writeFileSync(resolve(output, 'failure.json'), JSON.stringify({ error: String(error), calls, errors }, null, 2));
  throw error;
} finally { await context.close(); await browser.close(); }
