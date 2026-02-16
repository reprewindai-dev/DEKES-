import { env } from './env.js';
import { prisma } from './db.js';
import { unifiedSearch } from '../lib/search-provider.js';
import { canonicalizeUrl } from '../lib/url-canonicalization.js';
import { scoreLead } from '../lib/scoring-engine.js';
import { pickTemplateWithPropensity, renderTemplate } from '../lib/template-generation.js';
import { updateWeights } from '../lib/learning-loop.js';
import { computeIps } from '../lib/counterfactual-learning.js';
import { generateQuerySuggestions } from '../lib/query-expansion.js';
import { rejectJobLead } from '../lib/lead-safety.js';
import { enrichLead } from '../lib/page-enrichment.js';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function argNumber(name: string, fallback: number): number {
  const v = arg(name);
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function parseLocations(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickLocation(locations: string[], seed: string): string | undefined {
  if (!locations.length) return undefined;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return locations[h % locations.length];
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'outcome') {
    await recordOutcome();
    return;
  }

  if (mode === 'propose-queries') {
    await proposeQueries();
    return;
  }

  const limitQueries = argNumber('limitQueries', env.SEKED_MAX_RUN_QUERIES);
  const minScore = argNumber('minScore', env.SEKED_MIN_SCORE_QUALIFIED);
  const printLimit = argNumber('printLimit', 20);

  const weightsRow = await prisma.scoringWeights.findFirst({ orderBy: { updatedAt: 'desc' } });
  const weights = {
    intentWeight: weightsRow?.intentWeight ?? 1,
    urgencyWeight: weightsRow?.urgencyWeight ?? 1,
    budgetWeight: weightsRow?.budgetWeight ?? 1,
    fitWeight: weightsRow?.fitWeight ?? 1
  };

  const settings = await prisma.settings.findFirst();

  const allQueries = await prisma.query.findMany({ where: { enabled: true } });
  const picked = pickQueriesWithPropensity(allQueries, limitQueries);
  const queries = picked.map((p) => p.query);
  if (queries.length === 0) throw new Error('NO_ENABLED_QUERIES');

  const templates = await prisma.template.findMany({ where: { enabled: true } });

  const geoLocations = parseLocations(env.SERPAPI_LOCATIONS);

  const overall = {
    queriesRun: 0,
    fetched: 0,
    rejectedJob: 0,
    rejectedCanonical: 0,
    blockedDomain: 0,
    blockedKeyword: 0,
    rejectedIntent: 0,
    upserted: 0,
    qualified: 0,
    review: 0
  };

  for (const q of queries) {
    const queryProb = picked.find((p) => p.query.id === q.id)?.queryProb ?? 1;

    const chosenLocation = pickLocation(geoLocations, q.id) ?? env.SERPAPI_LOCATION;
    const run = await prisma.run.create({
      data: {
        queryId: q.id,
        geoLocation: chosenLocation,
        geoGl: env.SERPAPI_GL,
        geoHl: env.SERPAPI_HL
      } as any
    });

    const stats = {
      queryId: q.id,
      fetched: 0,
      rejectedJob: 0,
      rejectedCanonical: 0,
      blockedDomain: 0,
      blockedKeyword: 0,
      rejectedIntent: 0,
      upserted: 0,
      qualified: 0,
      review: 0
    };

    try {
      const results = await unifiedSearch(q.query, {
        num: env.SEKED_MAX_RESULTS_PER_QUERY,
        gl: env.SERPAPI_GL,
        hl: env.SERPAPI_HL,
        location: chosenLocation
      });

      stats.fetched += results.length;
      overall.fetched += results.length;

      let leadCount = 0;
      let qualifiedCount = 0;

      for (const r of results) {
        const rejectedJob = rejectJobLead({ url: r.link, title: r.title, snippet: r.snippet });
        if (rejectedJob.rejected) {
          stats.rejectedJob++;
          overall.rejectedJob++;
          continue;
        }

        const breakdown = scoreLead({ title: r.title, snippet: r.snippet }, weights);
        const enrichment = await enrichLead(r.link, r.title, r.snippet, breakdown.score);

        const can = canonicalizeUrl(r.link);
        if (can.rejected) {
          stats.rejectedCanonical++;
          overall.rejectedCanonical++;
          continue;
        }

        const domain = safeDomain(can.canonicalUrl);
        if (domain && settings?.blocklistDomains?.includes(domain)) {
          stats.blockedDomain++;
          overall.blockedDomain++;
          continue;
        }

        const rawText = `${r.title ?? ''}\n${r.snippet ?? ''}`.toLowerCase();
        if (settings?.blocklistKeywords?.some((k: string) => rawText.includes(k.toLowerCase()))) {
          stats.blockedKeyword++;
          overall.blockedKeyword++;
          continue;
        }

        const verdict = enrichment.verdict;
        const intentOk = verdict?.intentClass === 'BUYER' && (verdict?.confidence ?? 0) >= 0.45;
        const isSeller = verdict?.intentClass === 'SELLER' && (verdict?.confidence ?? 0) >= 0.45;
        const proofOk = Boolean(verdict?.proofOk);
        const roleMismatch = Boolean(verdict?.roleMismatch);

        const highScore = breakdown.score >= Math.max(70, minScore + 10);
        const reviewOk = !isSeller && highScore;

        const readyOk = intentOk && proofOk && !roleMismatch && breakdown.score >= minScore;
        const status = readyOk ? 'OUTREACH_READY' : reviewOk ? 'REVIEW' : 'REJECTED';

        if (status === 'REJECTED' && breakdown.score >= minScore && (!intentOk || !proofOk || roleMismatch)) {
          stats.rejectedIntent++;
          overall.rejectedIntent++;
        }

        const entityId = domain
          ? (
              await prisma.entity.upsert({
                where: { primaryDomain: domain },
                create: {
                  type: 'COMPANY',
                  primaryDomain: domain,
                  domains: [domain],
                  handles: {}
                },
                update: {
                  primaryDomain: domain,
                  domains: { push: domain }
                },
                select: { id: true }
              })
            ).id
          : undefined;

        const created = await prisma.lead.upsert({
          where: { canonicalHash: can.canonicalHash },
          create: {
            source: 'SERPAPI',
            sourceUrl: r.link,
            canonicalUrl: can.canonicalUrl,
            canonicalHash: can.canonicalHash,
            title: r.title,
            snippet: r.snippet,
            publishedAt: r.date ? new Date(r.date) : undefined,
            score: breakdown.score,
            intentDepth: breakdown.intentDepth,
            urgencyVelocity: breakdown.urgencyVelocity,
            budgetSignals: breakdown.budgetSignals,
            fitPrecision: breakdown.fitPrecision,
            buyerType: breakdown.buyerType,
            painTags: breakdown.painTags,
            serviceTags: breakdown.serviceTags,
            rush12HourEligible: breakdown.rush12HourEligible,
            intentClass: enrichment.verdict?.intentClass,
            intentConfidence: enrichment.verdict?.confidence,
            meta: {
              proof: enrichment.verdict?.proofLines ?? [],
              buyerScore: enrichment.verdict?.buyerScore,
              sellerScore: enrichment.verdict?.sellerScore,
              intentReasons: enrichment.verdict?.reasons ?? [],
              emails: enrichment.emails,
              socials: enrichment.socials
            },
            status: status as any,
            rejectedReason:
              status === 'REJECTED'
                ? breakdown.score >= minScore
                  ? roleMismatch
                    ? 'ROLE_MISMATCH'
                    : 'INTENT_NOT_BUYER'
                  : 'LOW_SCORE'
                : null,
            entityId: entityId ?? null,
            queryId: q.id,
            runId: run.id
          } as any,
          update: {
            title: r.title,
            snippet: r.snippet,
            score: breakdown.score,
            intentDepth: breakdown.intentDepth,
            urgencyVelocity: breakdown.urgencyVelocity,
            budgetSignals: breakdown.budgetSignals,
            fitPrecision: breakdown.fitPrecision,
            buyerType: breakdown.buyerType,
            painTags: breakdown.painTags,
            serviceTags: breakdown.serviceTags,
            rush12HourEligible: breakdown.rush12HourEligible,
            intentClass: enrichment.verdict?.intentClass,
            intentConfidence: enrichment.verdict?.confidence,
            meta: {
              proof: enrichment.verdict?.proofLines ?? [],
              buyerScore: enrichment.verdict?.buyerScore,
              sellerScore: enrichment.verdict?.sellerScore,
              intentReasons: enrichment.verdict?.reasons ?? [],
              emails: enrichment.emails,
              socials: enrichment.socials
            },
            status: status as any,
            rejectedReason:
              status === 'REJECTED'
                ? breakdown.score >= minScore
                  ? roleMismatch
                    ? 'ROLE_MISMATCH'
                    : 'INTENT_NOT_BUYER'
                  : 'LOW_SCORE'
                : null,
            entityId: entityId ?? null,
            queryId: q.id,
            runId: run.id
          } as any
        });

        leadCount++;
        stats.upserted++;
        overall.upserted++;
        if (created.status === 'OUTREACH_READY') qualifiedCount++;

        if (created.status === 'OUTREACH_READY') {
          stats.qualified++;
          overall.qualified++;
        }

        if ((created.status as any) === 'REVIEW') {
          stats.review++;
          overall.review++;
        }

        await prisma.leadEvent.create({
          data: {
            leadId: created.id,
            type: created.status === 'OUTREACH_READY' ? 'QUALIFIED' : created.status === 'REVIEW' ? 'UPDATED' : 'REJECTED',
            meta: {
              weights,
              breakdown
            }
          }
        });
      }

      await prisma.run.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          resultCount: results.length,
          leadCount,
          qualifiedCount,
          status: 'FINISHED'
        }
      });

      await prisma.query.update({
        where: { id: q.id },
        data: {
          runsCount: { increment: 1 },
          leadsCount: { increment: leadCount },
          qualifiedCount: { increment: qualifiedCount },
          lastRunAt: new Date(),
          enabled:
            q.runsCount + 1 >= 20 && q.wonCount / Math.max(1, q.runsCount + 1) < 0.05 ? false : q.enabled
        }
      });

      overall.queriesRun++;
      console.log(
        `query_summary id=${stats.queryId} fetched=${stats.fetched} rejectedJob=${stats.rejectedJob} rejectedCanonical=${stats.rejectedCanonical} blockedDomain=${stats.blockedDomain} blockedKeyword=${stats.blockedKeyword} rejectedIntent=${stats.rejectedIntent} upserted=${stats.upserted} qualified=${stats.qualified} review=${stats.review}`
      );
    } catch (e: any) {
      await prisma.run.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), status: 'FAILED', error: String(e?.message ?? e) }
      });
    }
  }

  console.log(
    `overall_summary queriesRun=${overall.queriesRun} fetched=${overall.fetched} rejectedJob=${overall.rejectedJob} rejectedCanonical=${overall.rejectedCanonical} blockedDomain=${overall.blockedDomain} blockedKeyword=${overall.blockedKeyword} rejectedIntent=${overall.rejectedIntent} upserted=${overall.upserted} qualified=${overall.qualified} review=${overall.review}`
  );

  await sanitizeOutreachReadyLeads();

  const leads = await prisma.lead.findMany({
    where: { status: { in: ['OUTREACH_READY', 'REVIEW'] } },
    orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    take: printLimit
  });

  for (const lead of leads) {
    const leadQueryProb = lead.queryId
      ? picked.find((p) => p.query.id === lead.queryId)?.queryProb ?? 1
      : 1;

    const ctx = {
      buyerType: lead.buyerType ?? undefined,
      painTags: lead.painTags,
      serviceTags: lead.serviceTags,
      name: 'there',
      orderPageUrl: settings?.orderPageUrl ?? env.ORDER_PAGE_URL,
      utm: {
        source: settings?.utmSourceDefault ?? env.UTM_SOURCE_DEFAULT,
        medium: settings?.utmMediumDefault ?? env.UTM_MEDIUM_DEFAULT,
        campaign: settings?.utmCampaignDefault ?? env.UTM_CAMPAIGN_DEFAULT
      }
    };

    const { template, templateProb } = pickTemplateWithPropensity(templates as any, ctx);
    const message = renderTemplate(template.body, ctx);

    console.log('---');
    console.log(`status=${lead.status} score=${lead.score} url=${lead.canonicalUrl}`);
    console.log(`title=${lead.title ?? ''}`);
    console.log(message);

    if (lead.status !== 'OUTREACH_READY') continue;

    await prisma.template.update({ where: { id: template.id }, data: { timesSent: { increment: 1 } } });

    const overallProb = leadQueryProb * templateProb;
    await prisma.outreachAttempt.create({
      data: {
        leadId: lead.id,
        queryId: lead.queryId,
        templateId: template.id,
        queryProb: leadQueryProb,
        templateProb,
        overallProb,
        meta: {
          leadScore: lead.score,
          buyerType: lead.buyerType,
          painTags: lead.painTags,
          serviceTags: lead.serviceTags
        }
      }
    });

    await prisma.leadEvent.create({
      data: {
        leadId: lead.id,
        type: 'TEMPLATE_SENT',
        meta: { templateId: template.id }
      }
    });
  }
}

async function recordOutcome(): Promise<void> {
  const leadId = arg('leadId');
  const attemptId = arg('attemptId');
  const outcomeRaw = arg('result');
  if (!outcomeRaw || (outcomeRaw !== 'WON' && outcomeRaw !== 'LOST')) throw new Error('INVALID_RESULT');

  const outcome = outcomeRaw as 'WON' | 'LOST';

  const attempt = attemptId
    ? await prisma.outreachAttempt.findUnique({ where: { id: attemptId } })
    : leadId
      ? await prisma.outreachAttempt.findFirst({ where: { leadId }, orderBy: { createdAt: 'desc' } })
      : null;

  if (!attempt) throw new Error('ATTEMPT_NOT_FOUND');

  await prisma.outreachAttempt.update({
    where: { id: attempt.id },
    data: { outcome, outcomeAt: new Date() }
  });

  const lead = await prisma.lead.findUnique({ where: { id: attempt.leadId } });
  if (!lead) throw new Error('LEAD_NOT_FOUND');

  const status = outcome === 'WON' ? 'WON' : 'LOST';
  await prisma.lead.update({ where: { id: lead.id }, data: { status: status as any } });
  await prisma.leadEvent.create({ data: { leadId: lead.id, type: status as any, meta: { attemptId: attempt.id } } });

  const ips = computeIps(outcome, attempt.overallProb);

  if (attempt.queryId) {
    await prisma.query.update({
      where: { id: attempt.queryId },
      data: {
        ipsRewardSum: { increment: ips.reward * ips.weight },
        ipsWeightSum: { increment: ips.weight },
        wonCount: outcome === 'WON' ? { increment: 1 } : undefined,
        lostCount: outcome === 'LOST' ? { increment: 1 } : undefined,
        lastWinAt: outcome === 'WON' ? new Date() : undefined
      }
    });
  }

  if (attempt.templateId) {
    await prisma.template.update({
      where: { id: attempt.templateId },
      data: {
        ipsRewardSum: { increment: ips.reward * ips.weight },
        ipsWeightSum: { increment: ips.weight },
        wonCount: outcome === 'WON' ? { increment: 1 } : undefined
      }
    });
  }

  const weightsRow = await prisma.scoringWeights.findFirst({ orderBy: { updatedAt: 'desc' } });
  if (weightsRow) {
    const next = updateWeights(
      {
        intentWeight: weightsRow.intentWeight,
        urgencyWeight: weightsRow.urgencyWeight,
        budgetWeight: weightsRow.budgetWeight,
        fitWeight: weightsRow.fitWeight
      },
      {
        intentDepth: lead.intentDepth,
        urgencyVelocity: lead.urgencyVelocity,
        budgetSignals: lead.budgetSignals,
        fitPrecision: lead.fitPrecision
      },
      outcome
    );

    await prisma.scoringWeights.create({ data: next });
  }

  console.log(`recorded outcome=${outcome} leadId=${lead.id} attemptId=${attempt.id}`);
}

function totalTrials(queries: Array<{ runsCount: number }>): number {
  return queries.reduce((sum, q) => sum + Math.max(0, q.runsCount), 0);
}

function ucb1(input: { wins: number; trials: number; totalTrials: number }): number {
  const { wins, trials, totalTrials } = input;
  if (trials <= 0) return 1;
  const mean = wins / Math.max(1, trials);
  const explore = Math.sqrt((2 * Math.log(Math.max(2, totalTrials))) / trials);
  return mean + explore;
}

function safeDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return undefined;
  }
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function pickQueriesWithPropensity<T extends { id: string; wonCount: number; runsCount: number }>(
  allQueries: T[],
  k: number
): Array<{ query: T; queryProb: number }> {
  const remaining = [...allQueries];
  const picked: Array<{ query: T; queryProb: number }> = [];

  const total = totalTrials(remaining);
  while (picked.length < Math.min(k, remaining.length)) {
    const scored = remaining.map((q) => ucb1({ wins: q.wonCount, trials: q.runsCount, totalTrials: Math.max(1, total) }));
    const probs = softmax(scored);
    const idx = sampleIndex(probs);
    picked.push({ query: remaining[idx], queryProb: probs[idx] });
    remaining.splice(idx, 1);
  }

  return picked;
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

async function sanitizeOutreachReadyLeads(): Promise<void> {
  const candidates = await prisma.lead.findMany({
    where: { status: 'OUTREACH_READY' as any },
    select: ({ id: true, canonicalUrl: true, title: true, snippet: true, intentClass: true, intentConfidence: true } as any)
  });

  for (const lead of candidates as any[]) {
    const rej = rejectJobLead({ url: String(lead.canonicalUrl), title: lead.title ?? undefined, snippet: lead.snippet ?? undefined });
    if (!rej.rejected) continue;

    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: 'REJECTED' as any, rejectedReason: rej.reason }
    });

    await prisma.leadEvent.create({
      data: { leadId: lead.id, type: 'REJECTED', meta: { reason: rej.reason, source: 'SANITIZE' } }
    });
  }

  for (const lead of candidates as any[]) {
    const ok = lead.intentClass === 'BUYER' && (lead.intentConfidence ?? 0) >= 0.45;
    if (ok) continue;

    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: 'REJECTED' as any, rejectedReason: 'INTENT_NOT_BUYER' }
    });

    await prisma.leadEvent.create({
      data: { leadId: lead.id, type: 'REJECTED', meta: { reason: 'INTENT_NOT_BUYER', source: 'SANITIZE' } }
    });
  }
}

async function proposeQueries(): Promise<void> {
  const topDomainsRows = await prisma.entity.findMany({
    where: { type: 'COMPANY', primaryDomain: { not: null } },
    select: { primaryDomain: true },
    take: 50,
    orderBy: { updatedAt: 'desc' }
  });

  const topDomains = topDomainsRows
    .map((r: (typeof topDomainsRows)[number]) => r.primaryDomain!)
    .filter((d: string | null): d is string => Boolean(d));

  const patterns = await prisma.conversionPattern.findMany({ take: 100, orderBy: { updatedAt: 'desc' } });
  const topPatterns = patterns
    .map((p: (typeof patterns)[number]) => ({
      key: p.key,
      winRate: p.wins / Math.max(1, p.wins + p.losses)
    }))
    .sort((a: { winRate: number }, b: { winRate: number }) => b.winRate - a.winRate)
    .slice(0, 25);

  const suggestions = generateQuerySuggestions({ topDomains, topPatterns });

  let created = 0;
  for (const s of suggestions.slice(0, 30)) {
    const id = `CANDIDATE:${s.name}`;
    const existing = await prisma.query.findUnique({ where: { id } });
    if (existing) continue;

    await prisma.query.create({
      data: {
        id,
        name: s.name,
        query: s.query,
        enabled: false,
        sourcePack: (s.sourcePack as any) ?? 'WIDE_WEB'
      }
    });
    created++;
  }

  console.log(`proposed_queries_created=${created} suggestions_considered=${Math.min(30, suggestions.length)}`);
}

main().finally(async () => {
  await prisma.$disconnect();
});
