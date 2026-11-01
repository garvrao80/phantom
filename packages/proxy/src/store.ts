import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import type { StoreData, StoreOp } from './types.ts';

export const singular = (c: string) =>
  c.endsWith('ies') ? c.slice(0, -3) + 'y' : c.endsWith('s') ? c.slice(0, -1) : c;

export const COLLECTION_RE = /^[a-z][a-z0-9_]*$/;
const emptyData = (): StoreData => ({ version: 0, nextId: {}, collections: {} });

export class Store {
  private constructor(private data: StoreData, private file?: string) {}

  static load(file: string) {
    const data = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as StoreData) : emptyData();
    return new Store(data, file);
  }

  /** In-memory store that is never written to disk (used by replay tests). */
  static fromData(data: StoreData) {
    return new Store(structuredClone(data));
  }

  get version() {
    return this.data.version;
  }
  collections() {
    return Object.keys(this.data.collections);
  }
  get(col: string, id: string) {
    return this.data.collections[col]?.[id];
  }
  list(col: string) {
    return Object.values(this.data.collections[col] ?? {});
  }

  /** Next id for a collection. Does not advance; inserting it does. */
  peekId(col: string) {
    return `${singular(col)}_${this.data.nextId[col] ?? 1}`;
  }
  /** Alias used by generated handlers. */
  reserveId(col: string) {
    return this.peekId(col);
  }

  dryRun(ops: StoreOp[]): { ok: true } | { ok: false; reason: string } {
    const cols = structuredClone(this.data.collections);
    for (const op of ops) {
      if (!op || typeof op.collection !== 'string' || !COLLECTION_RE.test(op.collection))
        return { ok: false, reason: `bad collection name "${op?.collection}"` };
      if (typeof op.id !== 'string' || !op.id) return { ok: false, reason: `${op.op}: id must be a non-empty string` };
      const c = (cols[op.collection] ??= {});
      if (op.op === 'insert') {
        if (c[op.id]) return { ok: false, reason: `insert: ${op.collection}/${op.id} already exists` };
        if (!op.record || op.record.id !== op.id) return { ok: false, reason: 'insert: record.id must equal id' };
        c[op.id] = op.record;
      } else if (op.op === 'update') {
        if (!c[op.id]) return { ok: false, reason: `update: ${op.collection}/${op.id} not found` };
        if (!op.patch || typeof op.patch !== 'object') return { ok: false, reason: 'update: patch must be an object' };
        c[op.id] = { ...c[op.id], ...op.patch, id: op.id };
      } else if (op.op === 'delete') {
        if (!c[op.id]) return { ok: false, reason: `delete: ${op.collection}/${op.id} not found` };
        delete c[op.id];
      } else {
        return { ok: false, reason: `unknown op "${(op as { op: unknown }).op}"` };
      }
    }
    return { ok: true };
  }

  /** All-or-nothing: validates the whole batch first, then applies it and saves. */
  applyOps(ops: StoreOp[]) {
    if (ops.length === 0) return;
    const check = this.dryRun(ops);
    if (!check.ok) throw new Error(check.reason);
    for (const op of ops) {
      const c = (this.data.collections[op.collection] ??= {});
      if (op.op === 'insert') {
        c[op.id] = op.record;
        const n = Number(op.id.split('_').pop());
        if (Number.isInteger(n))
          this.data.nextId[op.collection] = Math.max(this.data.nextId[op.collection] ?? 1, n + 1);
      } else if (op.op === 'update') {
        c[op.id] = { ...c[op.id], ...op.patch, id: op.id };
      } else {
        delete c[op.id];
      }
    }
    this.data.version++;
    this.save();
  }

  /** The given collections, capped at the `limit` most recent records each. */
  snapshot(cols: string[], limit: number): StoreData {
    const out: StoreData = { version: this.data.version, nextId: {}, collections: {} };
    for (const col of cols) {
      const entries = Object.entries(this.data.collections[col] ?? {}).slice(-limit);
      out.collections[col] = structuredClone(Object.fromEntries(entries));
      out.nextId[col] = this.data.nextId[col] ?? 1;
    }
    return out;
  }

  sizeBytes() {
    return JSON.stringify(this.data.collections).length;
  }
  dump() {
    return structuredClone(this.data);
  }

  reset() {
    this.data = emptyData();
    this.save();
  }

  save() {
    if (!this.file) return;
    writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2));
    renameSync(this.file + '.tmp', this.file);
  }
}
