import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';
import { fakeClient } from '../src/model.ts';

export const tempDir = () => mkdtempSync(join(tmpdir(), 'phantom-test-'));

export async function testApp(answers: (string | object | Error)[] = []) {
  const dir = tempDir();
  const generatedDir = join(dir, 'generated');
  mkdirSync(generatedDir);
  const model = fakeClient(answers);
  const { app, ctx } = await createApp({ dataDir: join(dir, 'data'), generatedDir, model, modelName: 'fake' });
  return { app, ctx, model, dir, generatedDir };
}

export const ok = (status: number, body: unknown, storeOps: unknown[] = []) => ({ status, body, storeOps });
