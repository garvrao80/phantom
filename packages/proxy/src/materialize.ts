import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { PROXY_DIR, GENERATED_DIR, config } from './config.ts';
import { emit } from './events.ts';

type Recorded = { seq: number; routeKey: string; ok: boolean; [key: string]: unknown };
export type MaterializeDeps = {
  schemas: { all(): Record<string, unknown> };
  readRecordings: (options: { route: string; okOnly: boolean; limit: number }) => Recorded[];
  loadGenerated: (keys: string[]) => Promise<void>;
  setMode: (key: string, mode: 'REAL') => void;
};
type Command = { command: string; args: string[]; cwd: string; timeoutMs: number; onLine: (line: string) => void; input?: string };
export type Job = { jobId: string; routes: string[]; phase: string; error?: string; tests?: { passed: number; failed: number; total: number } };
type Options = { proxyDir: string; generatedDir: string; timeoutMs: number; codexArgs?: string[]; run: (c: Command) => Promise<void>; emit: (name: 'materialize', data: any) => void };

export function createMaterializer(options: Options) {
  let active: Job | undefined;
  let last: Job | undefined;
  function start(routes: string[], deps: MaterializeDeps, retryNote?: string): { jobId: string } {
    if (active) throw new Error('A materialize job is already running');
    if (!Array.isArray(routes) || routes.some(k => typeof k !== 'string')) throw new Error('routes must be an array of strings');
    const keys = [...new Set(routes)];
    const schemas = structuredClone(deps.schemas.all());
    if (!keys.length || keys.some(k => !Object.hasOwn(schemas, k))) throw new Error('Select at least one locked route');
    const recordings = keys.flatMap(route => deps.readRecordings({ route, okOnly: true, limit: 200 }).filter(r => r.ok && r.routeKey === route && r.mode !== 'REAL' && r.mode !== 'REPLAY').sort((a,b) => a.seq - b.seq).slice(-20));
    for (const key of keys) if (!recordings.some(r => r.routeKey === key)) throw new Error(`No successful recording for ${key}`);
    const job: Job = { jobId: `job_${randomUUID()}`, routes: keys, phase: 'context' };
    active = job; last = job;
    setTimeout(() => { void execute(job, deps, schemas, structuredClone(recordings), retryNote); }, 0);
    return { jobId: job.jobId };
  }
  async function execute(job: Job, deps: MaterializeDeps, schemas: Record<string, unknown>, recordings: Recorded[], retryNote?: string) {
    const phase = (name: string, extra: Record<string, unknown> = {}) => {
      job.phase = name;
      options.emit('materialize', { jobId: job.jobId, phase: name, ...extra });
    };
    try {
      phase('context');
      const ctx = resolve(options.generatedDir, '.context');
      mkdirSync(ctx, { recursive: true });
      mkdirSync(resolve(options.generatedDir, 'tests'), { recursive: true });
      const schemaFile = resolve(ctx, 'schemas.json');
      const traceFile = resolve(ctx, 'recordings.jsonl');
      writeFileSync(schemaFile, JSON.stringify(Object.fromEntries(job.routes.map(k => [k, schemas[k]])), null, 2));
      writeFileSync(traceFile, recordings.map(r => JSON.stringify(r)).join('\n') + '\n');
      writeFileSync(resolve(ctx, 'task.md'), taskMd(job.routes, retryNote));
      writeFileSync(resolve(ctx, 'api.md'), API_MD);
      // Generated code cannot silently rewrite the evidence or Phantom-owned gate.
      const protectedFiles = [schemaFile, traceFile, resolve(options.proxyDir, 'src/testing/replay.ts'), resolve(options.proxyDir, 'src/testing/contract.test.ts'), resolve(options.proxyDir, 'vitest.generated.config.ts')];
      const fingerprints = protectedFiles.map(file => digest(file));
      const assertEvidence = () => protectedFiles.forEach((file, i) => { if (digest(file) !== fingerprints[i]) throw new Error(`Verification input changed: ${file}`); });
      phase('codex');
      const codex = (input: string) => options.run({ command: 'codex', args: ['exec', '--sandbox', 'workspace-write', '-C', options.proxyDir, ...(options.codexArgs ?? []), '-'], input, cwd: options.proxyDir, timeoutMs: options.timeoutMs, onLine: line => phase('codex', { line }) });
      await codex(CODEX_PROMPT);
      // Codex occasionally ends its turn after describing a plan. Give it one nudge before failing the job.
      if (!existsSync(resolve(options.generatedDir, 'handlers.ts'))) {
        phase('codex', { line: 'Codex stopped before writing generated/handlers.ts. Asking it to finish the job…' });
        await codex(CODEX_NUDGE);
      }
      assertEvidence();
      phase('tests');
      const results = resolve(ctx, 'results.json');
      rmSync(results, { force: true });
      await options.run({ command: process.execPath, args: [resolve(createRequire(import.meta.url).resolve('vitest/package.json'), '..', 'vitest.mjs'), 'run', '--config', 'vitest.generated.config.ts', '--reporter=json', `--outputFile=${results}`], cwd: options.proxyDir, timeoutMs: 120000, onLine: line => phase('tests', { line }) });
      assertEvidence();
      const report = JSON.parse(readFileSync(results, 'utf8'));
      const tests = { passed: report.numPassedTests, failed: report.numFailedTests, total: report.numTotalTests };
      job.tests = tests;
      const expectedNames = recordings.map(r => `replays #${r.seq} ${r.routeKey}`);
      const gateResults = (report.testResults ?? []).filter((suite: any) => /src[\\/]testing[\\/]contract\.test\.ts$/.test(suite.name ?? '')).flatMap((s: any) => s.assertionResults ?? []);
      if (report.success !== true || !Number.isInteger(tests.total) || tests.total < recordings.length + 1 || tests.failed !== 0 || tests.passed !== tests.total || !expectedNames.every(name => gateResults.some((a: any) => a.title === name && a.status === 'passed'))) throw new Error('Independent replay gate did not fully pass');
      phase('activate', { tests });
      await deps.loadGenerated(job.routes);
      for (const key of job.routes) deps.setMode(key, 'REAL');
      phase('done', { tests, verifiedRecordings: recordings.length });
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error);
      phase('failed', { line: job.error, tests: job.tests });
    } finally { active = undefined; }
  }
  return { start, isRunning: () => !!active, getLastJob: () => last ? structuredClone(last) : undefined,
    retry: (deps: MaterializeDeps) => { if (!last || last.phase !== 'failed') throw new Error('No failed job to retry'); return start(last.routes, deps, last.error); } };
}
const CODEX_PROMPT = 'Read generated/.context/task.md and complete the task now. Do not stop to describe a plan or ask for confirmation: write generated/handlers.ts and the tests, run them, and finish only when they pass.\n';
const CODEX_NUDGE = 'You stopped before writing generated/handlers.ts. Do the task in generated/.context/task.md now: write generated/handlers.ts and generated/tests, run the tests, and finish only when they pass. Do not ask for confirmation.\n';
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const API_MD = `HandlerCtx: { params: Record<string,string>; query: Record<string,string>; body: unknown; store: Store }
Handler: (ctx: HandlerCtx) => Promise<{status:number;body:unknown}>
Store: get(collection,id), list(collection), reserveId(collection):string, applyOps(ops):void, dump()
StoreOp: {op:'insert',collection,id,record} | {op:'update',collection,id,patch} | {op:'delete',collection,id}
Read actual src/store.ts and src/types.ts for exact signatures.
`;
function taskMd(routes: string[], retryNote?: string): string {
  return `# Materialize recorded routes
Implement generated/handlers.ts exporting handlers: Record<string, Handler>.
Routes: ${JSON.stringify(routes)}
Read .context/schemas.json, recordings.jsonl and api.md under generated/. Import Handler from ../src/realHandlers.ts. Use ctx.store.reserveId/applyOps. Match status, response, AND store mutations. Preserve schema. Handle missing records and invalid input. No dependencies. Edit only generated/handlers.ts and generated/tests/*.test.ts; do not modify .context or Phantom-owned files. Keep handlers self-contained in handlers.ts, with no runtime imports from generated helpers. Preserve previously generated routes. Add generated tests using ../../src/testing/replay.ts. Phantom's independent gate runs every selected recording and checks mutations. Do not drop inconsistent recordings; report contradictions as a failure.
${retryNote ? `Previous failure: ${retryNote}` : ''}
`;
}
// Quote only controlled arguments for Windows .cmd shims; reject shell metacharacters.
const winQuote = (s: string) => { if (/["%&|<>^!\r\n]/.test(s)) throw new Error('Unsafe Windows command argument'); return `"${s}"`; };
export function runCommand(c: Command): Promise<void> {
  return new Promise((done, fail) => {
    const windows = process.platform === 'win32';
    const child = windows && !c.command.toLowerCase().endsWith('.exe') ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${[c.command, ...c.args].map(winQuote).join(' ')}"`], { cwd: c.cwd, env: process.env, windowsHide: true, windowsVerbatimArguments: true }) : spawn(c.command, c.args, { cwd: c.cwd, env: process.env });
    let settled = false;
    let outputTail = '';
    const finish = (err?: Error) => { if (settled) return; settled = true; clearTimeout(timer); err ? fail(err) : done(); };
    const timer = setTimeout(() => {
      if (windows && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGKILL');
      finish(new Error(`${c.command} timed out`));
    }, c.timeoutMs);
    for (const stream of [child.stdout, child.stderr]) {
      let pending = ''; stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => { outputTail = (outputTail + chunk).slice(-5000); pending += chunk; const lines = pending.split(/\r?\n/); pending = lines.pop() ?? ''; for (const line of lines) c.onLine(line); });
      stream.on('end', () => { if (pending) c.onLine(pending); });
    }
    child.stdin.on('error', () => {}); child.stdin.end(c.input ?? '');
    child.on('error', error => finish(error));
    child.on('close', code => finish(code === 0 ? undefined : new Error(`${c.command} exited ${code}: ${outputTail}`)));
  });
}
const codexArgs = [
  ...(config.codexModel ? ['-m', config.codexModel] : []),
  ...(config.codexReasoningEffort ? ['-c', `model_reasoning_effort=${config.codexReasoningEffort}`] : []),
];
const controller = createMaterializer({ proxyDir: PROXY_DIR, generatedDir: GENERATED_DIR, timeoutMs: config.codexTimeoutMs, codexArgs, run: runCommand, emit });
export const materialize = controller.start;
export const retryMaterialize = controller.retry;
export const isMaterializing = controller.isRunning;
export const getMaterializeJob = controller.getLastJob;
