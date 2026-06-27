import { kv } from '@vercel/kv';
import { updateStats } from './_utils.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const PLAN_AMOUNTS = {
  'Reputation Only': 99,
  'AI Receptionist': 499,
  'Full Suite':      599,
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const subscribers = (await kv.get('subscribers')) || [];
      return res.status(200).json({ subscribers });
    } catch (e) {
      return res.status(500).json({ error: 'KV read error' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { email, name, plan, amount } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  try {
    const subscribers = (await kv.get('subscribers')) || [];
    const existing    = subscribers.find(s => s.email === email);

    if (existing) {
      if (existing.status === 'cancelled') {
        existing.status  = 'active';
        existing.plan    = plan   || existing.plan;
        existing.amount  = amount || PLAN_AMOUNTS[plan] || existing.amount || 0;
        existing.updated = new Date().toISOString();
        await kv.set('subscribers', subscribers);
        await updateStats();
        return res.status(200).json({ success: true, message: 'Reactivated', subscriber: existing });
      }
      return res.status(200).json({ success: true, message: 'Already subscribed', subscriber: existing });
    }

    const subscriber = {
      email,
      name:    name   || '',
      plan:    plan   || 'newsletter',
      amount:  amount || PLAN_AMOUNTS[plan] || 0,
      status:  'active',
      created: new Date().toISOString(),
    };
    subscribers.push(subscriber);
    await kv.set('subscribers', subscribers);
    await updateStats();
    return res.status(200).json({ success: true, message: 'Subscription recorded', subscriber });
  } catch (e) {
    console.error('Subscribe error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
