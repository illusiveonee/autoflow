import { kv } from '@vercel/kv';
import { updateStats } from './_utils.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { name, email, city, industry, pain, notes } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name and email required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  // Step 1: Claude writes the cold email
  let subject = '';
  let body    = '';

  try {
    const prompt = `You are writing a cold email on behalf of Autoflow (autoflow.icu), an AI receptionist and reputation management service for small businesses.

Write a short, personalized cold email to this prospect:
- Business: ${name}
- City: ${city}
- Industry: ${industry}
- Pain point: ${notes || 'missing calls and unanswered reviews'}
- Pain score: ${pain}/10

Rules:
- Subject line: specific to their business, no generic "I noticed your business" openers
- Body: 4-5 sentences max, conversational, no fluff
- Mention one specific problem they likely have (missed calls after hours, unanswered Google reviews, etc.)
- End with a single soft CTA: offer a free 7-day trial at autoflow.icu
- Sign off as: The Autoflow Team | autoflow.icu | autoflowicu@protonmail.com
- Do NOT use placeholders like [Name] — write it ready to send

Respond ONLY with valid JSON: {"subject":"...","body":"..."}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 800,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) throw new Error(`Claude ${response.status}`);
    const data    = await response.json();
    const content = data.content?.[0]?.text || '';
    const match   = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in Claude response');
    const parsed  = JSON.parse(match[0]);
    subject = parsed.subject;
    body    = parsed.body;

  } catch (e) {
    console.error('Claude email write failed:', e.message);
    return res.status(500).json({ error: `Claude failed: ${e.message}` });
  }

  // Step 2: Send via Resend (add RESEND_API_KEY to Vercel env)
  // If you don't have Resend yet, the email is returned for manual send
  const resendKey = process.env.RESEND_API_KEY;
  let sent = false;

  if (resendKey) {
    try {
      const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from:    'Autoflow <autoflowicu@protonmail.com>',
          to:      [email],
          subject,
          text:    body,
        }),
      });
      if (sendRes.ok) {
        sent = true;
        // Increment emailsSent counter in KV
        const current = (await kv.get('emailsSent')) || 0;
        await kv.set('emailsSent', current + 1);
        await updateStats();
      }
    } catch (e) {
      console.error('Resend failed:', e.message);
    }
  }

  return res.status(200).json({ success: true, sent, subject, body });
}
