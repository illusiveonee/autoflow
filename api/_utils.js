import { kv } from '@vercel/kv';

export async function updateStats() {
  const subscribers = (await kv.get('subscribers')) || [];
  const prospects   = (await kv.get('prospects'))   || [];

  const active = subscribers.filter(s => s.status === 'active');
  const mrr    = active.reduce((sum, s) => sum + (s.amount || 0), 0);

  const now = new Date();
  const revenueHistory = Array.from({ length: 12 }, (_, i) => {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() - (11 - i) + 1, 1);
    return active
      .filter(s => { const d = new Date(s.created); return d >= monthStart && d < monthEnd; })
      .reduce((sum, s) => sum + (s.amount || 0), 0);
  });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const dailyCounts = {};
  prospects.forEach(p => {
    const d = new Date(p.added);
    if (d >= thirtyDaysAgo) {
      const key = d.toISOString().slice(0, 10);
      dailyCounts[key] = (dailyCounts[key] || 0) + 1;
    }
  });
  const prospectHistory = Array.from({ length: 30 }, (_, i) => {
    const d   = new Date(Date.now() - (29 - i) * 86400000);
    const key = d.toISOString().slice(0, 10);
    return { date: key, count: dailyCounts[key] || 0 };
  });

  await kv.set('stats', {
    mrr,
    subscribers:     active.length,
    prospects:       prospects.length,
    emailsSent:      (await kv.get('emailsSent')) || 0,
    revenueHistory,
    prospectHistory,
    updatedAt:       new Date().toISOString(),
  });
}
