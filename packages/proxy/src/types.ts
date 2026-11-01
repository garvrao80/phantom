import type { Store } from './store.ts';

export type Rec = { id: string; [k: string]: unknown };

export type StoreOp =
  | { op: 'insert'; collection: string; id: string; record: Rec }
  | { op: 'update'; collection: string; id: string; patch: Record<string, unknown> }
  | { op: 'delete'; collection: string; id: string };

export type StoreData = {
  version: number;
  /** Next number to hand out per collection (default 1). */
  nextId: Record<string, number>;
  collections: Record<string, Record<string, Rec>>;
};

/** How a single request was served. */
export type Mode = 'PHANTOM' | 'REAL' | 'CACHED' | 'REPLAY' | 'ERROR';
/** Which backend owns a route. */
export type RouteMode = 'PHANTOM' | 'REAL';

export type ApiRequest = {
  method: string;
  path: string;
  routeKey: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
};

export type ApiResponse = { status: number; body: unknown };

export type Recording = {
  seq: number;
  ts: number;
  mode: Mode;
  ok: boolean;
  routeKey: string;
  req: Omit<ApiRequest, 'routeKey'>;
  res: ApiResponse;
  storeOps: StoreOp[];
  storeBefore: StoreData;
  latencyMs: number;
  tokens?: { in: number; out: number };
  retries: number;
  error?: string;
};

export type HandlerCtx = {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  store: Store;
};
export type Handler = (ctx: HandlerCtx) => Promise<ApiResponse>;
