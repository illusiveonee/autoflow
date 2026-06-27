import { updateStats } from './_utils.js';
import { kv } from '@vercel/kv';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { name, city, industry } = req.body || {};
  if (!name || !city) return res.status(400).json({ error: 'name and city required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  try {
    const prompt = `You are a B2B sales researcher. Given a business name and city, infer the most likely:
- Owner/manager first and last name
- Owner email (pattern: firstname@businessdomain.com or info@businessdomain.com)
- Business phone number format for that city
- Google review rating (estimate based on industry averages)
- Pain score 1-10 for needing an AI receptionist

Business: ${name}
City: ${city}
Industry: ${industry || 'unknown'}

Be realistic. Use common email patterns for small businesses.
Respond ONLY with valid JSON — no markdown, no explanation:
{"ownerName":"...","email":"...","phone":"...","rating":"4.1","pain":7,"confidence":"low|medium|high"}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 400,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) throw new Error(`Claude ${response.status}`);
    const data    = await response.json();
    const content = data.content?.[0]?.text || '';
    const match   = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const enriched = JSON.parse(match[0]);

    // Update prospect in KV if email found
    if (enriched.email) {
      const prospects = (await kv.get('prospects')) || [];
      const idx = prospects.findIndex(p => p.name === name && p.city.includes(city.split(',')[0]));
      if (idx !== -1) {
        prospects[idx].email    = enriched.email;
        prospects[idx].phone    = enriched.phone    || prospects[idx].phone;
        prospects[idx].pain     = enriched.pain     || prospects[idx].pain;
        prospects[idx].enriched = true;
        await kv.set('prospects', prospects);
      }
    }

    return res.status(200).json({ success: true, ...enriched });
  } catch (e) {
    console.error('Enrich error:', e.message);
    return res.status(500).json({ error: `Enrich failed: ${e.message}` });
  }
}
