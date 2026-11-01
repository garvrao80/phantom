import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const PROXY_DIR = resolve(here, '..');
export const ROOT_DIR = resolve(PROXY_DIR, '../..');
export const DATA_DIR = resolve(process.env.PHANTOM_DATA_DIR ?? resolve(ROOT_DIR, 'data'));
export const GENERATED_DIR = resolve(PROXY_DIR, 'generated');

export const config = {
  port: Number(process.env.PHANTOM_PORT ?? 4000),
  apiKey: process.env.CEREBRAS_API_KEY ?? '',
  model: process.env.CEREBRAS_MODEL ?? 'gpt-oss-120b',
  baseURL: process.env.CEREBRAS_BASE_URL ?? 'https://api.cerebras.ai/v1',
  replay: process.env.PHANTOM_REPLAY === 'true',
  snapshotLimit: Number(process.env.PHANTOM_SNAPSHOT_LIMIT ?? 50),
  maxTokens: Number(process.env.PHANTOM_MAX_TOKENS ?? 800),
  codexTimeoutMs: Number(process.env.CODEX_TIMEOUT_MS ?? 300_000),
  // Optional request settings; enable once confirmed on the day (AGENTS.md section 22).
  reasoningEffort: process.env.CEREBRAS_REASONING_EFFORT || undefined,
  jsonSchemaOutput: process.env.CEREBRAS_JSON_SCHEMA === 'true',
};
