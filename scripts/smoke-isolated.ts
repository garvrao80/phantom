// Live Cerebras smoke on an ephemeral server/store; does not reset the user's demo.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createApp } from '../packages/proxy/src/app.ts';
import { cerebrasClient } from '../packages/proxy/src/model.ts';
import { ROOT_DIR } from '../packages/proxy/src/config.ts';
if (!process.env.CEREBRAS_API_KEY) throw new Error('Load .env first');
const dir = mkdtempSync(resolve(tmpdir(), 'phantom-smoke-'));
const { app } = await createApp({ dataDir: resolve(dir, 'data'), generatedDir: resolve(dir, 'generated'), model: cerebrasClient(), modelName: 'live-cerebras' });
try {
  const base = await app.listen({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((done, fail) => {
    const child = spawn(process.execPath, [resolve(ROOT_DIR, 'scripts/smoke.mjs')], { env: { ...process.env, PHANTOM_BASE_URL: base }, stdio: 'inherit', windowsHide: true });
    child.on('error', fail); child.on('exit', code => code === 0 ? done() : fail(new Error(`Smoke exited ${code}`)));
  });
} finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
