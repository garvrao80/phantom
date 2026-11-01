import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { SchemaRegistry } from '../src/schemas.ts';
import { parseAnswer, checkAnswer, type Answer } from '../src/validate.ts';
import { tempDir } from './helpers.ts';

function setup() {
  const dir = tempDir();
  const store = Store.load(join(dir, 'store.json'));
  store.applyOps([{ op: 'insert', collection: 'teams', id: 'team_1', record: { id: 'team_1', name: 'A' } }]);
  const schemas = new SchemaRegistry(join(dir, 'schemas.json'));
  return { store, schemas };
}
const post = { method: 'POST', routeKey: 'POST /teams', reserved: { teams: 'team_2' } };
const get = { method: 'GET', routeKey: 'GET /teams', reserved: {} };
const a = (x: Partial<Answer>): Answer => ({ status: 200, body: {}, storeOps: [], ...x });

describe('parseAnswer', () => {
  it('accepts plain JSON and fenced JSON', () => {
    expect(parseAnswer('{"status":200,"body":[],"storeOps":[]}').status).toBe(200);
    expect(parseAnswer('```json\n{"status":200,"body":[],"storeOps":[]}\n```').status).toBe(200);
  });
  it('rejects wrong keys and non-JSON', () => {
    expect(() => parseAnswer('{"status":200,"body":[]}')).toThrow(/exactly/);
    expect(() => parseAnswer('{"status":200,"body":[],"storeOps":[],"x":1}')).toThrow(/exactly/);
    expect(() => parseAnswer('sure! here you go')).toThrow();
  });
});

describe('checkAnswer', () => {
  it('accepts a valid insert', () => {
    const { store, schemas } = setup();
    const ans = a({ status: 201, body: { id: 'team_2' }, storeOps: [{ op: 'insert', collection: 'teams', id: 'team_2', record: { id: 'team_2' } }] });
    expect(checkAnswer(ans, post, store, schemas)).toBeNull();
  });
  it('rejects an out-of-range status', () => {
    const { store, schemas } = setup();
    expect(checkAnswer(a({ status: 99 }), get, store, schemas)).toMatch(/invalid status/);
    expect(checkAnswer(a({ status: 200.5 }), get, store, schemas)).toMatch(/invalid status/);
  });
  it('rejects reads that write', () => {
    const { store, schemas } = setup();
    const ans = a({ storeOps: [{ op: 'delete', collection: 'teams', id: 'team_1' }] });
    expect(checkAnswer(ans, get, store, schemas)).toMatch(/must not change data/);
  });
  it('rejects inserts with an unreserved id', () => {
    const { store, schemas } = setup();
    const ans = a({ status: 201, storeOps: [{ op: 'insert', collection: 'teams', id: 'team_9', record: { id: 'team_9' } }] });
    expect(checkAnswer(ans, post, store, schemas)).toMatch(/reserved id team_2/);
  });
  it('rejects updates to missing records', () => {
    const { store, schemas } = setup();
    const ans = a({ storeOps: [{ op: 'update', collection: 'teams', id: 'team_7', patch: { name: 'x' } }] });
    expect(checkAnswer(ans, post, store, schemas)).toMatch(/not found/);
  });
  it('rejects bad collection names', () => {
    const { store, schemas } = setup();
    const ans = a({ storeOps: [{ op: 'insert', collection: 'Teams!', id: 'team_2', record: { id: 'team_2' } }] });
    expect(checkAnswer(ans, { ...post, reserved: { 'Teams!': 'team_2' } }, store, schemas)).toMatch(/bad collection/);
  });
  it('rejects bodies that break the locked schema', () => {
    const { store, schemas } = setup();
    schemas.observe('GET /teams', 200, [{ id: 'team_1', name: 'A' }]);
    expect(checkAnswer(a({ body: [{ id: 'team_1', title: 'A' }] }), get, store, schemas)).toMatch(/locked schema/);
  });
  it('requires {error} on error responses', () => {
    const { store, schemas } = setup();
    expect(checkAnswer(a({ status: 404, body: { message: 'x' } }), get, store, schemas)).toMatch(/error/);
    expect(checkAnswer(a({ status: 404, body: { error: 'not found' } }), get, store, schemas)).toBeNull();
  });
});
