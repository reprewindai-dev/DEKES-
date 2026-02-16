import { env } from '../src/env.js';
import { serpApiSearch, type SerpApiOptions, type SerpApiResult } from './serpapi-search.js';
import { bingSearch } from './bing-search.js';
import { apifyBingSearch } from './apify-bing-search.js';

export type UnifiedSearchResult = SerpApiResult;

export type UnifiedSearchOptions = SerpApiOptions;

function providerName(): string {
  return (env.SEARCH_PROVIDER ?? 'serpapi').toLowerCase();
}

function fallbackName(): string | undefined {
  const v = env.SEARCH_FALLBACK?.trim();
  return v ? v.toLowerCase() : undefined;
}

async function runProvider(name: string, query: string, opts?: UnifiedSearchOptions): Promise<UnifiedSearchResult[]> {
  if (name === 'serpapi') return serpApiSearch(query, opts);

  if (name === 'bing') {
    // Map to bing-search.ts orchestration.
    const items = await bingSearch(query, {
      market: env.SEKED_MARKET,
      freshness: env.SEKED_FRESHNESS,
      count: opts?.num ?? env.SEKED_MAX_RESULTS_PER_QUERY
    });

    return items
      .map((r) => ({
        title: r.name,
        link: r.url,
        snippet: r.snippet,
        date: r.dateLastCrawled
      }))
      .filter((r) => Boolean(r.link));
  }

  if (name === 'apify_bing') {
    const items = await apifyBingSearch(query, { count: opts?.num ?? env.SEKED_MAX_RESULTS_PER_QUERY });
    return items.map((r) => ({ title: r.title, link: r.link, snippet: r.snippet, date: r.date, source: r.source }));
  }

  throw new Error(`UNKNOWN_SEARCH_PROVIDER ${name}`);
}

export async function unifiedSearch(query: string, opts?: UnifiedSearchOptions): Promise<UnifiedSearchResult[]> {
  const primary = providerName();
  const fallback = fallbackName();

  try {
    return await runProvider(primary, query, opts);
  } catch (e: any) {
    if (!fallback || fallback === primary) throw e;
    return await runProvider(fallback, query, opts);
  }
}
