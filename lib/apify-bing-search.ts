import { env } from '../src/env.js';

export type ApifyBingResult = {
  title?: string;
  link: string;
  snippet?: string;
  date?: string;
  source?: string;
};

export type ApifyBingOptions = {
  count?: number;
  market?: string;
  safeSearch?: 'Off' | 'Moderate' | 'Strict';
};

// Actor: tri_angle/bing-search-scraper
// We call: run-sync-get-dataset-items to receive items directly.
export async function apifyBingSearch(query: string, opts?: ApifyBingOptions): Promise<ApifyBingResult[]> {
  if (!env.APIFY_TOKEN) throw new Error('APIFY_TOKEN_MISSING');

  const url = new URL('https://api.apify.com/v2/acts/tri_angle~bing-search-scraper/run-sync-get-dataset-items');
  url.searchParams.set('token', env.APIFY_TOKEN);

  const runInput: Record<string, any> = {
    // The actor supports multiline queries; simplest is a single query line.
    queries: String(query),
    maxItems: opts?.count ?? env.SEKED_MAX_RESULTS_PER_QUERY
  };

  if (opts?.market) runInput.market = opts.market;
  if (opts?.safeSearch) runInput.safeSearch = opts.safeSearch;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(runInput)
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`APIFY_BING_FAILED status=${res.status} body=${body.slice(0, 500)}`);
  }

  const items = (await res.json()) as any[];
  if (!Array.isArray(items)) return [];

  return items
    .map((it) => normalizeItem(it))
    .filter((r): r is ApifyBingResult => Boolean(r && r.link));
}

function normalizeItem(it: any): ApifyBingResult | null {
  // Different actors emit slightly different shapes; we normalize defensively.
  const link =
    it?.url ??
    it?.link ??
    it?.href ??
    it?.organicUrl ??
    it?.resultUrl ??
    it?.positionUrl ??
    '';

  if (!link || typeof link !== 'string') return null;

  const title = (it?.title ?? it?.name ?? it?.pageTitle ?? it?.headline) as string | undefined;
  const snippet = (it?.snippet ?? it?.description ?? it?.text ?? it?.caption) as string | undefined;
  const date = (it?.date ?? it?.dateLastCrawled ?? it?.publishedAt) as string | undefined;
  const source = (it?.source ?? it?.provider ?? it?.siteName) as string | undefined;

  return {
    title: title ? String(title) : undefined,
    link: String(link),
    snippet: snippet ? String(snippet) : undefined,
    date: date ? String(date) : undefined,
    source: source ? String(source) : undefined
  };
}
