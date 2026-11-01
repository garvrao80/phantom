import { describe, expect, it } from 'vitest';
import { readContext, expectReplay } from './replay.ts';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { GENERATED_DIR } from '../config.ts';
const { handlers } = await import(pathToFileURL(resolve(GENERATED_DIR, 'handlers.ts')).href);
const { recordings } = readContext();
describe('recorded contracts (owned by Phantom)', () => {
  it('has recorded interactions to verify', () => expect(recordings.length).toBeGreaterThan(0));
  for (const rec of recordings) it(`replays #${rec.seq} ${rec.routeKey}`, () => expectReplay(handlers, rec));
});
