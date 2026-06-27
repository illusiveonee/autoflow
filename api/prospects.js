import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const prospects = (await kv.get('prospects')) || [];
      return res.status(200).json({ prospects });
    } catch (e) {
      return res.status(500).json({ error: 'KV read error' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await kv.set('prospects', []);
      await updateStats();
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: 'Delete failed' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { industry, city, count = 10, manual, name, rating, email } = req.body || {};

  // Manual add
  if (manual) {
    try {
      const existing = (await kv.get('prospects')) || [];
      existing.push({
        name: name || 'Unknown',
        city: city || '',
        rating: rating || '',
        pain: parseInt(rating) * 10 || 20,
        email: email || '',
        added: new Date().toISOString()
      });
      await kv.set('prospects', existing);
      await updateStats();
      return res.status(200).json({ prospects: [existing[existing.length-1]], count: 1 });
    } catch (e) {
      return res.status(500).json({ error: 'Manual save failed' });
    }
  }

  // ─── Generate or fetch ──────────────────────
  // If no API key, or we want to guarantee results, generate random data.
  // But we'll try Claude first if key exists.
  let prospects = [];
  let usedClaude = false;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (apiKey) {
    try {
      const prompt = `Generate ${count} real-looking ${industry} businesses in ${city}. For each, return: name, city (${city}), rating (e.g. 4.2), pain (0-100), email (realistic). Return ONLY JSON array.`;
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (response.ok) {
        const data = await response.json();
        const content = data.content?.[0]?.text || '';
        const match = content.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed)) {
            prospects = parsed.map(p => ({
              name: p.name || 'Unknown',
              city: p.city || city,
              rating: p.rating || '4.0',
              pain: Math.min(100, parseInt(p.pain) || 20),
              email: p.email || `${p.name.toLowerCase().replace(/[^a-z]/g,'')}@${city.split(',')[0].toLowerCase()}business.com`,
              added: new Date().toISOString()
            }));
            usedClaude = true;
          }
        }
      }
    } catch (e) {
      console.error('Claude error, falling back to random', e);
    }
  }

  // Fallback: generate random prospects
  if (!usedClaude || prospects.length === 0) {
    const firstNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
    const lastNames = ['Dental', 'Law', 'Medical', 'Auto', 'Realty', 'Plumbing', 'Roofing', 'Insurance', 'Tax', 'Consulting'];
    const suffixes = ['Associates', 'Group', '& Sons', 'LLC', 'PLLC', 'Partners', 'Clinic', 'Center', 'Solutions', 'Professionals'];
    const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'protonmail.com', 'icloud.com', 'business.com', 'consultant.com'];
    for (let i = 0; i < count; i++) {
      const fn = firstNames[Math.floor(Math.random() * firstNames.length)];
      const ln = lastNames[Math.floor(Math.random() * lastNames.length)];
      const suf = suffixes[Math.floor(Math.random() * suffixes.length)];
      const name = `${fn} ${ln} ${suf}`.trim();
      const rating = (3 + Math.random() * 2).toFixed(1);
      const pain = Math.floor(Math.random() * 80) + 10;
      const email = `${fn.toLowerCase()}.${ln.toLowerCase()}${Math.floor(Math.random()*100)}@${domains[Math.floor(Math.random()*domains.length)]}`;
      prospects.push({
        name,
        city: city || 'Houston, TX',
        rating,
        pain,
        email,
        added: new Date().toISOString()
      });
    }
  }

  // Save to KV
  try {
    const existing = (await kv.get('prospects')) || [];
    const merged = [...existing, ...prospects];
    await kv.set('prospects', merged);
    await updateStats();
    return res.status(200).json({ prospects, count: prospects.length, usedClaude });
  } catch (e) {
    return res.status(500).json({ error: 'KV save failed' });
  }
}

async function updateStats() {
  const subscribers = (await kv.get('subscribers')) || [];
  const prospects = (await kv.get('prospects')) || [];
  const active = subscribers.filter(s => s.status === 'active');
  const mrr = active.reduce((sum, s) => sum + (s.amount || 0), 0);
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d);
  }
  const revenueHistory = months.map(monthStart => {
    const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
    return active
      .filter(s => {
        const created = new Date(s.created);
        return created >= monthStart && created < nextMonth;
      })
      .reduce((sum, s) => sum + (s.amount || 0), 0);
  });
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dailyCounts = {};
  prospects.forEach(p => {
    const d = new Date(p.added);
    if (d >= thirtyDaysAgo) {
      const key = d.toISOString().slice(0,10);
      dailyCounts[key] = (dailyCounts[key] || 0) + 1;
    }
  });
  const prospectHistory = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0,10);
    prospectHistory.push({ date: key, count: dailyCounts[key] || 0 });
  }
  const stats = {
    mrr,
    subscribers: active.length,
    prospects: prospects.length,
    emailsSent: (await kv.get('emailsSent')) || 0,
    revenueHistory,
    prospectHistory,
    updatedAt: new Date().toISOString()
  };
  await kv.set('stats', stats);
}
