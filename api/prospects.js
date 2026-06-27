export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { industry, city, pain, count, prompt } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const verticals = {
    law: 'law firms',
    dental: 'dental practices',
    accounting: 'accounting firms',
    insurance: 'insurance agencies',
    real_estate: 'real estate agencies',
    consulting: 'consulting firms',
    marketing: 'marketing agencies',
    tech: 'tech companies'
  };

  const finalPrompt = prompt || `Find ${count || 10} real ${verticals[industry] || industry} in ${city}${pain ? ' that struggle with ' + pain : ''}.

For each business, provide ONLY a JSON object with these exact fields:
- name: full business name
- type: specific type of business
- city: "${city}"
- rating: estimated Google rating as a number 1.0-5.0
- pain: estimated pain score 0-100 based on ${pain || 'general business challenges'}
- email: a realistic business email address

Return ONLY a valid JSON array. No markdown, no explanation.`;

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
        max_tokens: 4096,
        messages: [{ role: 'user', content: finalPrompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'Claude API error: ' + err });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Extract JSON array from Claude's response
    let prospects = [];
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      try {
        prospects = JSON.parse(jsonMatch[0]);
      } catch (e) {
        return res.status(500).json({ error: 'Failed to parse Claude response', raw: text });
      }
    }

    res.status(200).json({ prospects, count: prospects.length });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
