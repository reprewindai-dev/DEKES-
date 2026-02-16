import 'dotenv/config';
import { z } from 'zod';

function emptyToUndefined(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),

  BING_ENDPOINT: z.preprocess(emptyToUndefined, z.string().url().optional()),
  BING_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),

  SERPAPI_API_KEY: z.string().min(1),
  SERPAPI_LOCATION: z.string().optional(),
  SERPAPI_LOCATIONS: z.string().optional(),
  SERPAPI_GL: z.string().default('us'),
  SERPAPI_HL: z.string().default('en'),
  SERPAPI_NUM: z.coerce.number().int().positive().default(10),

  DASHBOARD_PORT: z.coerce.number().int().positive().optional(),

  SEKED_MARKET: z.string().default('en-US'),
  SEKED_FRESHNESS: z.enum(['Day', 'Week', 'Month', 'Year']).default('Week'),
  SEKED_MAX_RESULTS_PER_QUERY: z.coerce.number().int().positive().default(10),
  SEKED_MAX_RUN_QUERIES: z.coerce.number().int().positive().default(5),
  SEKED_MIN_SCORE_QUALIFIED: z.coerce.number().int().min(0).max(100).default(70),

  ORDER_PAGE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  UTM_SOURCE_DEFAULT: z.string().default('seked'),
  UTM_MEDIUM_DEFAULT: z.string().default('dm'),
  UTM_CAMPAIGN_DEFAULT: z.string().default('lead-operator')
});

export const env = envSchema.parse(process.env);
export type Env = typeof env;
