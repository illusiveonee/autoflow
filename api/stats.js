export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  let subscribers = [];
  try {
    subscribers = JSON.parse(process.env.AF_SUBSCRIBERS || '[]');
  } catch(e) { subscribers = []; }

  let prospectCount = 0;
  try {
    prospectCount = parseInt(process.env.AF_PROSPECT_COUNT || '0');
  } catch(e) { prospectCount = 0; }

  let emailCount = 0;
  try {
    emailCount = parseInt(process.env.AF_EMAIL_COUNT || '0');
  } catch(e) { emailCount = 0; }

  const activeSubscribers = subscribers.filter(s => s.status === 'active').length;
  const mrr = activeSubscribers * 497;

  res.status(200).json({
    mrr,
    activeSubscribers,
    prospectCount,
    emailCount,
    subscribers
  });
}
