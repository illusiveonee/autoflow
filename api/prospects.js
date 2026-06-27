import { kv } from '@vercel/kv';
import { updateStats } from './_utils.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
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

  const { industry, city, count = 10, manual, name, email, phone, pain, notes, rating } = req.body || {};

  if (manual) {
    if (!name || !email) return res.status(400).json({ error: 'name and email required' });
    try {
      const existing = (await kv.get('prospects')) || [];
      const prospect = {
        name,
        email,
        city: city || '',
        phone: phone || '',
        industry: industry || '',
        pain: Math.min(100, Math.max(1, parseInt(pain) || 50)),
        rating: parseFloat(rating) || 0,
        notes: notes || '',
        added: new Date().toISOString(),
      };
      existing.push(prospect);
      await kv.set('prospects', existing);
      await updateStats();
      return res.status(200).json({ prospects: [prospect], count: 1 });
    } catch (e) {
      return res.status(500).json({ error: 'Manual save failed' });
    }
  }

  if (!industry || !city) {
    return res.status(400).json({ error: 'industry and city are required for AI search' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel env' });

  let prospects = [];

  try {
    const prompt = `You are a B2B sales researcher for Autoflow, an AI receptionist and reputation management service for small businesses in the US.

Find ${count} realistic ${industry} businesses in ${city} that would benefit from an AI receptionist.

For each business return ONLY these fields:
- name: real-sounding business name
- email: realistic owner/manager email (e.g. owner@businessname.com)
- city: "${city}"
- industry: "${industry}"
- pain: integer 1-100 (higher = more desperate for AI receptionist / missing calls / bad reviews)
- rating: estimated Google review rating 1.0-5.0
- notes: one sentence explaining exactly why they need AI receptionist

Respond ONLY with a valid JSON array. No markdown, no explanation, no code fences.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API ${response.status}: ${err}`);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || '';
    
    // FIX: non-greedy regex so it stops at first valid array
    const match = content.match(/\[[\s\S]*?\]/);
    if (!match) throw new Error('No JSON array in Claude response');

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) throw new Error('Claude did not return an array');

    prospects = parsed.map(p => ({
      name: String(p.name || 'Unknown Business'),
      email: String(p.email || ''),
      phone: String(p.phone || ''),
      city: String(p.city || city),
      industry: String(p.industry || industry),
      pain: Math.min(100, Math.max(1, parseInt(p.pain) || 50)),
      rating: Math.min(5, Math.max(1, parseFloat(p.rating) || 3.5)),
      notes: String(p.notes || ''),
      added: new Date().toISOString(),
    }));

  } catch (e) {
    console.error('Claude search failed:', e.message);
    return res.status(500).json({ error: `Claude search failed: ${e.message}` });
  }

  try {
    const existing = (await kv.get('prospects')) || [];
    const existingEmails = new Set(existing.map(p => p.email.toLowerCase()));
    const fresh = prospects.filter(p => !existingEmails.has(p.email.toLowerCase()));
    await kv.set('prospects', [...existing, ...fresh]);
    await updateStats();
    return res.status(200).json({
      prospects: fresh,
      count: fresh.length,
      skipped: prospects.length - fresh.length,
    });
  } catch (e) {
    return res.status(500).json({ error: 'KV save failed' });
  }
}
