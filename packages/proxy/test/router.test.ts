import { describe, it, expect } from 'vitest';
import { normalisePath, routeKey, isRead } from '../src/router.ts';

describe('normalisePath', () => {
  it.each([
    ['/api/teams', '/teams', {}],
    ['/api/teams/', '/teams', {}],
    ['/api/teams/42', '/teams/:id', { id: '42' }],
    ['/api/teams/team_3/projects', '/teams/:id/projects', { id: 'team_3' }],
    ['/api/teams/team_3/members/user_9', '/teams/:id/members/:id2', { id: 'team_3', id2: 'user_9' }],
    ['/api/team_members', '/team_members', {}],
    ['/api/leaderboard_weekly', '/leaderboard_weekly', {}],
    ['/api/leaderboard?x=1', '/leaderboard', {}],
    ['/api/items/3f2b8c1e-9d4a-4b7e-8f6a-1c2d3e4f5a6b', '/items/:id', { id: '3f2b8c1e-9d4a-4b7e-8f6a-1c2d3e4f5a6b' }],
    ['/api', '/', {}],
  ])('%s → %s', (input, pattern, params) => {
    const r = normalisePath(input);
    expect(r.pattern).toBe(pattern);
    expect(r.params).toEqual(params);
  });

  it('builds route keys and detects reads', () => {
    expect(routeKey('post', '/teams')).toBe('POST /teams');
    expect(isRead('GET')).toBe(true);
    expect(isRead('POST')).toBe(false);
  });
});
