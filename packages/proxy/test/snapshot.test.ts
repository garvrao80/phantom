import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { candidateCollections } from '../src/snapshot.ts';
import { tempDir } from './helpers.ts';

function storeWith(...cols: string[]) {
  const s = Store.load(join(tempDir(), 'store.json'));
  s.applyOps(cols.map((c, i) => ({ op: 'insert', collection: c, id: `x_${i + 1}`, record: { id: `x_${i + 1}` } })));
  return s;
}

describe('candidateCollections', () => {
  it('reserves a new plural collection on first create', () => {
    expect(candidateCollections(storeWith(), '/teams', { name: 'A' }).create).toEqual(['teams']);
  });

  it('does not turn action segments into collections', () => {
    const r = candidateCollections(storeWith('projects'), '/projects/project_1/upvote', null);
    expect(r.create).toEqual(['projects']);
  });

  it('adds nested plural collections and foreign keys', () => {
    const s = storeWith('teams');
    expect(candidateCollections(s, '/teams/team_1/projects', {}).create.sort()).toEqual(['projects', 'teams']);
    expect(candidateCollections(s, '/projects', { teamId: 'team_1' }).create.sort()).toEqual(['projects', 'teams']);
  });

  it('matches singular path segments to existing collections', () => {
    expect(candidateCollections(storeWith('teams'), '/team', {}).create).toEqual(['teams']);
  });

  it('sends the whole store while it is small', () => {
    expect(candidateCollections(storeWith('teams', 'projects'), '/leaderboard', null).send.sort()).toEqual(['projects', 'teams']);
  });
});
