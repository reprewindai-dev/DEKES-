export type ScoreBreakdown = {
  score: number;
  intentDepth: number;
  urgencyVelocity: number;
  budgetSignals: number;
  fitPrecision: number;
  rush12HourEligible: boolean;
  buyerType?: string;
  painTags: string[];
  serviceTags: string[];
};

export type ScoringWeights = {
  intentWeight: number;
  urgencyWeight: number;
  budgetWeight: number;
  fitWeight: number;
};

export type LeadText = {
  title?: string;
  snippet?: string;
};

const URGENCY_TERMS_CRITICAL = ['asap', 'today', 'urgent', 'immediately'];
const URGENCY_TERMS_HIGH = ['this week', 'deadline', 'by friday', 'by monday'];
const URGENCY_TERMS_MOD = ['soon', 'next week', 'this month'];

const BUDGET_STRONG = ['$', 'budget', 'paid', 'rate', 'retainer'];
const BUDGET_MOD = ['hire', 'outsource', 'contractor', 'pay'];
const BUDGET_NEG = ['free', 'volunteer', 'student'];

const INTENT_COMPETITIVE = ['vs', 'versus', 'which is better', 'compare', 'alternative'];
const INTENT_URGENT_HIRE = ['hiring', 'hire', 'need an editor', 'looking for an editor'];
const INTENT_ACTIVE = ['need editor', 'need a video editor', 'need someone to edit'];
const INTENT_PASSIVE = ['struggle', 'hard to edit', 'editing takes'];

const FIT_PERFECT = ['podcast repurpose', 'repurpose podcast', 'short form repurpose', 'turn long form into shorts'];
const FIT_GOOD = ['video editor shorts', 'shorts editor', 'tiktok editor', 'reels editor', 'captions'];
const FIT_MOD = ['video editor', 'content creator', 'edit videos'];

const SELLER_TERMS = ['for hire', 'available for work', 'my services'];

export function scoreLead(text: LeadText, weights: ScoringWeights): ScoreBreakdown {
  const raw = `${text.title ?? ''}\n${text.snippet ?? ''}`.toLowerCase();

  const painTags: string[] = [];
  const serviceTags: string[] = [];

  const intentDepth = computeIntentDepth(raw);
  const urgencyVelocity = computeUrgencyVelocity(raw);
  const budgetSignals = computeBudgetSignals(raw);
  const fitPrecision = computeFitPrecision(raw, serviceTags);

  const rush12HourEligible = /12\s*hour|same\s*day|overnight/.test(raw) || urgencyVelocity >= 18;

  const buyerType = /agency|clients|white\s*label/.test(raw) ? 'AGENCY' : /podcast|episode/.test(raw) ? 'PODCASTER' : undefined;

  if (/swamped|overwhelmed|too\s*much\s*work/.test(raw)) painTags.push('PAIN_SWAMPED');
  if (/deadline|asap|urgent/.test(raw)) painTags.push('PAIN_DEADLINE');
  if (/no\s*views|zero\s*views|low\s*views/.test(raw)) painTags.push('PAIN_NO_VIEWS');

  if (FIT_PERFECT.some((t) => raw.includes(t))) serviceTags.push('PODCAST_REPURPOSE');
  if (/(shorts|tiktok|reels)/.test(raw)) serviceTags.push('SHORT_FORM');
  if (/captions|subtitles/.test(raw)) serviceTags.push('CAPTIONS');

  // seller detection penalty
  const seller = SELLER_TERMS.some((t) => raw.includes(t));

  const weighted =
    intentDepth * weights.intentWeight +
    urgencyVelocity * weights.urgencyWeight +
    budgetSignals * weights.budgetWeight +
    fitPrecision * weights.fitWeight;

  let score = Math.round(weighted);
  if (seller) score = Math.max(0, score - 30);

  // clamp 0-100
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    intentDepth,
    urgencyVelocity,
    budgetSignals,
    fitPrecision,
    rush12HourEligible,
    buyerType,
    painTags: uniq(painTags),
    serviceTags: uniq(serviceTags)
  };
}

function computeIntentDepth(raw: string): number {
  if (INTENT_COMPETITIVE.some((t) => raw.includes(t))) return 50;
  if (INTENT_URGENT_HIRE.some((t) => raw.includes(t))) return 40;
  if (INTENT_ACTIVE.some((t) => raw.includes(t))) return 25;
  if (INTENT_PASSIVE.some((t) => raw.includes(t))) return 10;
  return 0;
}

function computeUrgencyVelocity(raw: string): number {
  if (URGENCY_TERMS_CRITICAL.some((t) => raw.includes(t))) return 25;
  if (URGENCY_TERMS_HIGH.some((t) => raw.includes(t))) return 18;
  if (URGENCY_TERMS_MOD.some((t) => raw.includes(t))) return 10;
  return 0;
}

function computeBudgetSignals(raw: string): number {
  if (BUDGET_NEG.some((t) => raw.includes(t))) return -10;
  if (BUDGET_STRONG.some((t) => raw.includes(t))) return 15;
  if (BUDGET_MOD.some((t) => raw.includes(t))) return 8;
  return 0;
}

function computeFitPrecision(raw: string, serviceTags: string[]): number {
  if (FIT_PERFECT.some((t) => raw.includes(t))) return 10;
  if (FIT_GOOD.some((t) => raw.includes(t))) return 6;
  if (FIT_MOD.some((t) => raw.includes(t))) return 3;
  return 0;
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
