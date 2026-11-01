// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../proxy/src/app';
import { fakeClient } from '../../proxy/src/model';
import { api } from '../../demo-app/src/api';
import { control } from '../src/api';
import type { Health, Recording, Route } from '../src/types';

it('connects both frontend clients to the actual proxy over HTTP, including recording, replay and reset', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'phantom-frontend-'));
  const team = { id: 'team_1', name: 'Frontend integration', members: ['Lakshay'] };
  const model = fakeClient([
    { status: 201, body: team, storeOps: [{ op: 'insert', collection: 'teams', id: team.id, record: team }] },
    { status: 200, body: [team], storeOps: [] },
  ]);
  const { app } = await createApp({ dataDir: join(directory, 'data'), generatedDir: join(directory, 'generated'), model, modelName: 'test-model' });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => nativeFetch(new URL(input, address), init));
  try {
    expect(await api('POST', '/teams', { name: team.name, members: team.members })).toEqual(team);
    expect(await api('GET', '/teams')).toEqual([team]);
    const routes = await control<Route[]>('/routes');
    expect(routes.find(route => route.key === 'POST /teams')).toMatchObject({ locked: true, calls: 1 });
    const recordings = await control<Recording[]>('/recordings?limit=200');
    expect(recordings.map(rec => rec.req.method)).toEqual(['POST', 'GET']);
    expect(recordings[0].storeOps).toHaveLength(1);
    expect(await control('/replay', { on: true })).toEqual({ replay: true });
    expect((await control<Health>('/health')).replay).toBe(true);
    expect(await api('GET', '/teams')).toEqual([team]);
    expect(model.calls).toHaveLength(2);
    expect((await control<Recording[]>('/recordings')).at(-1)?.mode).toBe('REPLAY');
    await control('/reset', {});
    expect(await control('/routes')).toEqual([]);
    expect(await control('/recordings')).toEqual([]);
    await control('/replay', { on: false });
    // Exhausted injected client follows the real proxy's retry/502 path.
    await expect(api('GET', '/teams')).rejects.toMatchObject({ status: 502 });
    expect((await control<Recording[]>('/recordings')).at(-1)?.ok).toBe(false);
  } finally {
    vi.unstubAllGlobals();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
