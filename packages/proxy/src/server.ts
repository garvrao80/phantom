import { createApp } from './app.ts';
import { cerebrasClient } from './model.ts';
import { realHandlers, loadGenerated } from './realHandlers.ts';
import { materialize, retryMaterialize, isMaterializing, getMaterializeJob } from './materialize.ts';
import { config, DATA_DIR, GENERATED_DIR } from './config.ts';

const { app } = await createApp({
  dataDir: DATA_DIR,
  generatedDir: GENERATED_DIR,
  model: cerebrasClient(),
  modelName: config.model,
  replay: config.replay,
  snapshotLimit: config.snapshotLimit,
  realHandlers,
  loadGenerated,
  materializer: { start: materialize, retry: retryMaterialize, isRunning: isMaterializing, getLastJob: getMaterializeJob },
});

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`phantom proxy on :${config.port} (model ${config.model}${config.replay ? ', replay mode' : ''})`);
if (!config.apiKey) console.warn('CEREBRAS_API_KEY is not set: phantom calls will fail until it is (replay still works)');
