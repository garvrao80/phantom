import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Store, singular } from '../src/store.ts';
import type { StoreOp } from '../src/types.ts';
import { tempDir } from './helpers.ts';

const team = (id: string, name = 'A'): StoreOp => ({ op: 'insert', collection: 'teams', id, record: { id, name } });

describe('Store', () => {
  it('inserts, updates and deletes', () => {
    const s = Store.load(join(tempDir(), 'store.json'));
    s.applyOps([team('team_1')]);
    s.applyOps([{ op: 'update', collection: 'teams', id: 'team_1', patch: { name: 'B' } }]);
    expect(s.get('teams', 'team_1')).toEqual({ id: 'team_1', name: 'B' });
    s.applyOps([{ op: 'delete', collection: 'teams', id: 'team_1' }]);
    expect(s.list('teams')).toEqual([]);
  });

  it('rejects bad ops', () => {
    const s = Store.load(join(tempDir(), 'store.json'));
    s.applyOps([team('team_1')]);
    expect(s.dryRun([team('team_1')])).toMatchObject({ ok: false });
    expect(s.dryRun([{ op: 'update', collection: 'teams', id: 'nope', patch: {} }])).toMatchObject({ ok: false });
    expect(s.dryRun([{ op: 'delete', collection: 'teams', id: 'nope' }])).toMatchObject({ ok: false });
    expect(s.dryRun([{ op: 'insert', collection: 'teams', id: 'team_2', record: { id: 'other' } }])).toMatchObject({ ok: false });
    expect(s.dryRun([{ op: 'insert', collection: 'Bad-Name', id: 'x_1', record: { id: 'x_1' } }])).toMatchObject({ ok: false });
  });

  it('is all-or-nothing', () => {
    const s = Store.load(join(tempDir(), 'store.json'));
    const before = s.dump();
    expect(() => s.applyOps([team('team_1'), { op: 'delete', collection: 'teams', id: 'missing' }])).toThrow();
    expect(s.dump()).toEqual(before);
  });

  it('bumps version only when there are ops', () => {
    const s = Store.load(join(tempDir(), 'store.json'));
    s.applyOps([]);
    expect(s.version).toBe(0);
    s.applyOps([team('team_1')]);
    expect(s.version).toBe(1);
  });

  it('hands out sequential ids', () => {
    const s = Store.load(join(tempDir(), 'store.json'));
    expect(s.peekId('teams')).toBe('team_1');
    expect(s.peekId('teams')).toBe('team_1');
    s.applyOps([team('team_1')]);
    expect(s.peekId('teams')).toBe('team_2');
    expect(s.peekId('categories')).toBe('category_1');
  });

  it('singularises naively', () => {
    expect(singular('teams')).toBe('team');
    expect(singular('categories')).toBe('category');
    expect(singular('data')).toBe('data');
  });

  it('caps snapshots and includes nextId', () => {
    const s = Store.load(join(tempDir(), 'store.json'));
    s.applyOps([team('team_1'), team('team_2'), team('team_3')]);
    const snap = s.snapshot(['teams'], 2);
    expect(Object.keys(snap.collections.teams)).toEqual(['team_2', 'team_3']);
    expect(snap.nextId.teams).toBe(4);
  });

  it('persists to disk, but fromData never writes', () => {
    const dir = tempDir();
    const file = join(dir, 'store.json');
    const s = Store.load(file);
    s.applyOps([team('team_1')]);
    expect(Store.load(file).get('teams', 'team_1')).toBeTruthy();
    const mem = Store.fromData(s.dump());
    mem.applyOps([team('team_2')]);
    expect(Store.load(file).get('teams', 'team_2')).toBeUndefined();
    expect(existsSync(join(dir, 'store.json.tmp'))).toBe(false);
  });
});
