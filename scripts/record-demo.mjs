// Records a narrated backup video of the full live demo: Hackathon Hub + dashboard side by side.
// Uses the real running apps (proxy :4000, hub :5173, dashboard :5174) with live Cerebras and Codex.
// Run `node scripts/reset.mjs` first. Requires Playwright (PHANTOM_PLAYWRIGHT_MODULE=/path/to/playwright)
// and a Chromium-family browser (PHANTOM_BROWSER_CHANNEL, default "chrome"). Frames come from Chrome's own
// screencast and are assembled with the system ffmpeg, so no extra Playwright downloads are needed.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const mod = process.env.PHANTOM_PLAYWRIGHT_MODULE;
const { chromium } = await import(mod ? pathToFileURL(resolve(mod, 'index.mjs')).href : 'playwright');
const output = resolve(process.env.PHANTOM_RECORDING_DIR ?? 'data/demo-recording');
mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PHANTOM_BROWSER_CHANNEL ?? 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

// Trial Cerebras keys allow 5 requests/minute. Keep a sliding window instead of fixed gaps,
// and say on screen when we are waiting so the video never looks frozen.
const WINDOW_MS = 62_000, LIMIT = 5;
let paced = true;
const sent = [];
let queue = Promise.resolve();
let page;
await context.route('**/api/**', (route) => {
  const next = queue.then(async () => {
    if (paced) {
      const now = Date.now();
      while (sent.length && now - sent[0] > WINDOW_MS) sent.shift();
      if (sent.length >= LIMIT) {
        const wait = WINDOW_MS - (now - sent[0]);
        await page?.evaluate((s) => window.setWaiting(s), Math.ceil(wait / 1000)).catch(() => {});
        await new Promise((r) => setTimeout(r, wait));
        await page?.evaluate(() => window.setWaiting(0)).catch(() => {});
        sent.shift();
      }
      sent.push(Date.now());
    }
    await route.continue();
  });
  queue = next.catch(() => {});
  return next;
});

page = await context.newPage();
page.setDefaultTimeout(90_000);

// Screencast frames arrive only when the page changes; keep their timestamps to rebuild real-time durations.
const framesDir = resolve(output, 'frames');
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
const frames = [];
// Frame indexes covering the Materialize run, which stays real time; idle stalls elsewhere get trimmed.
const realTime = { from: Infinity, to: Infinity };
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  const file = resolve(framesDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  frames.push({ file, t: metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const calls = [];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => {
  if (r.url().includes('/api/')) calls.push({ url: r.url().replace(/^.*\/api/, ''), status: r.status(), mode: r.headers()['x-phantom-mode'] });
});

await page.setContent(`<!doctype html><html><head><style>
  body{margin:0;background:#12101A;color:#EDEAF7;font:500 22px/1.3 "Space Grotesk",system-ui,sans-serif;overflow:hidden}
  header{height:84px;display:flex;align-items:center;gap:20px;padding:0 32px;box-sizing:border-box;border-bottom:1px solid #2C2840}
  #step{font:600 15px "JetBrains Mono",monospace;color:#12101A;background:#A78BFA;border-radius:999px;padding:6px 14px;white-space:nowrap}
  #step.real{background:#5EE6A0}
  #caption{flex:1}
  #wait{font:500 15px "JetBrains Mono",monospace;color:#F5C26B;white-space:nowrap}
  main{display:flex;height:calc(100vh - 84px)}
  iframe{width:50%;height:100%;border:0}
  #hub{border-right:1px solid #2C2840}
  #card{position:fixed;inset:0;background:#12101A;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;transition:opacity .6s}
  #card h1{font-size:96px;margin:0;letter-spacing:-2px} #card p{font-size:30px;margin:0;color:#B9B2D3}
  #card .tag{font:600 18px "JetBrains Mono",monospace;color:#A78BFA;letter-spacing:4px}
</style></head><body>
  <header><span id="step">PHANTOM</span><span id="caption"></span><span id="wait"></span></header>
  <main><iframe id="hub" src="http://127.0.0.1:5173"></iframe><iframe id="dash" src="http://127.0.0.1:5174"></iframe></main>
  <div id="card"><span class="tag">DEVDAY EXCHANGE · NEW DELHI</span><h1>Phantom</h1><p>Use a backend before it exists.</p></div>
  <script>
    window.say = (step, text, real) => { const s = document.getElementById('step'); s.textContent = step; s.classList.toggle('real', !!real); document.getElementById('caption').textContent = text; };
    window.setWaiting = (secs) => { document.getElementById('wait').textContent = secs ? '⏸ trial API limit (5 req/min): resuming in ~' + secs + 's' : ''; };
    window.card = (show, title, sub) => { const c = document.getElementById('card'); if (title) { c.querySelector('h1').textContent = title; c.querySelector('p').textContent = sub; } c.style.opacity = show ? 1 : 0; c.style.pointerEvents = show ? 'auto' : 'none'; };
  </script>
</body></html>`);

const say = (step, text, real = false) => page.evaluate(([a, b, c]) => window.say(a, b, c), [step, text, real]);
const pause = (ms) => page.waitForTimeout(ms);
const hub = page.frameLocator('#hub');
const dash = page.frameLocator('#dash');
const type = async (locator, text) => { await locator.click(); await locator.pressSequentially(text, { delay: 45 }); };

try {
  await pause(3500);
  await page.evaluate(() => window.card(false));
  await say('NO BACKEND', 'This app has no backend code. Every API call is answered live by a model on Cerebras.');
  await hub.getByRole('heading', { name: /The teams/ }).waitFor();
  await pause(4000);

  await say('PHANTOM', 'Create a team. Phantom keeps a real data store, so it stays consistent.');
  await type(hub.getByLabel('Team name', { exact: true }), 'Byte Me');
  await type(hub.locator('#team-members'), 'Garv, Abhik, Lakshay');
  await pause(600);
  await hub.getByRole('button', { name: /Create team/ }).click();
  await hub.getByRole('heading', { name: 'Byte Me', exact: true }).waitFor();
  await say('PHANTOM', 'Every request shows up live on the right: answered by Cerebras, recorded, shape locked.');
  await pause(5000);

  await say('PHANTOM', 'Add a project. The model follows plain-English app notes: votes start at 0.');
  await type(hub.getByLabel('Project title', { exact: true }), 'Phantom');
  await type(hub.getByLabel('The pitch', { exact: true }), 'Use a backend before it exists.');
  await pause(600);
  await hub.getByRole('button', { name: /Add project/ }).click();
  await hub.getByRole('heading', { name: 'Phantom', exact: true }).waitFor();
  await pause(3500);

  await say('PHANTOM', 'Upvote. Still no backend code: the phantom updates the stored project.');
  await hub.getByRole('button', { name: 'Upvote Phantom', exact: true }).click();
  await hub.getByRole('button', { name: 'Upvote Phantom', exact: true }).getByText('1', { exact: true }).waitFor();
  await pause(3500);

  await say('PHANTOM', 'Back to the team list: the data is really there.');
  await hub.getByRole('button', { name: /All teams/ }).click();
  await hub.getByText('Byte Me').first().waitFor();
  await pause(4500);

  await say('MATERIALIZE', 'Every click was recorded. That recording is the spec. Now: Materialize.');
  await pause(3000);
  await dash.getByRole('button', { name: 'Select all', exact: true }).click();
  await pause(1500);
  realTime.from = frames.length;
  await dash.getByRole('button', { name: /Materialize selected/ }).click();
  await dash.locator('.job-panel').scrollIntoViewIfNeeded();
  await say('MATERIALIZE', 'Codex is writing real route handlers and contract tests from the recorded traffic (real time).');
  await dash.locator('.job-done').waitFor({ timeout: 360_000 });
  paced = false;
  realTime.to = frames.length;
  await say('REAL', 'Phantom ran the tests itself. They all passed, so traffic switched to the generated code.', true);
  await pause(6000);

  await say('REAL', 'Same app, same data, now real code. New team: served by the generated backend.', true);
  await hub.getByLabel('Team name', { exact: true }).waitFor();
  await type(hub.getByLabel('Team name', { exact: true }), 'Null Pointers');
  await type(hub.locator('#team-members'), 'A judge');
  await hub.getByRole('button', { name: /Create team/ }).click();
  await hub.getByRole('heading', { name: 'Null Pointers', exact: true }).waitFor();
  await pause(5000);

  await say('REAL', 'The frontend is the spec. Every click is a test.', true);
  await pause(3500);
  await page.evaluate(() => window.card(true, 'Phantom', 'The frontend is the spec. Every click is a test.'));
  await pause(4000);

  const result = { success: true, at: new Date().toISOString(), calls, errors };
  writeFileSync(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  if (!calls.some((c) => c.mode === 'PHANTOM') || !calls.some((c) => c.mode === 'REAL')) throw new Error('expected both PHANTOM and REAL calls');
  console.log('Recorded the full demo:', calls.map((c) => `${c.mode} ${c.status} ${c.url}`).join(' | '));
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') });
  writeFileSync(resolve(output, 'failure.json'), JSON.stringify({ error: String(error), calls, errors }, null, 2));
  throw error;
} finally {
  await cdp.send('Page.stopScreencast').catch(() => {});
  await page.waitForTimeout(300);
  await context.close();
  await browser.close();
  // ffmpeg concat list: each frame lasts until the next one arrived. Outside Materialize, a frozen frame
  // longer than MAX_IDLE is our own rate-limit pacing (not product latency), so it is trimmed.
  const MAX_IDLE = 2;
  const lines = [];
  frames.forEach((f, i) => {
    const next = frames[i + 1]?.t ?? f.t + 2.5;
    const inMaterialize = i >= realTime.from && i < realTime.to;
    const duration = Math.max(0.001, next - f.t);
    lines.push(`file '${f.file}'`, `duration ${(inMaterialize ? duration : Math.min(duration, MAX_IDLE)).toFixed(3)}`);
  });
  if (frames.length) lines.push(`file '${frames.at(-1).file}'`);
  const list = resolve(output, 'frames.txt');
  writeFileSync(list, lines.join('\n') + '\n');
  const mp4 = resolve(output, 'phantom-demo.mp4');
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', mp4]);
  console.log(ff.status === 0 ? `Video: ${mp4} (${frames.length} frames)` : `ffmpeg failed: ${ff.stderr}`);
}
