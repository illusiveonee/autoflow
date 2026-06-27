export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { industry, city, pain, count = 10 } = req.body || {};
  if (!industry || !city) {
    return res.status(400).json({ error: 'industry and city required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const prompt = `You are a B2B lead generation researcher. Find ${count} real ${industry} in ${city}.

For each business, provide ONLY:
- name: exact business name
- city: "${city}"
- rating: estimated Google rating like "4.2" (use realistic values)
- pain: pain score 0-100 based on online reputation (low rating = high pain)
- email: a realistic business email address (format: info@, contact@, or name-based)

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

    const cleaned = prospects.map(p => ({
      name: String(p.name || p.business || 'Unknown').trim(),
      city: String(p.city || city).trim(),
      rating: String(p.rating || '').trim(),
      pain: Math.min(100, Math.max(0, parseInt(p.pain) || 0)),
      email: String(p.email || '').trim(),
      added: new Date().toISOString()
    })).filter(p => p.name && p.name !== 'Unknown');

    return res.status(200).json({ prospects: cleaned, count: cleaned.length });

  } catch (e) {
    console.error('Prospects error:', e);
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
}
