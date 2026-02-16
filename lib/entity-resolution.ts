export type LeadIdentity = {
  email?: string;
  domain?: string;
  handle?: string;
  displayName?: string;
  source?: string;
};

export type EntityMatch = {
  entityId?: string;
  confidence: number;
  reason: 'EMAIL' | 'DOMAIN' | 'HANDLE' | 'NONE';
};

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').toLowerCase();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

export function matchEntity(
  identity: LeadIdentity,
  candidates: Array<{ id: string; emails: string[]; domains: string[]; handles: Record<string, string> }>
): EntityMatch {
  const email = identity.email?.toLowerCase();
  if (email) {
    const found = candidates.find((c) => c.emails.map((e) => e.toLowerCase()).includes(email));
    if (found) return { entityId: found.id, confidence: 1.0, reason: 'EMAIL' };
  }

  const domain = identity.domain?.toLowerCase();
  if (domain) {
    const found = candidates.find((c) => c.domains.map((d) => d.toLowerCase()).includes(domain));
    if (found) return { entityId: found.id, confidence: 0.9, reason: 'DOMAIN' };
  }

  const handle = identity.handle ? normalizeHandle(identity.handle) : undefined;
  if (handle) {
    let best: { id: string; score: number } | undefined;
    for (const c of candidates) {
      const handles = Object.values(c.handles ?? {}).map(normalizeHandle);
      for (const h of handles) {
        const s = similarity(handle, h);
        if (!best || s > best.score) best = { id: c.id, score: s };
      }
    }
    if (best && best.score >= 0.8) return { entityId: best.id, confidence: 0.8, reason: 'HANDLE' };
  }

  return { confidence: 0, reason: 'NONE' };
}
