import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { SchemaRegistry } from '../src/schemas.ts';
import { tempDir } from './helpers.ts';

const reg = () => new SchemaRegistry(join(tempDir(), 'schemas.json'));
const K = 'POST /teams';

describe('SchemaRegistry', () => {
  it('locks all keys as required with no extras', () => {
    const r = reg();
    r.observe(K, 201, { id: 'team_1', name: 'A' });
    expect(r.validate(K, 201, { id: 'team_2', name: 'B' })).toEqual([]);
    expect(r.validate(K, 201, { id: 'team_2' })).not.toEqual([]);
    expect(r.validate(K, 201, { id: 'team_2', name: 'B', extra: 1 })).not.toEqual([]);
  });

  it('rejects type changes and a different status', () => {
    const r = reg();
    r.observe(K, 201, { id: 'team_1', votes: 1 });
    expect(r.validate(K, 201, { id: 'team_1', votes: '1' })).not.toEqual([]);
    expect(r.validate(K, 201, { id: 'team_1', votes: 1.5 })).toEqual([]);
    expect(r.validate(K, 200, { id: 'team_1', votes: 1 })[0]).toMatch(/expected status 201/);
  });

  it('does not lock on an empty list, then locks the item shape', () => {
    const r = reg();
    r.observe('GET /teams', 200, []);
    expect(r.get('GET /teams')).toBeUndefined();
    r.observe('GET /teams', 200, [{ id: 'team_1', name: 'A' }]);
    expect(r.validate('GET /teams', 200, [{ id: 'team_2', name: 'B' }])).toEqual([]);
    expect(r.validate('GET /teams', 200, [{ id: 'team_2' }])).not.toEqual([]);
  });

  it('refines unknown nodes once', () => {
    const r = reg();
    r.observe(K, 201, { id: 'team_1', lead: null, members: [] });
    expect(r.validate(K, 201, { id: 'team_1', lead: 'x', members: ['a'] })).toEqual([]);
    r.observe(K, 201, { id: 'team_2', lead: 'Priya', members: ['a'] });
    expect(r.validate(K, 201, { id: 'team_3', lead: 5, members: ['a'] })).not.toEqual([]);
    expect(r.validate(K, 201, { id: 'team_3', lead: 'x', members: [1] })).not.toEqual([]);
  });

  it('skips validation for unlocked routes and persists locks', () => {
    const dir = tempDir();
    const r = new SchemaRegistry(join(dir, 'schemas.json'));
    expect(r.validate('GET /x', 200, 'anything')).toEqual([]);
    r.observe(K, 201, { id: 'team_1' });
    expect(new SchemaRegistry(join(dir, 'schemas.json')).get(K)?.status).toBe(201);
  });
});
