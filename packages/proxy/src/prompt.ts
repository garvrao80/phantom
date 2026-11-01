import type { ChatMessage } from './model.ts';
import type { ApiRequest, StoreData } from './types.ts';
import type { Locked } from './schemas.ts';

export const SYSTEM_PROMPT = `You are the backend server for a web application. You receive exactly one HTTP request
and must respond as a consistent, conventional JSON REST API would.

Respond with a single JSON object and nothing else:
{"status": <int>, "body": <json>, "storeOps": [<op>...]}

Rules:
- The STORE below is the only source of truth. Never invent records that are not in the
  store unless this request creates them.
- GET/HEAD/OPTIONS requests must have "storeOps": [].
- To create a record, use one of the RESERVED IDS for its collection, and include an
  "insert" op whose record exactly matches what you return.
- To change a record, use "update" with only the changed fields in "patch".
- If a RESPONSE SCHEMA is given, a 2xx body MUST match it exactly: same fields, same types,
  no extra fields.
- If the request refers to a record that does not exist, return 404 {"error": "..."}.
- If the request is malformed, return 400 {"error": "..."}.
- Use camelCase field names. Timestamps are ISO 8601 strings. Lists are JSON arrays.
- Derived endpoints (e.g. /leaderboard, /stats) are computed from the store and are reads.

Store op formats:
{"op":"insert","collection":"<name>","id":"<reserved id>","record":{...,"id":"<reserved id>"}}
{"op":"update","collection":"<name>","id":"<existing id>","patch":{...}}
{"op":"delete","collection":"<name>","id":"<existing id>"}`;

export type PromptCtx = {
  req: ApiRequest;
  locked?: Locked;
  related: Record<string, Locked>;
  reserved: Record<string, string>;
  collections: string[];
  snapshot: StoreData;
};

const json = (v: unknown) => JSON.stringify(v ?? null);

/** Strip the internal unknown-marker so the model sees a plain schema. */
const cleanSchema = (s: unknown) => JSON.parse(JSON.stringify(s), (k, v) => (k === 'x-unknown' ? undefined : v));

export function buildUserPrompt(ctx: PromptCtx) {
  const { req, locked, related, reserved, collections, snapshot } = ctx;
  const relatedLines = Object.entries(related).map(([k, l]) => `${k} (status ${l.status}): ${json(cleanSchema(l.response))}`);
  return [
    'REQUEST',
    `${req.method} ${req.path}`,
    `params: ${json(req.params)}`,
    `query: ${json(req.query)}`,
    `body: ${json(req.body)}`,
    '',
    `ROUTE: ${req.routeKey}`,
    `RESPONSE SCHEMA: ${locked ? json(cleanSchema(locked.response)) : 'none yet — choose a sensible, conventional REST shape'}`,
    `EXPECTED STATUS: ${locked ? locked.status : 'choose'}`,
    ...(relatedLines.length
      ? ['RELATED ROUTE SCHEMAS (records of the same resource must use the same fields):', ...relatedLines]
      : []),
    `RESERVED IDS: ${Object.keys(reserved).length ? json(reserved) : 'none (read request)'}`,
    `COLLECTIONS IN STORE: ${collections.length ? collections.join(', ') : '(none yet)'}`,
    'STORE:',
    json(snapshot.collections),
  ].join('\n');
}

export function buildMessages(ctx: PromptCtx, retryReason?: string, lastAnswer?: string): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(ctx) },
  ];
  if (retryReason) {
    if (lastAnswer) messages.push({ role: 'assistant', content: lastAnswer });
    messages.push({ role: 'user', content: `Your previous answer was rejected: ${retryReason}. Return a corrected answer.` });
  }
  return messages;
}
