import type { StoreOp } from './types.ts';
import type { Store } from './store.ts';
import type { SchemaRegistry } from './schemas.ts';
import { isRead } from './router.ts';

export type Answer = { status: number; body: unknown; storeOps: StoreOp[] };

export function parseAnswer(text: string): Answer {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = JSON.parse(cleaned);
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('answer must be a JSON object');
  const keys = Object.keys(a).sort().join(',');
  if (keys !== 'body,status,storeOps') throw new Error(`answer must have exactly status, body, storeOps (got ${keys || 'none'})`);
  return a as Answer;
}

export type CheckCtx = { method: string; routeKey: string; reserved: Record<string, string> };

/** Rules from AGENTS.md 7.2. Returns the first problem, or null when the answer is acceptable. */
export function checkAnswer(a: Answer, ctx: CheckCtx, store: Store, schemas: SchemaRegistry): string | null {
  if (!Number.isInteger(a.status) || a.status < 100 || a.status > 599) return `invalid status ${JSON.stringify(a.status)}`;
  if (!Array.isArray(a.storeOps)) return 'storeOps must be an array';
  if (isRead(ctx.method) && a.storeOps.length) return `${ctx.method} must not change data (storeOps must be [])`;
  for (const op of a.storeOps)
    if (op?.op === 'insert' && ctx.reserved[op.collection] !== op.id)
      return `insert into ${op.collection} must use reserved id ${ctx.reserved[op.collection] ?? '(none reserved)'}`;
  const dry = store.dryRun(a.storeOps);
  if (!dry.ok) return dry.reason;
  if (a.status >= 400) {
    const b = a.body as { error?: unknown } | null;
    if (!b || typeof b !== 'object' || typeof b.error !== 'string') return 'error responses must have body {"error": string}';
    if (a.storeOps.length) return 'error responses must not change data';
    return null;
  }
  if (a.status >= 200 && a.status < 300) {
    const errs = schemas.validate(ctx.routeKey, a.status, a.body);
    if (errs.length) return `body does not match locked schema: ${errs.slice(0, 3).join('; ')}`;
  }
  return null;
}
