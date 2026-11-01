import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createMaterializer, runCommand } from '../packages/proxy/src/materialize.ts';

async function scenario(mode = 'pass') {
  const root = mkdtempSync(resolve(tmpdir(), 'phantom-gate-'));
  const generated = resolve(root, 'generated');
  mkdirSync(resolve(root, 'src/testing'), { recursive: true });
  for (const name of ['src/testing/replay.ts', 'src/testing/contract.test.ts', 'vitest.generated.config.ts']) writeFileSync(resolve(root, name), 'owned');
  const events: any[] = [];
  const load = vi.fn(async () => {}); const setMode = vi.fn();
  const deps = { schemas: { all: () => ({ 'POST /teams': { response: {} } }) }, readRecordings: () => [{ seq: 1, routeKey: 'POST /teams', ok: true }], loadGenerated: load, setMode };
  let calls = 0;
  const run = vi.fn(async () => {
    calls++;
    if (calls === 1) {
      if (mode === 'generation-fails') throw new Error('generation failed');
      if (mode === 'tamper') writeFileSync(resolve(generated, '.context/recordings.jsonl'), 'changed');
    } else {
      if (mode === 'tests-fail') throw new Error('test runner failed');
      const report = { success: true, numPassedTests: 2, numFailedTests: 0, numTotalTests: 2,
        testResults: [{ name: resolve(root, 'src/testing/contract.test.ts'), assertionResults: [{ title: 'replays #1 POST /teams', status: mode === 'skipped' ? 'pending' : 'passed' }] }] };
      if (mode === 'no-coverage') report.testResults = [];
      writeFileSync(resolve(generated, '.context/results.json'), JSON.stringify(report));
    }
  });
  const controller = createMaterializer({ proxyDir: root, generatedDir: generated, timeoutMs: 100, run, emit: (_, event) => events.push(event) });
  try {
    expect(() => controller.start([], deps)).toThrow();
    expect(() => controller.start(['GET /unknown'], deps)).toThrow();
    const accepted = controller.start(['POST /teams'], deps);
    expect(controller.isRunning()).toBe(true);
    expect(() => controller.start(['POST /teams'], deps)).toThrow(/already running/);
    await vi.waitFor(() => expect(controller.isRunning()).toBe(false));
    expect(events.every(e => e.jobId === accepted.jobId)).toBe(true);
    return { job: controller.getLastJob(), load, setMode, run };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
describe('materialize activation gate', () => {
  it('activates only after independent coverage passes', async () => {
    const r = await scenario(); expect(r.job?.phase).toBe('done'); expect(r.load).toHaveBeenCalledOnce(); expect(r.setMode).toHaveBeenCalledWith('POST /teams', 'REAL');
  });
  for (const mode of ['generation-fails', 'tamper', 'tests-fail', 'no-coverage', 'skipped']) it(`retains existing handlers on ${mode}`, async () => {
    const r = await scenario(mode); expect(r.job?.phase).toBe('failed'); expect(r.load).not.toHaveBeenCalled(); expect(r.setMode).not.toHaveBeenCalled();
  });
  it('runs local child commands without approval prompts', async () => {
    const lines: string[] = [];
    await runCommand({ command: 'node', args: ['--version'], cwd: process.cwd(), timeoutMs: 3000, onLine: line => lines.push(line) });
    expect(lines.join('')).toMatch(/v\d+/);
  });
  it('rejects failed child commands', async () => {
    await expect(runCommand({ command: 'node', args: ['--not-a-real-flag'], cwd: process.cwd(), timeoutMs: 3000, onLine: () => {} })).rejects.toThrow();
  });
});
