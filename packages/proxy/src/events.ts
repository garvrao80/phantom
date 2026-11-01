import type { ServerResponse } from 'node:http';

export type EventType = 'request' | 'route' | 'materialize' | 'reset';
const HEARTBEAT_MS = 15_000;

/** Server-Sent Events hub for the dashboard. */
export class EventHub {
  private clients = new Set<ServerResponse>();
  private timer = setInterval(() => this.broadcast(': hb\n\n'), HEARTBEAT_MS).unref();

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
    clearInterval(this.timer);
    for (const c of this.clients) c.end();
    this.clients.clear();
  }

  private broadcast(msg: string) {
    for (const c of this.clients) c.write(msg);
  }
}
