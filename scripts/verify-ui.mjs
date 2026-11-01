// Requires Playwright installed separately; records the real local apps, never mocks responses.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const mod = process.env.PHANTOM_PLAYWRIGHT_MODULE;
const { chromium } = await import(mod ? pathToFileURL(resolve(mod)).href : 'playwright');
const output = resolve('data/ui-recording'); mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: output, size: { width: 1920, height: 1080 } } });
let paced = true; let last = 0; let queue = Promise.resolve();
await context.route('**/api/**', route => {
  const next = queue.then(async () => {
    if (paced) { const remaining = 14000 - (Date.now() - last); if (remaining > 0) await new Promise(r => setTimeout(r, remaining)); last = Date.now(); }
    await route.continue();
  }); queue = next.catch(() => {}); return next;
});
const page = await context.newPage(); page.setDefaultTimeout(60000);
const calls = []; const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('response', response => {
  if (response.url().includes('/api/')) calls.push({ url: response.url(), status: response.status(), mode: response.headers()['x-phantom-mode'] });
});
try {
  await page.setContent(`<html><head><style>body{margin:0;background:#12101a;color:#ddd;font:16px sans-serif}header{height:32px;padding:8px 24px;box-sizing:border-box}main{display:flex;height:calc(100vh - 32px)}iframe{width:50%;height:100%;border:0;border-right:1px solid #444}</style></head><body><header>PHANTOM — live Cerebras + Codex verification • Requests paced for trial API limits</header><main><iframe id="hub" src="http://127.0.0.1:5173"></iframe><iframe id="dash" src="http://127.0.0.1:5174"></iframe></main></body></html>`);
  const hub = page.frameLocator('#hub'); const dash = page.frameLocator('#dash');
  await hub.getByLabel('Team name', { exact: true }).fill('Phantom Builders');
  await hub.locator('#team-members').fill('Garv, Abhik, Lakshay');
  await hub.getByRole('button', { name: /Create team/ }).click();
  await hub.getByRole('heading', { name: 'Phantom Builders', exact: true }).waitFor();
  await hub.getByLabel('Project title', { exact: true }).fill('Phantom Demo');
  await hub.getByLabel('The pitch', { exact: true }).fill('Build the interface, then materialize its backend.');
  await hub.getByRole('button', { name: /Add project/ }).click();
  await hub.getByRole('heading', { name: 'Phantom Demo', exact: true }).waitFor();
  await hub.getByRole('button', { name: 'Upvote Phantom Demo', exact: true }).click();
  await hub.getByRole('button', { name: 'Upvote Phantom Demo', exact: true }).getByText('1', { exact: true }).waitFor();
  await page.screenshot({ path: resolve(output, 'before.png') });
  await dash.getByRole('button', { name: 'Select all', exact: true }).click();
  await dash.getByRole('button', { name: /Materialize selected/ }).click();
  console.log('UI Materialize started');
  await dash.locator('.job-panel').scrollIntoViewIfNeeded();
  await dash.locator('.job-done').waitFor({ timeout: 320000 });
  console.log('UI reports verified completion'); paced = false;
  await hub.getByLabel('Project title', { exact: true }).fill('After Materialize');
  await hub.getByLabel('The pitch', { exact: true }).fill('Fresh data handled by generated code.');
  await hub.getByRole('button', { name: /Add project/ }).click();
  await hub.getByRole('heading', { name: 'After Materialize', exact: true }).waitFor();
  await hub.getByRole('button', { name: 'Upvote After Materialize', exact: true }).click();
  await hub.getByRole('button', { name: 'Upvote After Materialize', exact: true }).getByText('1', { exact: true }).waitFor();
  assert(calls.some(r => r.mode === 'PHANTOM'));
  assert(calls.slice(-4).every(r => r.mode === 'REAL'));
  assert(calls.every(r => r.status < 400), JSON.stringify(calls.filter(r => r.status >= 400)));
  assert.equal(errors.length, 0, errors.join('; '));
  await page.screenshot({ path: resolve(output, 'after.png') });
  await page.waitForTimeout(4000);
  writeFileSync(resolve(output, 'result.json'), JSON.stringify({ success: true, liveModels: true, calls, errors }, null, 2));
  console.log('UI flow passed: create, vote, Materialize, create and vote through REAL');
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') });
  writeFileSync(resolve(output, 'failure.json'), JSON.stringify({ error: String(error), calls, errors }, null, 2));
  throw error;
} finally { await context.close(); console.log(`Video: ${await page.video().path()}`); await browser.close(); }
