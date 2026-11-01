// Run before core is available: npm install --prefix <harness> vitest typescript ajv @types/node
// node scripts/test-materialize-isolated.mjs <harness>
// Copies only Garv's modules; stub config/events are explicitly NOT core integration tests.
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Pass an isolated harness directory with vitest installed');
const target = resolve(process.argv[2]);
for (const folder of ['packages/proxy/src', 'scripts']) mkdirSync(resolve(target, folder), { recursive: true });
for (const file of ['packages/proxy/src/materialize.ts', 'scripts/materialize.test.ts']) copyFileSync(resolve(root, file), resolve(target, file));
writeFileSync(resolve(target, 'package.json'), JSON.stringify({ type: 'module' }));
writeFileSync(resolve(target, 'packages/proxy/src/config.ts'), 'export const PROXY_DIR = process.cwd(); export const GENERATED_DIR = process.cwd(); export const config = { codexTimeoutMs: 1000 };');
writeFileSync(resolve(target, 'packages/proxy/src/events.ts'), 'export function emit(_name: string, _event: unknown) {}');
const result = spawnSync(process.execPath, [resolve(target, 'node_modules/vitest/vitest.mjs'), 'run', 'scripts/materialize.test.ts'], { cwd: target, stdio: 'inherit' });
process.exit(result.status ?? 1);
