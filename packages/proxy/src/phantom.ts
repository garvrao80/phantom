import type { ApiRequest, ApiResponse, Recording } from './types.ts';
import type { Store } from './store.ts';
import type { Locked, SchemaRegistry } from './schemas.ts';
import type { ModelClient } from './model.ts';
import { buildMessages } from './prompt.ts';
import { candidateCollections } from './snapshot.ts';
import { parseAnswer, checkAnswer, type Answer } from './validate.ts';
import { isRead } from './router.ts';

export type PhantomDeps = { store: Store; schemas: SchemaRegistry; model: ModelClient; snapshotLimit: number };
export type PhantomResult = { res: ApiResponse; rec: Omit<Recording, 'seq' | 'ts'> };

const MAX_ATTEMPTS = 2;
const MAX_RELATED = 3;

/** Locked schemas of other routes on the same resource, e.g. POST /teams when serving GET /teams. */
function relatedSchemas(schemas: SchemaRegistry, routeKey: string): Record<string, Locked> {
  const resource = (key: string) => key.split(' ')[1]?.split('/')[1];
  const mine = resource(routeKey);
  return Object.fromEntries(
    Object.entries(schemas.all())
      .filter(([k]) => k !== routeKey && resource(k) === mine)
      .slice(0, MAX_RELATED),
  );
}

export async function runPhantom(req: ApiRequest, deps: PhantomDeps): Promise<PhantomResult> {
  const { store, schemas, model, snapshotLimit } = deps;
  const t0 = Date.now();
  const { send, create } = candidateCollections(store, req.path, req.body);
  const reserved: Record<string, string> = isRead(req.method)
    ? {}
    : Object.fromEntries(create.map((c) => [c, store.peekId(c)]));
  const storeBefore = store.snapshot([...new Set([...send, ...create])], snapshotLimit);
  const ctx = {
    req,
    locked: schemas.get(req.routeKey),
    related: relatedSchemas(schemas, req.routeKey),
    reserved,
    collections: store.collections(),
    snapshot: storeBefore,
  };

  let retryReason: string | undefined;
  let lastText = '';
  let attempts = 0;
  const tokens = { in: 0, out: 0 };
  let answer: Answer | undefined;
  while (attempts < MAX_ATTEMPTS && !answer) {
    attempts++;
    try {
      const r = await model.complete(buildMessages(ctx, retryReason, lastText));
      tokens.in += r.tokensIn;
      tokens.out += r.tokensOut;
      lastText = r.text;
      const a = parseAnswer(r.text);
      const problem = checkAnswer(a, { method: req.method, routeKey: req.routeKey, reserved }, store, schemas);
      if (problem) retryReason = problem;
      else answer = a;
    } catch (e) {
      retryReason = `invalid answer: ${(e as Error).message}`;
    }
  }

  const base = {
    routeKey: req.routeKey,
    req: { method: req.method, path: req.path, params: req.params, query: req.query, body: req.body },
    storeBefore,
    tokens,
    retries: attempts - 1,
  };

  if (!answer) {
    const res = { status: 502, body: { error: 'phantom_invalid', detail: retryReason } };
    return {
      res,
      rec: { ...base, mode: 'ERROR', ok: false, res, storeOps: [], latencyMs: Date.now() - t0, error: retryReason },
    };
  }

  store.applyOps(answer.storeOps);
  if (answer.status >= 200 && answer.status < 300) schemas.observe(req.routeKey, answer.status, answer.body);
  const res = { status: answer.status, body: answer.body };
  return { res, rec: { ...base, mode: 'PHANTOM', ok: true, res, storeOps: answer.storeOps, latencyMs: Date.now() - t0 } };
}
