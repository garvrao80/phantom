import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Recording } from './types.ts';
import type { EventHub } from './events.ts';

export type ReadOptions = { route?: string; limit?: number; okOnly?: boolean };

/** Append-only log of every exchange (data/recordings.jsonl), streamed live as `request` events. */
export class Recorder {
  private seq: number;

  constructor(private file: string, private events: EventHub) {
    const all = this.readAll();
    this.seq = all.at(-1)?.seq ?? 0;
  }

  record(r: Omit<Recording, 'seq' | 'ts'>): Recording {
    const rec: Recording = { seq: ++this.seq, ts: Date.now(), ...r };
    appendFileSync(this.file, JSON.stringify(rec) + '\n');
    this.events.emit('request', rec);
    return rec;
  }

  /** Most recent matching recordings, oldest first. */
  read({ route, limit = 100, okOnly = false }: ReadOptions = {}) {
    return this.readAll()
      .filter((r) => (!route || r.routeKey === route) && (!okOnly || r.ok))
      .slice(-limit);
  }

  /** Latest successful recording for this route and query (used by replay mode). */
  latest(routeKey: string, query: object) {
    const q = JSON.stringify(query);
    return this.readAll()
      .reverse()
      .find((r) => r.ok && r.routeKey === routeKey && JSON.stringify(r.req.query) === q && r.mode !== 'REPLAY');
  }

  reset() {
    writeFileSync(this.file, '');
    this.seq = 0;
  }

  private readAll(): Recording[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }
}
