// Wire types mirror AGENTS.md §§7, 9–10. No dependency on the unfinished proxy scaffold.
export type Mode = "PHANTOM" | "REAL" | "CACHED" | "REPLAY" | "ERROR";
export type Recording = {
  seq: number;
  ts: number;
  mode: Mode;
  cached?: boolean;
  ok: boolean;
  routeKey: string;
  req: {
    method: string;
    path: string;
    params: Record<string, string>;
    query: Record<string, string>;
    body: unknown;
  };
  res: { status: number; body: unknown };
  storeOps: unknown[];
  storeBefore?: unknown;
  latencyMs: number;
  tokens?: { in: number; out: number };
  retries: number;
};
export type Route = {
  key: string;
  mode: Mode;
  calls: number;
  lastLatencyMs: number;
  locked: boolean;
  schema?: unknown;
};
export type Phase =
  | "context"
  | "codex"
  | "tests"
  | "activate"
  | "done"
  | "failed";
export type MaterializeEvent = {
  jobId: string;
  phase: Phase;
  line?: string;
  tests?: { passed: number; failed: number; total: number };
};
export type Job = MaterializeEvent & { lines: string[] };
export type Health = { ok: boolean; model: string; replay: boolean };
export type Connection = "connecting" | "live" | "reconnecting";
