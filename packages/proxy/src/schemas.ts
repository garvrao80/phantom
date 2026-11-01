import { Ajv, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export type JSONSchema = Record<string, any>;
export type Locked = { response: JSONSchema; status: number; lockedAt: number; sampleCount: number };

const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;
const UNKNOWN = (): JSONSchema => ({ 'x-unknown': true });

/** Infer a strict schema from one sample. Unknowns (null, empty arrays) can be refined once later. */
export function inferSchema(v: unknown): JSONSchema {
  if (v === null || v === undefined) return UNKNOWN();
  if (Array.isArray(v)) return { type: 'array', items: v.length ? inferSchema(v[0]) : UNKNOWN() };
  if (typeof v === 'object') {
    const properties: Record<string, JSONSchema> = {};
    for (const [k, val] of Object.entries(v)) properties[k] = inferSchema(val);
    return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
  }
  if (typeof v === 'number') return { type: 'number' };
  return { type: typeof v };
}

/** Replace unknown nodes with schemas inferred from a new sample. Returns true if anything changed. */
export function refine(schema: JSONSchema, v: unknown): boolean {
  if (schema['x-unknown']) {
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return false;
    delete schema['x-unknown'];
    Object.assign(schema, inferSchema(v));
    return true;
  }
  let changed = false;
  if (schema.type === 'object' && v && typeof v === 'object' && !Array.isArray(v))
    for (const [k, s] of Object.entries<JSONSchema>(schema.properties ?? {}))
      changed = refine(s, (v as Record<string, unknown>)[k]) || changed;
  if (schema.type === 'array' && Array.isArray(v)) for (const item of v) changed = refine(schema.items, item) || changed;
  return changed;
}

export class SchemaRegistry {
  private ajv = new Ajv({ strict: false, allErrors: true });
  private compiled = new Map<string, ValidateFunction>();
  private data: Record<string, Locked>;

  constructor(private file: string) {
    addFormats(this.ajv);
    this.data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  }

  get(key: string): Locked | undefined {
    return this.data[key];
  }
  all() {
    return this.data;
  }

  /** Call after a 2xx answer passes every other check: locks the first sample, refines unknowns later. */
  observe(key: string, status: number, body: unknown) {
    const cur = this.data[key];
    if (!cur) {
      if (Array.isArray(body) && body.length === 0) return; // don't lock on []
      this.data[key] = { response: inferSchema(body), status, lockedAt: Date.now(), sampleCount: 1 };
    } else {
      cur.sampleCount++;
      if (refine(cur.response, body)) this.compiled.delete(key);
    }
    this.save();
  }

  /** Human-readable errors; empty means valid, or not locked yet. */
  validate(key: string, status: number, body: unknown): string[] {
    const cur = this.data[key];
    if (!cur) return [];
    if (status !== cur.status) return [`expected status ${cur.status}, got ${status}`];
    let fn = this.compiled.get(key);
    if (!fn) {
      // Compile a copy: ajv caches by schema object, and refine() mutates the stored one in place.
      fn = this.ajv.compile(structuredClone(cur.response));
      this.compiled.set(key, fn);
    }
    if (fn(body)) return [];
    return (fn.errors ?? []).map((e) => {
      const extra = e.keyword === 'additionalProperties' ? ` "${e.params.additionalProperty}"` : '';
      return `${e.instancePath || 'body'} ${e.message}${extra}`;
    });
  }

  reset() {
    this.data = {};
    this.compiled.clear();
    this.save();
  }

  private save() {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}
