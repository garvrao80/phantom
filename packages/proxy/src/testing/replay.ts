import Ajv from 'ajv';
import { expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../store.ts';
import type { Handler } from '../realHandlers.ts';
import type { Recording } from '../types.ts';
import { GENERATED_DIR } from '../config.ts';

const context = resolve(GENERATED_DIR, '.context');
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
export function stripVolatile(value: unknown): unknown {
  if (typeof value === 'string' && iso.test(value)) return '<timestamp>';
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripVolatile(v)]));
  return value;
}
export function readContext(): { recordings: Recording[]; schemas: Record<string, any> } {
  const recordings = readFileSync(resolve(context, 'recordings.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Recording);
  const schemas = JSON.parse(readFileSync(resolve(context, 'schemas.json'), 'utf8'));
  return { recordings, schemas };
}
export async function expectReplay(handlers: Record<string, Handler>, rec: Recording): Promise<void> {
  const handler = handlers[rec.routeKey];
  expect(handler, `handler for ${rec.routeKey}`).toBeTypeOf('function');
  const store = Store.fromData(rec.storeBefore);
  const result = await handler({ params: rec.req.params, query: rec.req.query, body: rec.req.body, store });
  expect(result.status).toBe(rec.res.status);
  const locked = readContext().schemas[rec.routeKey];
  if (locked && result.status >= 200 && result.status < 300) expect(new Ajv({ strict: false }).validate(locked.response, result.body)).toBe(true);
  expect(stripVolatile(result.body)).toEqual(stripVolatile(rec.res.body));
  // Verify mutations independently of what the generated handler returns.
  const expectedStore = Store.fromData(rec.storeBefore);
  expectedStore.applyOps(rec.storeOps ?? []);
  expect(stripVolatile(store.dump())).toEqual(stripVolatile(expectedStore.dump()));
}
