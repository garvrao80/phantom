import type { ApiResponse } from './types.ts';

/** GET cache keyed by route + query + store version, so any write invalidates it. */
export class ResponseCache {
  private map = new Map<string, ApiResponse>();
  key(routeKey: string, query: object, version: number) {
    return `${routeKey}|${JSON.stringify(query)}|${version}`;
  }
  get(k: string) {
    return this.map.get(k);
  }
  set(k: string, v: ApiResponse) {
    if (v.status < 300) this.map.set(k, v);
  }
  clear() {
    this.map.clear();
  }
}
