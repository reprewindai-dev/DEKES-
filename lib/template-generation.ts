import { Template } from '@prisma/client';

export type TemplatePickContext = {
  buyerType?: string;
  painTags: string[];
  serviceTags: string[];
  name?: string;
  orderPageUrl?: string;
  utm: {
    source: string;
    medium: string;
    campaign: string;
  };
};

export function pickTemplate(templates: Template[], ctx: TemplatePickContext): Template {
  const enabled = templates.filter((t) => t.enabled);
  if (enabled.length === 0) throw new Error('NO_TEMPLATES_ENABLED');

  let best = enabled[0];
  let bestScore = -Infinity;

  const totalSends = enabled.reduce((sum, t) => sum + Math.max(0, t.timesSent), 0);

  for (const t of enabled) {
    let s = 10;
    if (ctx.buyerType && t.buyerType && t.buyerType === ctx.buyerType) s += 30;
    if (t.serviceTag && ctx.serviceTags.includes(t.serviceTag)) s += 30;
    if (t.painTag && ctx.painTags.includes(t.painTag)) s += 30;

    const sent = Math.max(0, t.timesSent);
    const wins = Math.max(0, t.wonCount);
    const winRate = sent > 0 ? wins / sent : 0;

    const bandit = ucb1({ wins, trials: sent, totalTrials: Math.max(1, totalSends) });
    s += winRate * 10;
    s += bandit * 5;

    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }

  return best;
}

export function scoreTemplate(t: Template, ctx: TemplatePickContext, totalSends: number): number {
  let s = 10;
  if (ctx.buyerType && t.buyerType && t.buyerType === ctx.buyerType) s += 30;
  if (t.serviceTag && ctx.serviceTags.includes(t.serviceTag)) s += 30;
  if (t.painTag && ctx.painTags.includes(t.painTag)) s += 30;

  const sent = Math.max(0, t.timesSent);
  const wins = Math.max(0, t.wonCount);
  const winRate = sent > 0 ? wins / sent : 0;
  const bandit = ucb1({ wins, trials: sent, totalTrials: Math.max(1, totalSends) });

  s += winRate * 10;
  s += bandit * 5;
  return s;
}

export function pickTemplateWithPropensity(
  templates: Template[],
  ctx: TemplatePickContext
): { template: Template; templateProb: number } {
  const enabled = templates.filter((t) => t.enabled);
  if (enabled.length === 0) throw new Error('NO_TEMPLATES_ENABLED');

  const totalSends = enabled.reduce((sum, t) => sum + Math.max(0, t.timesSent), 0);
  const scored = enabled.map((t) => ({ t, s: scoreTemplate(t, ctx, totalSends) }));
  const probs = softmax(scored.map((x) => x.s));
  const idx = sampleIndex(probs);
  return { template: scored[idx].t, templateProb: probs[idx] };
}

function ucb1(input: { wins: number; trials: number; totalTrials: number }): number {
  const { wins, trials, totalTrials } = input;
  if (trials <= 0) return 1;
  const mean = wins / Math.max(1, trials);
  const explore = Math.sqrt((2 * Math.log(Math.max(2, totalTrials))) / trials);
  return mean + explore;
}

function softmax(scores: number[]): number[] {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / Math.max(1e-12, sum));
}

function sampleIndex(probs: number[]): number {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i];
    if (r <= acc) return i;
  }
  return probs.length - 1;
}

export function renderTemplate(body: string, ctx: TemplatePickContext): string {
  const orderUrl = ctx.orderPageUrl ? addUtm(ctx.orderPageUrl, ctx.utm) : undefined;
  const map: Record<string, string> = {
    name: ctx.name ?? 'there',
    pain_1: ctx.painTags[0] ?? 'that',
    service: ctx.serviceTags[0] ?? 'short-form editing',
    order_link: orderUrl ?? ''
  };

  return body.replace(/\{(\w+)\}/g, (_, key) => map[key] ?? `{${key}}`);
}

function addUtm(url: string, utm: { source: string; medium: string; campaign: string }): string {
  const u = new URL(url);
  u.searchParams.set('utm_source', utm.source);
  u.searchParams.set('utm_medium', utm.medium);
  u.searchParams.set('utm_campaign', utm.campaign);
  return u.toString();
}
