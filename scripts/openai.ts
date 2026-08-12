import OpenAI from 'openai';
import { AppConfig, extractJsonObject, loadConfig, requireEnv } from './utils';

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY') });
  }
  return client;
}

export function getOpenAIModel(config?: AppConfig): string {
  const cfg = config || loadConfig();
  return cfg.openai?.model || 'gpt-4o';
}

export async function chatJson(system: string, user: string, maxTokens = 1000): Promise<unknown> {
  const config = loadConfig();
  const response = await getOpenAI().chat.completions.create({
    model: getOpenAIModel(config),
    max_tokens: maxTokens,
    temperature: 0.7,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI returned no text content');
  }
  return extractJsonObject(text);
}
