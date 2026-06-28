import { kv } from '@vercel/kv';
import { updateStats } from './_utils.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function extractJSONArray(text) {
  text = text.trim();
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');
  let start = -1, depth = 0, inString = false, escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"' && !escape) { inString = !inString; continue; }
    if (!inString) {
      if (c === '[') { if (depth === 0) start = i; depth++; }
      else if (c === ']') { depth--; if (depth === 0 && start !== -1) return text.slice(start, i + 1); }
    }
  }
  return null;
}

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const prospects = (await kv.get('prospects')) || [];
      return res.status(200).json({ prospects });
    } catch (e) {
      console.error('KV GET error:', e.message);
      return res.status(500).json({ error: 'KV read error: ' + e.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await kv.set('prospects', []);
      await updateStats();
      return res.status(200).json({ success: true });
    } catch (e) {
      console.error('KV DELETE error:', e.message);
      return res.status(500).json({ error: 'Delete failed: ' + e.message });
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
      console.error('Manual save error:', e.message);
      return res.status(500).json({ error: 'Manual save failed: ' + e.message });
    }
  }

  if (!industry || !city) {
    return res.status(400).json({ error: 'industry and city are required for AI search' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel env' });

  try {
    const prompt = `You are a B2B sales researcher. Find ${count} realistic ${industry} businesses in ${city} with owner names and working emails.

CRITICAL: Return ONLY a valid JSON array. No markdown, no explanation, no text before or after.

Each object MUST have these exact fields:
- "name": full business name with owner name (e.g. "Michael G. Berz Insurance Agency" or "Smith & Associates Law Firm")
- "email": realistic working email address (e.g. "michael@berzinsurance.com", "info@smithlaw.com", "contact@dentalcare-ny.com")
- "city": "${city}"
- "industry": "${industry}"
- "pain": number 1-100 (how badly they need an AI receptionist - higher = more desperate)
- "rating": number 1.0-5.0 (estimated Google review rating)
- "notes": one sentence explaining why they specifically need an AI receptionist

Example response:
[{"name":"Berz Insurance Agency","email":"michael@berzinsurance.com","city":"${city}","industry":"${industry}","pain":75,"rating":3.8,"notes":"Missing after-hours calls and has 3 unanswered negative Google reviews"}]`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const responseText = await response.text();
    
    if (!response.ok) {
      console.error('Claude API error:', response.status, responseText.substring(0, 500));
      return res.status(500).json({ error: `Claude API ${response.status}: ${responseText.substring(0, 200)}` });
    }

    const data = JSON.parse(responseText);
    const content = data.content?.[0]?.text || '';
    
    console.log('Claude raw:', content.substring(0, 1000));

    const jsonStr = extractJSONArray(content);
    if (!jsonStr) {
      return res.status(500).json({ error: 'Could not find JSON array in Claude response', raw: content.substring(0, 500) });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      const cleaned = jsonStr.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
      parsed = JSON.parse(cleaned);
    }

    if (!Array.isArray(parsed)) {
      return res.status(500).json({ error: 'Parsed data is not an array' });
    }

    const prospects = parsed.map((p, idx) => ({
      name: String(p.name || p.business_name || `Business ${idx + 1}`),
      email: String(p.email || p.contact_email || p.owner_email || ''),
      phone: String(p.phone || p.phone_number || ''),
      city: String(p.city || city),
      industry: String(p.industry || industry),
      pain: Math.min(100, Math.max(1, parseInt(p.pain) || 50)),
      rating: Math.min(5, Math.max(1, parseFloat(p.rating) || 3.5)),
      notes: String(p.notes || p.description || ''),
      added: new Date().toISOString(),
    })).filter(p => p.name && p.email && p.email.includes('@'));

    if (prospects.length === 0) {
      return res.status(500).json({ error: 'Claude returned data but no valid prospects with emails', raw: content.substring(0, 500) });
    }

    const existing = (await kv.get('prospects')) || [];
    const existingEmails = new Set(existing.map(p => p.email.toLowerCase()));
    const existingNames = new Set(existing.map(p => (p.name + '|' + p.city).toLowerCase()));
    
    const fresh = prospects.filter(p => {
      const emailNew = !existingEmails.has(p.email.toLowerCase());
      const nameNew = !existingNames.has((p.name + '|' + p.city).toLowerCase());
      return emailNew && nameNew;
    });

    await kv.set('prospects', [...existing, ...fresh]);
    await updateStats();

    return res.status(200).json({
      prospects: fresh,
      count: fresh.length,
      skipped: prospects.length - fresh.length,
    });

  } catch (e) {
    console.error('Prospect search failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
