import { env } from '../src/env.js';
import type { IntentClass, IntentVerdict } from './page-enrichment.js';
import { groqChatCompletion } from './groq-client.js';

export type GroqIntentResult = Pick<IntentVerdict, 'intentClass' | 'confidence' | 'proofLines' | 'proofOk' | 'roleMatch' | 'roleMismatch'> & {
  reasons: string[];
  buyerScore: number;
  sellerScore: number;
};

function safeParseJson(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function groqClassifyIntent(args: {
  text: string;
  mode: 'fast' | 'smart';
}): Promise<GroqIntentResult> {
  const model = args.mode === 'smart' ? env.GROQ_MODEL_SMART : env.GROQ_MODEL_FAST;

  const system =
    'You are a lead qualification classifier. Return only valid JSON.\n' +
    'Task: classify whether the text represents a BUYER looking to hire video editing help, a SELLER offering services, or AMBIGUOUS.\n' +
    'Also extract 1-5 proofLines that justify the classification, and evaluate proofOk (buyer ask + editing role) and roleMismatch (hiring for non-editing roles).\n' +
    'Return schema:\n' +
    '{"intentClass":"BUYER|SELLER|AMBIGUOUS","confidence":0-1,"proofLines":string[],"proofOk":boolean,"roleMatch":boolean,"roleMismatch":boolean,"buyerScore":0-10,"sellerScore":0-10,"reasons":string[]}';

  const user = `TEXT:\n${args.text.slice(0, 12000)}`;

  const { content } = await groqChatCompletion({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0,
    maxTokens: 600,
    responseFormatJson: true
  });

  const parsed = safeParseJson(content) ?? {};

  const intentClass: IntentClass =
    parsed.intentClass === 'BUYER' || parsed.intentClass === 'SELLER' || parsed.intentClass === 'AMBIGUOUS'
      ? parsed.intentClass
      : 'AMBIGUOUS';

  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;

  const proofLines = Array.isArray(parsed.proofLines) ? parsed.proofLines.map((s: any) => String(s)).slice(0, 5) : [];
  const proofOk = Boolean(parsed.proofOk);
  const roleMatch = Boolean(parsed.roleMatch);
  const roleMismatch = Boolean(parsed.roleMismatch);

  const buyerScore = typeof parsed.buyerScore === 'number' ? Math.max(0, Math.min(10, parsed.buyerScore)) : 0;
  const sellerScore = typeof parsed.sellerScore === 'number' ? Math.max(0, Math.min(10, parsed.sellerScore)) : 0;
  const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.map((s: any) => String(s)).slice(0, 12) : [];

  return {
    intentClass,
    confidence,
    proofLines,
    proofOk,
    roleMatch,
    roleMismatch,
    buyerScore,
    sellerScore,
    reasons
  };
}
