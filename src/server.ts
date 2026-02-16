import express from 'express';
import { prisma } from './db.js';
import { env } from './env.js';
import { computeIps } from '../lib/counterfactual-learning.js';
import { updateWeights } from '../lib/learning-loop.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = env.DASHBOARD_PORT ?? 8787;

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function badge(text: string, tone: 'green' | 'red' | 'amber' | 'slate'): string {
  const map: Record<typeof tone, string> = {
    green: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25',
    red: 'bg-rose-500/15 text-rose-300 ring-rose-500/25',
    amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/25',
    slate: 'bg-slate-500/15 text-slate-300 ring-slate-500/25'
  };
  return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${map[tone]}">${escapeHtml(text)}</span>`;
}

app.get('/', async (req, res) => {
  const minScore = Number(req.query.minScore ?? 0);
  const intent = String(req.query.intent ?? 'BUYER');
  const status = String(req.query.status ?? 'ACTIVE');
  const limit = Math.min(200, Math.max(10, Number(req.query.limit ?? 50)));

  const statusFilter =
    status === 'ACTIVE'
      ? ({ in: ['OUTREACH_READY', 'REVIEW'] } as any)
      : status === 'OUTREACH_READY'
        ? ('OUTREACH_READY' as any)
        : status === 'REVIEW'
          ? ('REVIEW' as any)
          : (status as any);

  const leads = await prisma.lead.findMany({
    where: {
      score: { gte: minScore },
      status: statusFilter,
      ...(intent === 'ANY' ? {} : { intentClass: intent })
    },
    orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 }, query: true }
  });

  const totals = await prisma.lead.groupBy({
    by: ['status'],
    _count: { _all: true }
  });

  const statusCounts: Record<string, number> = {};
  for (const t of totals) statusCounts[t.status] = t._count._all;

  const cards = leads
    .map((l) => {
      const meta = (l.meta as any) ?? {};
      const proof: string[] = Array.isArray(meta.proof) ? meta.proof : [];
      const emails: string[] = Array.isArray(meta.emails) ? meta.emails : [];
      const socials: Array<{ platform: string; url: string }> = Array.isArray(meta.socials) ? meta.socials : [];

      const attempt = l.attempts[0];
      const attemptId = attempt?.id;

      const intentTone = l.intentClass === 'BUYER' ? 'green' : l.intentClass === 'SELLER' ? 'red' : 'amber';
      const conf = l.intentConfidence != null ? `${Math.round(l.intentConfidence * 100)}%` : '—';

      const actions = attemptId
        ? `
          <div class="flex gap-2">
            <form method="post" action="/outcome" class="inline">
              <input type="hidden" name="attemptId" value="${escapeHtml(attemptId)}" />
              <input type="hidden" name="result" value="WON" />
              <button class="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-emerald-400">WON</button>
            </form>
            <form method="post" action="/outcome" class="inline">
              <input type="hidden" name="attemptId" value="${escapeHtml(attemptId)}" />
              <input type="hidden" name="result" value="LOST" />
              <button class="rounded-md bg-rose-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-400">LOST</button>
            </form>
          </div>
        `
        : `<div class="text-xs text-slate-400">No attempt logged yet</div>`;

      return `
        <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <div class="text-sm font-semibold text-slate-100">score=${l.score}</div>
                ${badge(l.intentClass ?? 'AMBIGUOUS', intentTone)}
                ${badge(`conf ${conf}`, 'slate')}
                ${l.query?.name ? badge(l.query.name, 'slate') : ''}
              </div>
              <div class="mt-2 text-sm text-slate-200">${escapeHtml(l.title ?? '(no title)')}</div>
              <div class="mt-2 break-all text-xs text-slate-400"><a class="hover:underline" href="${escapeHtml(l.canonicalUrl)}" target="_blank" rel="noreferrer">${escapeHtml(l.canonicalUrl)}</a></div>
              ${l.snippet ? `<div class="mt-3 text-sm text-slate-300">${escapeHtml(l.snippet)}</div>` : ''}
            </div>
            <div class="shrink-0">${actions}</div>
          </div>

          <div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div class="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <div class="text-xs font-semibold text-slate-300">Proof</div>
              <div class="mt-2 space-y-2 text-sm text-slate-200">
                ${proof.length ? proof.map((p) => `<div class="rounded-md bg-slate-900 p-2">${escapeHtml(p)}</div>`).join('') : `<div class="text-xs text-slate-500">No proof lines extracted yet</div>`}
              </div>
            </div>

            <div class="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <div class="text-xs font-semibold text-slate-300">Contacts</div>
              <div class="mt-2 space-y-2 text-sm text-slate-200">
                ${emails.length ? emails.map((e) => `<div><a class="hover:underline" href="mailto:${escapeHtml(e)}">${escapeHtml(e)}</a></div>`).join('') : `<div class="text-xs text-slate-500">No emails extracted</div>`}
              </div>
            </div>

            <div class="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <div class="text-xs font-semibold text-slate-300">Socials</div>
              <div class="mt-2 space-y-2 text-sm text-slate-200">
                ${socials.length ? socials.map((s) => `<div>${badge(s.platform, 'slate')} <a class="hover:underline break-all" href="${escapeHtml(s.url)}" target="_blank" rel="noreferrer">${escapeHtml(s.url)}</a></div>`).join('') : `<div class="text-xs text-slate-500">No socials extracted</div>`}
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join('\n');

  res.type('html').send(`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SEKED Lead Operator</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-slate-950 text-slate-100">
  <div class="mx-auto max-w-6xl px-4 py-8">
    <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div class="text-2xl font-bold tracking-tight">SEKED Lead Operator</div>
        <div class="mt-1 text-sm text-slate-400">Validated buyer-intent leads with proof + contacts + feedback loop</div>
      </div>

      <form class="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4" method="get" action="/">
        <label class="text-xs text-slate-300">
          <div>Status</div>
          <select name="status" class="mt-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
            <option value="ACTIVE" ${status === 'ACTIVE' ? 'selected' : ''}>ACTIVE (Ready + Review)</option>
            <option value="OUTREACH_READY" ${status === 'OUTREACH_READY' ? 'selected' : ''}>OUTREACH_READY</option>
            <option value="REVIEW" ${status === 'REVIEW' ? 'selected' : ''}>REVIEW</option>
            <option value="REJECTED" ${status === 'REJECTED' ? 'selected' : ''}>REJECTED</option>
            <option value="WON" ${status === 'WON' ? 'selected' : ''}>WON</option>
            <option value="LOST" ${status === 'LOST' ? 'selected' : ''}>LOST</option>
          </select>
        </label>

        <label class="text-xs text-slate-300">
          <div>Intent</div>
          <select name="intent" class="mt-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
            <option value="BUYER" ${intent === 'BUYER' ? 'selected' : ''}>BUYER</option>
            <option value="AMBIGUOUS" ${intent === 'AMBIGUOUS' ? 'selected' : ''}>AMBIGUOUS</option>
            <option value="SELLER" ${intent === 'SELLER' ? 'selected' : ''}>SELLER</option>
            <option value="ANY" ${intent === 'ANY' ? 'selected' : ''}>ANY</option>
          </select>
        </label>

        <label class="text-xs text-slate-300">
          <div>Min score</div>
          <input name="minScore" value="${escapeHtml(String(minScore))}" class="mt-1 w-24 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
        </label>

        <label class="text-xs text-slate-300">
          <div>Limit</div>
          <input name="limit" value="${escapeHtml(String(limit))}" class="mt-1 w-24 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
        </label>

        <button class="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400">Refresh</button>
      </form>
    </div>

    <div class="mt-6 flex flex-wrap items-center gap-2">
      ${badge(`OUTREACH_READY ${statusCounts['OUTREACH_READY'] ?? 0}`, 'green')}
      ${badge(`REVIEW ${statusCounts['REVIEW'] ?? 0}`, 'amber')}
      ${badge(`REJECTED ${statusCounts['REJECTED'] ?? 0}`, 'slate')}
      ${badge(`WON ${statusCounts['WON'] ?? 0}`, 'green')}
      ${badge(`LOST ${statusCounts['LOST'] ?? 0}`, 'red')}
    </div>

    <div class="mt-6 grid grid-cols-1 gap-4">
      ${cards || `<div class="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-slate-300">No leads match the current filter.</div>`}
    </div>

    <div class="mt-8 text-xs text-slate-500">Dashboard running on port ${PORT}. Use <code class="text-slate-300">npm run run</code> to generate leads.</div>
  </div>
</body>
</html>
  `);
});

app.post('/outcome', async (req, res) => {
  const attemptId = String(req.body.attemptId ?? '');
  const result = String(req.body.result ?? '');
  if (!attemptId) return res.status(400).send('attemptId required');
  if (result !== 'WON' && result !== 'LOST') return res.status(400).send('result must be WON or LOST');

  const attempt = await prisma.outreachAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt) return res.status(404).send('Attempt not found');

  await prisma.outreachAttempt.update({
    where: { id: attempt.id },
    data: { outcome: result, outcomeAt: new Date() }
  });

  const lead = await prisma.lead.findUnique({ where: { id: attempt.leadId } });
  if (!lead) return res.status(404).send('Lead not found');

  await prisma.lead.update({ where: { id: attempt.leadId }, data: { status: result as any } });
  await prisma.leadEvent.create({
    data: { leadId: attempt.leadId, type: result as any, meta: { attemptId: attempt.id, via: 'DASHBOARD' } }
  });

  const ips = computeIps(result as any, attempt.overallProb);

  if (attempt.queryId) {
    await prisma.query.update({
      where: { id: attempt.queryId },
      data: {
        ipsRewardSum: { increment: ips.reward * ips.weight },
        ipsWeightSum: { increment: ips.weight },
        wonCount: result === 'WON' ? { increment: 1 } : undefined,
        lostCount: result === 'LOST' ? { increment: 1 } : undefined,
        lastWinAt: result === 'WON' ? new Date() : undefined
      }
    });
  }

  if (attempt.templateId) {
    await prisma.template.update({
      where: { id: attempt.templateId },
      data: {
        ipsRewardSum: { increment: ips.reward * ips.weight },
        ipsWeightSum: { increment: ips.weight },
        wonCount: result === 'WON' ? { increment: 1 } : undefined
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
      result as any
    );

    await prisma.scoringWeights.create({ data: next });
  }

  res.redirect('/');
});

app.get('/api/runs', async (_req, res) => {
  const runs = await prisma.run.findMany({ orderBy: { createdAt: 'desc' }, take: 50, include: { query: true } });
  res.json(runs);
});

app.get('/api/leads', async (req, res) => {
  const status = String(req.query.status ?? 'OUTREACH_READY');
  const limit = Math.min(500, Math.max(10, Number(req.query.limit ?? 100)));
  const leads = await prisma.lead.findMany({ where: { status: status as any }, orderBy: { createdAt: 'desc' }, take: limit });
  res.json(leads);
});

app.listen(PORT, () => {
  console.log(`dashboard listening on http://localhost:${PORT}`);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
