import OpenAI from 'openai';
import { config } from './config.ts';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ModelResult = { text: string; tokensIn: number; tokensOut: number };
export interface ModelClient {
  complete(messages: ChatMessage[]): Promise<ModelResult>;
}

const ANSWER_JSON_SCHEMA = {
  name: 'phantom_answer',
  strict: false,
  schema: {
    type: 'object',
    properties: { status: { type: 'integer' }, body: {}, storeOps: { type: 'array', items: { type: 'object' } } },
    required: ['status', 'body', 'storeOps'],
  },
};

export function cerebrasClient(): ModelClient {
  const client = new OpenAI({ apiKey: config.apiKey || 'missing', baseURL: config.baseURL });
  return {
    async complete(messages) {
      if (!config.apiKey) throw new Error('CEREBRAS_API_KEY is not set');
      const r = await client.chat.completions.create({
        model: config.model,
        temperature: 0,
        max_tokens: config.maxTokens,
        response_format: config.jsonSchemaOutput
          ? { type: 'json_schema', json_schema: ANSWER_JSON_SCHEMA }
          : { type: 'json_object' },
        ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
        messages,
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
      return {
        text: r.choices[0]?.message?.content ?? '',
        tokensIn: r.usage?.prompt_tokens ?? 0,
        tokensOut: r.usage?.completion_tokens ?? 0,
      };
    },
  };
}

/** For tests: returns scripted answers in order and keeps the prompts it was sent. */
export function fakeClient(answers: (string | object | Error)[]): ModelClient & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  return {
    calls,
    async complete(messages) {
      calls.push(messages);
      const a = answers.shift();
      if (a === undefined) throw new Error('fakeClient: no more answers');
      if (a instanceof Error) throw a;
      return { text: typeof a === 'string' ? a : JSON.stringify(a), tokensIn: 100, tokensOut: 20 };
    },
  };
}
