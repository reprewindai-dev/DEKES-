export type LeadRejection = { rejected: true; reason: string } | { rejected: false };

const JOB_HOSTS = new Set([
  'linkedin.com',
  'www.linkedin.com',
  'ziprecruiter.com',
  'www.ziprecruiter.com',
  'monster.com',
  'www.monster.com',
  'careerbuilder.com',
  'www.careerbuilder.com',
  'simplyhired.com',
  'www.simplyhired.com',
  'jobrapido.com',
  'www.jobrapido.com',
  'jooble.org',
  'www.jooble.org',
  'indeed.com',
  'www.indeed.com',
  'glassdoor.com',
  'www.glassdoor.com',
  'greenhouse.io',
  'boards.greenhouse.io',
  'lever.co',
  'jobs.lever.co',
  'workable.com',
  'jobs.workable.com',
  'ashbyhq.com',
  'jobs.ashbyhq.com'
]);

const JOB_PATH_HINTS = [
  '/jobs',
  '/job',
  '/careers',
  '/career',
  '/hiring',
  '/recruit',
  '/talent'
];

const JOB_TEXT_HINTS = [
  'apply now',
  'job description',
  'full-time',
  'part-time',
  'salary',
  'compensation',
  'requirements',
  'responsibilities',
  'equal opportunity employer'
];

const INFO_INTENT_HINTS = [
  'how to find',
  'how to hire',
  'guide to hiring',
  'tips for hiring',
  'where to find',
  'best way to hire',
  'when to hire',
  'what to look for',
  'how much does it cost',
  'pricing guide'
];

const INFO_HOSTS = new Set(['youtube.com', 'www.youtube.com']);

const BUYER_INTENT_HINTS = [
  'looking for',
  'need an editor',
  'need editor',
  'need a video editor',
  'editor needed',
  'hiring',
  'hire',
  'seeking',
  'anyone recommend',
  'recommend an editor',
  'can someone edit',
  'need someone to edit',
  'looking to outsource',
  'outsourcing',
  'budget'
];

const EDITING_ROLE_HINTS = [
  'editor',
  'video editor',
  'shorts editor',
  'reels editor',
  'tiktok editor',
  'podcast editor',
  'post production',
  'capcut',
  'premiere',
  'after effects'
];

const NON_EDITING_ROLE_HINTS = [
  'affiliate',
  'growth specialist',
  'media buyer',
  'ads manager',
  'appointment setter',
  'setter',
  'closer',
  'virtual assistant',
  'va',
  'social media manager',
  'smm',
  'community manager',
  'brand ambassador',
  'ugc creator',
  'content creator',
  'thumbnail designer',
  'scriptwriter',
  'copywriter'
];

const SELLER_INTENT_HINTS = [
  'for hire',
  'available for work',
  'available for hire',
  'open for work',
  'my services',
  'i offer',
  'i can edit',
  'dm me',
  'message me',
  'contact me',
  'portfolio',
  'showreel',
  'reel available',
  'rates start',
  'starting at $',
  'book a call'
];

const SELLER_HOSTS = new Set([
  'behance.net',
  'www.behance.net',
  'dribbble.com',
  'www.dribbble.com',
  'upwork.com',
  'www.upwork.com',
  'fiverr.com',
  'www.fiverr.com'
]);

export function rejectJobLead(input: { url: string; title?: string; snippet?: string }): LeadRejection {
  let u: URL;
  try {
    u = new URL(input.url);
  } catch {
    return { rejected: false };
  }

  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();

  if (JOB_HOSTS.has(host)) {
    if (host.includes('linkedin.com') && path.startsWith('/jobs')) return { rejected: true, reason: 'JOB_BOARD' };
    if (JOB_PATH_HINTS.some((p) => path.includes(p))) return { rejected: true, reason: 'JOB_BOARD' };
    return { rejected: true, reason: 'JOB_BOARD' };
  }

  const text = `${input.title ?? ''}\n${input.snippet ?? ''}`.toLowerCase();
  if (JOB_TEXT_HINTS.some((h) => text.includes(h))) return { rejected: true, reason: 'JOB_TEXT' };

  const buyer = BUYER_INTENT_HINTS.some((h) => text.includes(h));
  const editingRole = EDITING_ROLE_HINTS.some((h) => text.includes(h));
  const informational = INFO_INTENT_HINTS.some((h) => text.includes(h));

  if ((INFO_HOSTS.has(host) || informational) && !(buyer && editingRole)) {
    return { rejected: true, reason: 'INFORMATIONAL' };
  }

  if (SELLER_HOSTS.has(host)) return { rejected: true, reason: 'SELLER_PLATFORM' };

  const seller = SELLER_INTENT_HINTS.some((h) => text.includes(h));
  if (seller && !buyer) return { rejected: true, reason: 'SELLER_INTENT' };

  const hiringish = /\bhiring\b|\bhire\b|\blooking for\b|\bseeking\b/.test(text);
  const nonEditingRole = NON_EDITING_ROLE_HINTS.some((h) => text.includes(h));
  if (hiringish && nonEditingRole && !editingRole) return { rejected: true, reason: 'ROLE_MISMATCH' };

  return { rejected: false };
}
