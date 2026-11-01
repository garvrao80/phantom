import { COLLECTION_RE, singular, type Store } from './store.ts';
import { isIdSegment } from './router.ts';

const SEND_ALL_BELOW_BYTES = 8_000;

/**
 * `send`: collections whose records go into the prompt.
 * `create`: collections that get a reserved id on a write (may include a new collection).
 */
export function candidateCollections(store: Store, path: string, body: unknown) {
  const existing = store.collections();
  const segs = path.split('/').filter((s) => s && !isIdSegment(s));
  const matched = new Set<string>();
  for (const s of segs) for (const c of existing) if (c === s || singular(c) === s || c === s + 's') matched.add(c);
  if (body && typeof body === 'object' && !Array.isArray(body))
    for (const k of Object.keys(body))
      if (k.endsWith('Id') && k.length > 2) {
        const base = k.slice(0, -2);
        for (const c of existing) if (singular(c) === base || c === base) matched.add(c);
      }

  const last = segs.at(-1);
  const create = new Set(matched);
  if (last && COLLECTION_RE.test(last)) create.add(existing.find((c) => singular(c) === last) ?? last);

  const send = store.sizeBytes() < SEND_ALL_BELOW_BYTES ? existing : [...matched];
  return { send, create: [...create] };
}
