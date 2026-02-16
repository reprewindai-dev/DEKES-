import crypto from 'crypto';

export type CanonicalizationResult = {
  canonicalUrl: string;
  canonicalHash: string;
  rejected: boolean;
  rejectedReason?: string;
};

const JOB_BOARD_HOSTS = new Set([
  'upwork.com',
  'www.upwork.com',
  'fiverr.com',
  'www.fiverr.com',
  'freelancer.com',
  'www.freelancer.com'
]);

function stripTrackingParams(url: URL) {
  const removePrefixes = ['utm_', 'ref', 'ref_src', 'ref_url', 'trk', 'trkInfo', 'igshid', 'fbclid'];
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (removePrefixes.some((p) => lower.startsWith(p))) url.searchParams.delete(key);
    if (lower === 's' || lower === 't') url.searchParams.delete(key); // X/Twitter common
  }
}

export function canonicalizeUrl(input: string): CanonicalizationResult {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { canonicalUrl: input, canonicalHash: sha256(input), rejected: true, rejectedReason: 'INVALID_URL' };
  }

  if (JOB_BOARD_HOSTS.has(url.hostname)) {
    return {
      canonicalUrl: url.origin + url.pathname,
      canonicalHash: sha256(url.origin + url.pathname),
      rejected: true,
      rejectedReason: 'JOB_BOARD'
    };
  }

  stripTrackingParams(url);

  // Reddit canonicalization
  if (url.hostname.endsWith('reddit.com')) {
    const match = url.pathname.match(/\/comments\/([a-z0-9]+)(?:\/[^/]+)?/i);
    if (match) {
      const canonical = `https://reddit.com/comments/${match[1]}`;
      return { canonicalUrl: canonical, canonicalHash: sha256(canonical), rejected: false };
    }
  }

  // Twitter/X canonicalization
  if (url.hostname.endsWith('twitter.com') || url.hostname.endsWith('x.com')) {
    url.hostname = 'x.com';
    const m = url.pathname.match(/\/(\w+)\/status\/(\d+)/);
    if (m) {
      const canonical = `https://x.com/${m[1]}/status/${m[2]}`;
      return { canonicalUrl: canonical, canonicalHash: sha256(canonical), rejected: false };
    }
  }

  // LinkedIn canonicalization
  if (url.hostname.endsWith('linkedin.com')) {
    // keep path, remove query
    const canonical = `${url.origin}${url.pathname}`;
    return { canonicalUrl: canonical, canonicalHash: sha256(canonical), rejected: false };
  }

  // Default
  url.hash = '';
  const canonical = `${url.origin}${url.pathname}${url.search}`;
  return { canonicalUrl: canonical, canonicalHash: sha256(canonical), rejected: false };
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
