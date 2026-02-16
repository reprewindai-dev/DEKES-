import { env } from '../src/env.js';
import { groqClassifyIntent } from './groq-intent.js';

const SOCIAL_HOST_HINTS = ['facebook.com', 'reddit.com', 'x.com', 'twitter.com', 'youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com'];

export type IntentClass = 'BUYER' | 'SELLER' | 'AMBIGUOUS';

export type IntentVerdict = {
  intentClass: IntentClass;
  buyerScore: number;
  sellerScore: number;
  confidence: number;
  reasons: string[];
  proofLines: string[];
  proofOk: boolean;
  roleMatch: boolean;
  roleMismatch: boolean;
};

export type Enrichment = {
  pageText?: string;
  emails: string[];
  socials: Array<{ platform: string; url: string }>;
  verdict?: IntentVerdict;
};

export function shouldFetchPage(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (SOCIAL_HOST_HINTS.some((h) => host.includes(h))) return false;
    return true;
  } catch {
    return false;
  }
}

export async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`FETCH_FAILED status=${res.status}`);
  const html = await res.text();
  return htmlToText(html).slice(0, 20000);
}

function htmlToText(html: string): string {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const noTags = noScript.replace(/<[^>]+>/g, ' ');
  return noTags.replace(/\s+/g, ' ').trim();
}

export function extractEmails(text: string): string[] {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return uniq(matches.map((m) => m.toLowerCase())).slice(0, 10);
}

export function extractSocials(text: string): Array<{ platform: string; url: string }> {
  const urls = text.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  const out: Array<{ platform: string; url: string }> = [];
  for (const u of uniq(urls)) {
    const lower = u.toLowerCase();
    if (lower.includes('instagram.com')) out.push({ platform: 'INSTAGRAM', url: u });
    else if (lower.includes('tiktok.com')) out.push({ platform: 'TIKTOK', url: u });
    else if (lower.includes('youtube.com') || lower.includes('youtu.be')) out.push({ platform: 'YOUTUBE', url: u });
    else if (lower.includes('linkedin.com')) out.push({ platform: 'LINKEDIN', url: u });
    else if (lower.includes('twitter.com') || lower.includes('x.com')) out.push({ platform: 'X', url: u });
  }
  return out.slice(0, 10);
}

export function classifyIntent(text: string): IntentVerdict {
  const raw = text.toLowerCase();
  const reasons: string[] = [];

  const buyerHints: Array<{ h: string; w: number }> = [
    { h: 'looking for', w: 2 },
    { h: 'need an editor', w: 3 },
    { h: 'editor needed', w: 3 },
    { h: 'need someone to edit', w: 3 },
    { h: 'hiring', w: 3 },
    { h: 'hire', w: 2 },
    { h: 'seeking', w: 2 },
    { h: 'outsourcing', w: 2 },
    { h: 'looking to outsource', w: 3 },
    { h: 'budget', w: 2 },
    { h: 'paid', w: 2 },
    { h: 'rate', w: 2 },
    { h: 'retainer', w: 2 },
    { h: 'recommend', w: 1 },
    { h: 'anyone know', w: 1 }
  ];

  const sellerHints: Array<{ h: string; w: number }> = [
    { h: 'for hire', w: 4 },
    { h: 'available for work', w: 4 },
    { h: 'available for hire', w: 4 },
    { h: 'open for work', w: 4 },
    { h: 'my services', w: 3 },
    { h: 'portfolio', w: 3 },
    { h: 'showreel', w: 3 },
    { h: 'dm me', w: 2 },
    { h: 'contact us', w: 3 },
    { h: 'contact me', w: 3 },
    { h: 'book a call', w: 4 },
    { h: 'schedule a call', w: 4 },
    { h: 'get a quote', w: 3 },
    { h: 'pricing', w: 2 },
    { h: 'our services', w: 3 },
    { h: 'we help', w: 2 },
    { h: 'case studies', w: 2 },
    { h: 'testimonials', w: 2 },
    { h: 'agency', w: 1 },
    { h: 'clients', w: 1 }
  ];

  const buyerScore = buyerHints.reduce((s, x) => s + (raw.includes(x.h) ? x.w : 0), 0);
  const sellerScore = sellerHints.reduce((s, x) => s + (raw.includes(x.h) ? x.w : 0), 0);

  if (buyerScore > 0) reasons.push('BUYER_HINTS');
  if (sellerScore > 0) reasons.push('SELLER_HINTS');

  let intentClass: IntentClass = 'AMBIGUOUS';
  if (buyerScore >= 4 && sellerScore <= 1) intentClass = 'BUYER';
  if (sellerScore >= 5 && buyerScore <= 1) intentClass = 'SELLER';
  if (buyerScore >= 4 && sellerScore >= 4) intentClass = buyerScore >= sellerScore ? 'BUYER' : 'SELLER';

  const gap = Math.abs(buyerScore - sellerScore);
  const magnitude = buyerScore + sellerScore;
  const confidence = Math.min(1, gap / 6 + (magnitude > 0 ? 0.25 : 0));

  const proofLines = extractProofLines(text, buyerHints.map((x) => x.h)).slice(0, 5);

  const proofEval = evaluateBuyerAskProof(proofLines);
  if (proofEval.proofOk) reasons.push('PROOF_OK');
  if (proofEval.roleMismatch) reasons.push('ROLE_MISMATCH');

  return {
    intentClass,
    buyerScore,
    sellerScore,
    confidence,
    reasons,
    proofLines,
    proofOk: proofEval.proofOk,
    roleMatch: proofEval.roleMatch,
    roleMismatch: proofEval.roleMismatch
  };
}

const EDITING_ROLE_TERMS = [
  'video editor',
  'editor',
  'shorts editor',
  'reels editor',
  'tiktok editor',
  'podcast editor',
  'post production',
  'capcut',
  'premiere',
  'after effects'
];

const BUYER_ASK_TERMS = ['looking for', 'need', 'editor needed', 'hiring', 'hire', 'seeking', 'budget', 'paid', 'rate'];

const NON_EDITING_ROLE_TERMS = [
  'affiliate',
  'growth specialist',
  'media buyer',
  'ads manager',
  'appointment setter',
  'setter',
  'closer',
  'virtual assistant',
  'va',
  'social media manager',
  'community manager',
  'thumbnail',
  'scriptwriter',
  'copywriter'
];

export function evaluateBuyerAskProof(proofLines: string[]): {
  proofOk: boolean;
  roleMatch: boolean;
  roleMismatch: boolean;
} {
  const joined = proofLines.join('\n').toLowerCase();
  const buyerAsk = BUYER_ASK_TERMS.some((t) => joined.includes(t));
  const roleMatch = EDITING_ROLE_TERMS.some((t) => joined.includes(t));
  const roleMismatch = NON_EDITING_ROLE_TERMS.some((t) => joined.includes(t)) && !roleMatch;
  const proofOk = buyerAsk && roleMatch && !roleMismatch;
  return { proofOk, roleMatch, roleMismatch };
}

function extractProofLines(text: string, buyerHints: string[]): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const s of sentences) {
    const lower = s.toLowerCase();
    if (buyerHints.some((h) => lower.includes(h))) out.push(s);
  }
  return uniq(out);
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

export async function enrichLead(url: string, title?: string, snippet?: string, leadScore?: number): Promise<Enrichment> {
  const baseText = `${title ?? ''}\n${snippet ?? ''}`.trim();
  let pageText: string | undefined;

  if (shouldFetchPage(url)) {
    try {
      pageText = await fetchPageText(url);
    } catch {
      pageText = undefined;
    }
  }

  const combined = `${baseText}\n${pageText ?? ''}`.trim();
  const emails = extractEmails(combined);
  const socials = extractSocials(combined);
  let verdict = combined.length >= 40 ? classifyIntent(combined) : undefined;

  const weak =
    !verdict ||
    verdict.intentClass === 'AMBIGUOUS' ||
    verdict.confidence < 0.6 ||
    !verdict.proofOk ||
    verdict.roleMismatch;

  const shouldEscalateSmart =
    (typeof leadScore === 'number' && leadScore >= 75) ||
    verdict?.intentClass === 'AMBIGUOUS' ||
    (verdict ? !verdict.proofOk : false);

  if (env.GROQ_API_KEY && combined.length >= 80 && (weak || (typeof leadScore === 'number' && leadScore >= 75))) {
    try {
      const mode: 'fast' | 'smart' = shouldEscalateSmart ? 'smart' : 'fast';
      const llm = await groqClassifyIntent({ text: combined, mode });
      verdict = {
        intentClass: llm.intentClass,
        buyerScore: llm.buyerScore,
        sellerScore: llm.sellerScore,
        confidence: llm.confidence,
        reasons: [...(verdict?.reasons ?? []), 'GROQ', ...llm.reasons],
        proofLines: llm.proofLines.length ? llm.proofLines : verdict?.proofLines ?? [],
        proofOk: llm.proofOk,
        roleMatch: llm.roleMatch,
        roleMismatch: llm.roleMismatch
      };
    } catch {
      // ignore LLM failure and keep heuristic verdict
    }
  }

  return { pageText, emails, socials, verdict };
}
