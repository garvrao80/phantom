import assert from 'node:assert/strict';
const base = process.env.PHANTOM_BASE_URL ?? `http://localhost:${process.env.PHANTOM_PORT ?? 4000}`;
let count = 0;
async function request(path, body) {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const data = await response.json(); count++;
  assert(response.ok, `${path}: HTTP ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
await request('/phantom/reset', {});
const a = await request('/api/teams', { name: 'Byte Me', members: ['A', 'B'] });
const b = await request('/api/teams', { name: 'Null Pointers', members: ['C'] });
assert(a.id && b.id && a.id !== b.id);
const teams = await request('/api/teams');
assert(teams.some(t => t.id === a.id) && teams.some(t => t.id === b.id));
for (let i = 0; i < 2; i++) {
  assert.equal((await request(`/api/teams/${a.id}`)).name, 'Byte Me');
  assert.equal((await request(`/api/teams/${b.id}`)).name, 'Null Pointers');
}
const project = await request('/api/projects', { teamId: a.id, title: 'Phantom', pitch: 'backend before it exists' });
assert(project.id);
for (let i = 0; i < 3; i++) await request(`/api/projects/${project.id}/upvote`, {});
await request('/api/leaderboard');
const store = await request('/phantom/store');
assert.equal(store.collections.projects[project.id].votes, 3);
assert.equal(store.collections.teams[a.id].name, 'Byte Me');
console.log(`Smoke passed: ${count} requests; distinct team cache entries, persisted records, and 3 upvotes verified.`);
