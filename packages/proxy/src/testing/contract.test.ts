import { describe, expect, it } from 'vitest';
import { readContext, expectReplay } from './replay.ts';
import { handlers } from '../../generated/handlers.ts';
const { recordings } = readContext();
describe('recorded contracts (owned by Phantom)', () => {
  it('has recorded interactions to verify', () => expect(recordings.length).toBeGreaterThan(0));
  for (const rec of recordings) it(`replays #${rec.seq} ${rec.routeKey}`, () => expectReplay(handlers, rec));
});
