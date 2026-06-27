export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const subscribers = JSON.parse(process.env.AF_SUBSCRIBERS || '[]');
    return res.status(200).json({ subscribers, count: subscribers.length });
  }

  if (req.method === 'POST') {
    const { email, name, source } = req.body;
    
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    let subscribers = [];
    try {
      subscribers = JSON.parse(process.env.AF_SUBSCRIBERS || '[]');
    } catch(e) { subscribers = []; }

    if (subscribers.find(s => s.email === email)) {
      return res.status(200).json({ message: 'Already subscribed', subscriber: { email } });
    }

    const newSubscriber = {
      id: Date.now().toString(),
      email: email.toLowerCase().trim(),
      name: name || '',
      source: source || 'website',
      date: new Date().toISOString(),
      status: 'active'
    };

    subscribers.push(newSubscriber);

    return res.status(200).json({ 
      success: true, 
      subscriber: newSubscriber,
      message: 'Subscription successful!'
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
