export type QuerySuggestion = {
  name: string;
  query: string;
  score: number;
  sourcePack?: 'FORUMS' | 'SOCIAL' | 'PROFESSIONAL' | 'WIDE_WEB';
};

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

export function generateQuerySuggestions(input: {
  topDomains: string[];
  topPatterns: Array<{ key: string; winRate: number }>;
  seedIntents?: string[];
}): QuerySuggestion[] {
  const intents = input.seedIntents?.length
    ? input.seedIntents
    : [
        'need an editor',
        'hiring editor',
        'outsource editing',
        'urgent editor asap',
        'podcast repurpose editor',
        'shorts editor captions'
      ];

  const patterns = input.topPatterns
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 10)
    .map((p) => p.key.toLowerCase());

  const domainHints = input.topDomains
    .slice(0, 15)
    .map((d) => d.replace(/^www\./, '').toLowerCase());

  const suggestions: QuerySuggestion[] = [];

  for (const intent of intents) {
    suggestions.push({
      name: `Expansion: ${intent}`,
      query: `${intent} budget -upwork -fiverr`,
      score: 0.5,
      sourcePack: 'WIDE_WEB'
    });
  }

  for (const p of patterns) {
    const tokens = p
      .replace(/[^a-z0-9_\s-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6);

    const phrase = tokens.join(' ');
    suggestions.push({
      name: `Pattern: ${p}`,
      query: `${phrase} need editor budget -upwork -fiverr`,
      score: 0.8,
      sourcePack: /agency/.test(p) ? 'PROFESSIONAL' : /podcast/.test(p) ? 'FORUMS' : 'WIDE_WEB'
    });
  }

  for (const d of domainHints) {
    suggestions.push({
      name: `Entity domain: ${d}`,
      query: `site:${d} (need editor OR hiring editor OR outsource editing OR podcast repurpose)`,
      score: 0.9,
      sourcePack: 'WIDE_WEB'
    });
  }

  return uniqByQuery(suggestions)
    .map((s) => ({ ...s, score: clamp(s.score, 0, 1) }))
    .sort((a, b) => b.score - a.score);
}

function uniqByQuery(items: QuerySuggestion[]): QuerySuggestion[] {
  const seen = new Set<string>();
  const out: QuerySuggestion[] = [];
  for (const i of items) {
    const key = i.query.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
