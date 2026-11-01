// Records actual CLI output. These are terminal recordings, not a UI demo video.
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const proxy = resolve(root, 'packages/proxy');
const require = createRequire(resolve(proxy, 'package.json'));
const live = process.argv.includes('--live-cerebras');
const output = resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) ?? resolve(root, 'data/rehearsals'));
const runs = Number(process.argv.find(a => a.startsWith('--runs='))?.slice(7) ?? 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error('runs must be between 1 and 5');
mkdirSync(output, { recursive: true });
const results = [];
for (let i = 1; i <= runs; i++) {
  const cast = resolve(output, `run-${i}.cast`); const report = resolve(output, `run-${i}.json`);
  const started = Date.now();
  writeFileSync(cast, JSON.stringify({ version: 2, width: 120, height: 32, timestamp: Math.floor(started / 1000), title: `Phantom backend rehearsal: ${live ? 'live Cerebras' : 'scripted Cerebras input'}, real Codex` }) + '\n');
  const args = [require.resolve('tsx/cli'), resolve(root, 'scripts/verify-materialize.ts'), '--fresh', `--report=${report}`, ...(live ? ['--live-cerebras'] : [])];
  console.log(`Rehearsal ${i}/${runs}: ${live ? 'live Cerebras' : 'scripted Cerebras input'} + real Codex`);
  await new Promise((done, fail) => {
    const child = spawn(process.execPath, args, { cwd: proxy, env: process.env, windowsHide: true });
    child.stdin.end();
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      const text = chunk.toString(); process.stdout.write(text);
      appendFileSync(cast, JSON.stringify([(Date.now() - started) / 1000, 'o', text.replace(/(?<!\r)\n/g, '\r\n')]) + '\n');
    });
    child.on('error', fail);
    child.on('close', code => code === 0 ? done() : fail(new Error(`Rehearsal ${i} failed (${code}); see ${cast}`)));
  });
  results.push(JSON.parse(readFileSync(report, 'utf8')));
}
writeFileSync(resolve(output, 'summary.json'), JSON.stringify({ kind: 'backend-only rehearsal', uiVerified: false, source: live ? 'live-cerebras' : 'scripted-cerebras-input', results }, null, 2));
console.log(`Saved ${runs} measured results and terminal recordings to ${output}`);
