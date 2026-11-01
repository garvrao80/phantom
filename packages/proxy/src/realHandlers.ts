import { copyFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Store } from './store.ts';
import { GENERATED_DIR } from './config.ts';

export type HandlerCtx = { params: Record<string, string>; query: Record<string, string>; body: unknown; store: Store };
export type Handler = (ctx: HandlerCtx) => Promise<{ status: number; body: unknown }>;
export const realHandlers = new Map<string, Handler>();

// Validate the complete candidate before changing any live routes.
export async function loadGenerated(keys: string[]): Promise<void> {
  const src = resolve(GENERATED_DIR, 'handlers.ts');
  if (!existsSync(src)) throw new Error('generated/handlers.ts not found');
  const copy = resolve(GENERATED_DIR, `handlers.${randomUUID()}.ts`);
  copyFileSync(src, copy);
  const mod = await import(pathToFileURL(copy).href);
  for (const key of keys) if (typeof mod.handlers?.[key] !== 'function') throw new Error(`Missing handler: ${key}`);
  for (const key of keys) realHandlers.set(key, mod.handlers[key]);
}
