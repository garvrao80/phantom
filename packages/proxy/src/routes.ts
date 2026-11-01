import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { RouteMode } from './types.ts';
import type { EventHub } from './events.ts';

export type RouteInfo = { mode: RouteMode; calls: number; lastLatencyMs: number; locked: boolean };

/** Per-route status shown in the dashboard; persisted to data/routes.json. */
export class RouteRegistry {
  private data: Record<string, RouteInfo>;

  constructor(private file: string, private events: EventHub) {
    this.data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  }

  get(key: string) {
    return this.data[key];
  }
  list() {
    return Object.entries(this.data).map(([key, info]) => ({ key, ...info }));
  }

  touch(key: string, latencyMs: number, locked: boolean) {
    const cur = this.data[key];
    const changed = !cur || cur.locked !== locked;
    this.data[key] = { mode: cur?.mode ?? 'PHANTOM', calls: (cur?.calls ?? 0) + 1, lastLatencyMs: latencyMs, locked };
    this.save();
    if (changed) this.emitRoute(key);
  }

  setMode(key: string, mode: RouteMode) {
    const cur = this.data[key] ?? { mode, calls: 0, lastLatencyMs: 0, locked: false };
    this.data[key] = { ...cur, mode };
    this.save();
    this.emitRoute(key);
  }

  reset() {
    this.data = {};
    this.save();
  }

  private emitRoute(key: string) {
    const { mode, locked } = this.data[key];
    this.events.emit('route', { key, mode, locked });
  }

  private save() {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}
