import { env } from '../src/env.js';

export type SerpApiResult = {
  title?: string;
  link: string;
  snippet?: string;
  date?: string;
  source?: string;
};

type SerpApiOrganicResult = {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
  source?: string;
};

type SerpApiResponse = {
  organic_results?: SerpApiOrganicResult[];
};

export type SerpApiOptions = {
  location?: string;
  gl?: string;
  hl?: string;
  num?: number;
};

export async function serpApiSearch(query: string, opts?: SerpApiOptions): Promise<SerpApiResult[]> {
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', query);
  url.searchParams.set('api_key', env.SERPAPI_API_KEY);

  url.searchParams.set('hl', opts?.hl ?? env.SERPAPI_HL);
  url.searchParams.set('gl', opts?.gl ?? env.SERPAPI_GL);
  url.searchParams.set('num', String(opts?.num ?? env.SERPAPI_NUM));
  if (opts?.location ?? env.SERPAPI_LOCATION) url.searchParams.set('location', (opts?.location ?? env.SERPAPI_LOCATION)!);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SERPAPI_SEARCH_FAILED status=${res.status} body=${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as SerpApiResponse;
  const organic = json.organic_results ?? [];

  return organic
    .map((r) => ({
      title: r.title,
      link: r.link ?? '',
      snippet: r.snippet,
      date: r.date,
      source: r.source
    }))
    .filter((r) => Boolean(r.link));
}
