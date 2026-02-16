import { env } from '../src/env.js';

export type BingWebResult = {
  name?: string;
  url: string;
  snippet?: string;
  dateLastCrawled?: string;
  displayUrl?: string;
};

export type BingSearchResponse = {
  webPages?: {
    value: BingWebResult[];
  };
};

export type SourceOrchestration = {
  market: string;
  freshness: 'Day' | 'Week' | 'Month' | 'Year';
  count: number;
};

export async function bingSearch(query: string, opts?: Partial<SourceOrchestration>): Promise<BingWebResult[]> {
  const market = opts?.market ?? env.SEKED_MARKET;
  const freshness = opts?.freshness ?? env.SEKED_FRESHNESS;
  const count = opts?.count ?? env.SEKED_MAX_RESULTS_PER_QUERY;

  const endpoint = env.BING_ENDPOINT.replace(/\/$/, '');
  const url = new URL(endpoint + '/v7.0/search');
  url.searchParams.set('q', query);
  url.searchParams.set('mkt', market);
  url.searchParams.set('freshness', freshness);
  url.searchParams.set('count', String(count));

  const res = await fetch(url, {
    headers: {
      'Ocp-Apim-Subscription-Key': env.BING_API_KEY
    }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BING_SEARCH_FAILED status=${res.status} body=${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as BingSearchResponse;
  return json.webPages?.value ?? [];
}
