import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET all prospects
  if (req.method === 'GET') {
    const prospects = (await kv.get('prospects')) || [];
    return res.status(200).json({ prospects });
  }

  // DELETE all prospects
  if (req.method === 'DELETE') {
    await kv.set('prospects', []);
    await updateStats();
    return res.status(200).json({ success: true });
  }

  // POST – Claude discovery or manual add
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { industry, city, pain, count = 10, manual, name, rating, email } = req.body || {};

  // Manual add from admin
  if (manual) {
    const existing = (await kv.get('prospects')) || [];
    existing.push({
      name: name || 'Unknown',
      city: city || '',
      rating: rating || '',
      pain: parseInt(pain) || 0,
      email: email || '',
      added: new Date().toISOString()
    });
    await kv.set('prospects', existing);
    await updateStats();
    return res.status(200).json({ prospects: [existing[existing.length-1]], count: 1 });
  }

  // Claude-powered discovery
  if (!industry || !city) {
    return res.status(400).json({ error: 'industry and city required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const prompt = `You are a B2B lead generation researcher. Find ${count} real, verifiable ${industry} businesses in ${city}.

For each business, provide:
- name: exact business name as it appears publicly
- city: "${city}"
- rating: estimated Google rating (e.g., "4.2") – use realistic values based on actual reviews
- pain: a pain score 0–100 (higher = more urgent need for reputation management / AI receptionist). Base this on online reviews, lack of response, etc.
- email: a realistic business email address. Use actual domain patterns (e.g., info@businessname.com, contact@businessname.com). DO NOT use generic placeholders like "example.com" – use real TLDs.

Return ONLY a valid JSON array. No markdown, no explanation, no code blocks. Example:
[
  {"name":"Smith & Associates Law Firm","city":"${city}","rating":"4.1","pain":45,"email":"contact@smithlaw.com"},
  {"name":"Johnson Legal Group","city":"${city}","rating":"3.8","pain":65,"email":"info@johnsonlegal.com"}
]`;

  try {
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

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: 'Claude API error: ' + errText });
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || data.completion || '';

    let jsonStr = content;
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1];
    jsonStr = jsonStr.trim();
    const arrayMatch = jsonStr.match(/(\[\s\S]*\])/);
    if (arrayMatch) jsonStr = arrayMatch[1];

    let prospects;
    try {
      prospects = JSON.parse(jsonStr);
    } catch (e) {
      const fallback = content.match(/\[[\s\S]*?\]/);
      if (fallback) prospects = JSON.parse(fallback[0]);
      else throw new Error('Could not parse Claude response');
    }

    if (!Array.isArray(prospects)) {
      return res.status(502).json({ error: 'Invalid response format from Claude' });
    }

    // Clean and validate
    const cleaned = prospects
      .map(p => ({
        name: String(p.name || p.business || '').trim(),
        city: String(p.city || city).trim(),
        rating: String(p.rating || '').trim(),
        pain: Math.min(100, Math.max(0, parseInt(p.pain) || 0)),
        email: String(p.email || '').trim().toLowerCase(),
        added: new Date().toISOString()
      }))
      .filter(p => p.name && p.name.length > 2 && p.email && p.email.includes('@'));

    if (cleaned.length === 0) {
      return res.status(502).json({ error: 'Claude returned no valid prospects with real emails' });
    }

    // Save to KV
    const existing = (await kv.get('prospects')) || [];
    const merged = [...existing, ...cleaned];
    await kv.set('prospects', merged);
    await updateStats();

    return res.status(200).json({ prospects: cleaned, count: cleaned.length });

  } catch (e) {
    console.error('Prospects error:', e);
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
}

// ─── Helper to recalc all stats ───
async function updateStats() {
  const subscribers = (await kv.get('subscribers')) || [];
  const prospects = (await kv.get('prospects')) || [];

  // Active subscribers and MRR
  const active = subscribers.filter(s => s.status === 'active');
  const mrr = active.reduce((sum, s) => sum + (s.amount || 0), 0);

  // Revenue history – last 12 months (based on subscription creation dates)
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

  // Prospect history – last 30 days
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
  // Build array of {date, count} for last 30 days
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
