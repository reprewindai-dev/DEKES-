import { PrismaClient, SourcePack, TemplateType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.scoringWeights.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      intentWeight: 1.0,
      urgencyWeight: 1.0,
      budgetWeight: 1.0,
      fitWeight: 1.0
    },
    update: {}
  });

  const queries: Array<{ name: string; query: string; sourcePack?: SourcePack }> = [
    {
      name: 'Master Query (balanced)',
      query:
        '("looking for" OR "need" OR "hiring" OR "editor needed" OR "seeking") ("video editor" OR "short form editor" OR "reels editor" OR "tiktok editor" OR "podcast editor" OR "repurpose") (budget OR paid OR rate OR retainer OR asap OR deadline) -job -jobs -career -salary -apply -portfolio -"for hire" -"available for work" -upwork -fiverr -freelancer -ziprecruiter -indeed -glassdoor -greenhouse -lever',
      sourcePack: SourcePack.WIDE_WEB
    },
    {
      name: 'Agency Overflow (buyer intent)',
      query:
        '(agency OR "for my client" OR clients OR "white label") ("need" OR "looking for" OR hiring OR outsource) (editor OR "video editor" OR "short form" OR reels OR tiktok) (budget OR retainer OR paid OR deadline) -job -jobs -portfolio -"for hire" -upwork -fiverr -ziprecruiter -indeed',
      sourcePack: SourcePack.PROFESSIONAL
    },
    {
      name: 'Podcast Repurpose (buyer intent)',
      query:
        '(podcast OR episode) (repurpose OR clips OR shorts) ("looking for" OR "need" OR hiring OR outsource) (editor OR "video editor") (paid OR budget OR rate OR retainer) -job -jobs -portfolio -"for hire" -upwork -fiverr -ziprecruiter -indeed',
      sourcePack: SourcePack.FORUMS
    },
    {
      name: 'Coaches/Consultants (buyer intent)',
      query:
        '(coach OR consultant OR "online course" OR "personal brand") ("looking for" OR "need" OR hiring OR outsource) ("short form" OR reels OR tiktok OR shorts) (editor OR "video editor") (budget OR paid OR retainer) -job -jobs -portfolio -"for hire" -upwork -fiverr',
      sourcePack: SourcePack.PROFESSIONAL
    },
    {
      name: 'Ecom/UGC Ads (buyer intent)',
      query:
        '(ecommerce OR shopify OR "direct response" OR ugc OR "paid ads") ("looking for" OR "need" OR hiring OR outsource) (editor OR "video editor" OR "short form") (paid OR budget OR rate OR retainer) -job -jobs -portfolio -"for hire" -upwork -fiverr',
      sourcePack: SourcePack.WIDE_WEB
    },
    {
      name: 'Urgent / Deadline (buyer intent)',
      query:
        '(urgent OR asap OR deadline OR "this week" OR "today") ("looking for" OR "need" OR hiring) ("video editor" OR editor) (paid OR budget OR rate) -job -jobs -salary -apply -portfolio -"for hire" -upwork -fiverr -ziprecruiter -indeed',
      sourcePack: SourcePack.WIDE_WEB
    },
    {
      name: 'Community Hiring Posts (forums/social)',
      query:
        '("editor needed" OR "looking for an editor" OR "hiring" OR "need someone to edit") (shorts OR reels OR tiktok OR podcast) (paid OR budget OR rate OR $) -job -jobs -apply -portfolio -"for hire" -ziprecruiter -indeed',
      sourcePack: SourcePack.SOCIAL
    },
    {
      name: 'Specific deliverable: captions/subtitles',
      query:
        '(captions OR subtitles) ("looking for" OR "need" OR hiring OR outsource) (editor OR "video editor") (paid OR budget OR rate) -job -jobs -apply -portfolio -"for hire" -upwork -fiverr',
      sourcePack: SourcePack.WIDE_WEB
    },
    {
      name: 'Batch production / weekly clips',
      query:
        '("clips per week" OR "weekly clips" OR batch OR "turnaround") ("looking for" OR need OR hiring OR outsource) ("short form" OR reels OR tiktok OR shorts) (editor OR "video editor") (paid OR retainer OR budget) -job -jobs -portfolio -"for hire" -upwork -fiverr',
      sourcePack: SourcePack.WIDE_WEB
    }
  ];

  for (const q of queries) {
    await prisma.query.upsert({
      where: { id: q.name },
      create: {
        id: q.name,
        name: q.name,
        query: q.query,
        sourcePack: q.sourcePack ?? SourcePack.WIDE_WEB
      },
      update: {
        name: q.name,
        query: q.query,
        sourcePack: q.sourcePack ?? SourcePack.WIDE_WEB,
        enabled: true
      }
    });
  }

  const curatedIds = new Set(queries.map((q) => q.name));
  const existing = await prisma.query.findMany({ select: { id: true } });
  for (const q of existing) {
    if (q.id.startsWith('CANDIDATE:')) continue;
    if (curatedIds.has(q.id)) continue;
    await prisma.query.update({ where: { id: q.id }, data: { enabled: false } });
  }

  const templates: Array<{
    name: string;
    type: TemplateType;
    buyerType?: string;
    serviceTag?: string;
    painTag?: string;
    body: string;
  }> = [
    {
      name: 'DM_1 Generic',
      type: TemplateType.DM,
      body:
        'Hey {name} — saw your post about {pain_1}. I help turn long-form into high-retention short clips (captions + hooks). If you want, I can do a quick sample on one clip so you can judge the style.\n\nIf this is timely, what deadline are you working with?' 
    },
    {
      name: 'DM_1 Agency',
      type: TemplateType.DM,
      buyerType: 'AGENCY',
      body:
        'Hey {name} — sounds like you\'re handling client overflow ({pain_1}). I support agencies with reliable short-form editing capacity (48-hour standard / 12-hour rush).\n\nWant me to send pricing + a quick sample workflow?' 
    },
    {
      name: 'DM_1 Podcaster',
      type: TemplateType.DM,
      serviceTag: 'PODCAST_REPURPOSE',
      body:
        'Hey {name} — if you\'re repurposing podcast episodes into clips, I can take the full pipeline: selection, subtitles, hooks, and platform-ready exports.\n\nHow many clips/week are you aiming for right now?' 
    },
    {
      name: 'FU_1 Generic',
      type: TemplateType.FU,
      body:
        'Quick follow-up — still looking for help with {pain_1}? If you tell me your deadline + target platform, I can recommend a simple plan.'
    },
    {
      name: 'FU_2 Generic',
      type: TemplateType.FU,
      body:
        'Last ping — if it\'s easier, I can do a 1-clip sample first. No pressure either way. Want me to send an example?' 
    }
  ];

  for (const t of templates) {
    await prisma.template.upsert({
      where: { id: t.name },
      create: {
        id: t.name,
        name: t.name,
        type: t.type,
        buyerType: t.buyerType,
        serviceTag: t.serviceTag,
        painTag: t.painTag,
        body: t.body
      },
      update: {
        name: t.name,
        type: t.type,
        buyerType: t.buyerType,
        serviceTag: t.serviceTag,
        painTag: t.painTag,
        body: t.body,
        enabled: true
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
