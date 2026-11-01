import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Let the running proxy reset in-memory state before touching files.
const base = `http://localhost:${process.env.PHANTOM_PORT ?? 4000}`;
let online = false;
try { const health = await fetch(`${base}/phantom/health`, { signal: AbortSignal.timeout(1500) }); if (!health.ok) throw new Error(`Proxy health failed (${health.status}); refusing offline reset`); online = true; } catch (error) { if (error?.cause?.code !== 'ECONNREFUSED') throw error; }
if (online) {
  const response = await fetch(`${base}/phantom/reset`, { method: 'POST', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Proxy reset failed (${response.status}); files were not cleared`);
} else {
  for (const relative of ['data', 'packages/proxy/generated']) {
    const dir = resolve(root, relative); mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) if (name !== '.gitkeep') rmSync(resolve(dir, name), { recursive: true, force: true });
  }
}
console.log('Phantom reset complete');
