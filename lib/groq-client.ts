import { env } from '../src/env.js';

export type GroqChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type GroqChatResponse = {
  id: string;
  choices: Array<{ index: number; message: { role: string; content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export async function groqChatCompletion(args: {
  model: string;
  messages: GroqChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormatJson?: boolean;
}): Promise<{ content: string; usage?: GroqChatResponse['usage'] }> {
  if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY_MISSING');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GROQ_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      temperature: args.temperature ?? 0,
      max_tokens: args.maxTokens ?? 512,
      ...(args.responseFormatJson ? { response_format: { type: 'json_object' } } : {})
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GROQ_CHAT_FAILED status=${res.status} body=${body.slice(0, 800)}`);
  }

  const json = (await res.json()) as GroqChatResponse;
  const content = json.choices?.[0]?.message?.content ?? '';
  return { content, usage: json.usage };
}
