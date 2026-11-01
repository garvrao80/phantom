import type { ServerResponse } from 'node:http';

export type EventType = 'request' | 'route' | 'materialize' | 'reset';
const HEARTBEAT_MS = 15_000;
const openHubs = new Set<EventHub>();

/** Module-level emit for code that has no hub reference (e.g. materialize.ts): broadcasts on every open hub. */
export function emit(type: EventType, data: unknown) {
  for (const hub of openHubs) hub.emit(type, data);
}

/** Server-Sent Events hub for the dashboard. */
export class EventHub {
  private clients = new Set<ServerResponse>();
  private timer = setInterval(() => this.broadcast(': hb\n\n'), HEARTBEAT_MS).unref();

  constructor() {
    openHubs.add(this);
  }

  addClient(res: ServerResponse) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    res.write(': connected\n\n');
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  emit(type: EventType, data: unknown) {
    this.broadcast(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  close() {
    openHubs.delete(this);
    clearInterval(this.timer);
    for (const c of this.clients) c.end();
    this.clients.clear();
  }

  private broadcast(msg: string) {
    for (const c of this.clients) c.write(msg);
  }
}
