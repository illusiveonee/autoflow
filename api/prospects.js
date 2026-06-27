export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { industry, city, pain, count } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(200).json({
      prospects: generateFallback(industry, city, pain, parseInt(count) || 10),
      note: 'ANTHROPIC_API_KEY not set — using fallback data'
    });
  }

  const verticals = {
    law: 'law firms',
    dental: 'dental offices',
    medical: 'medical practices',
    hvac: 'HVAC and plumbing companies',
    auto: 'auto dealerships',
    re: 'real estate agencies',
    accounting: 'accounting firms',
    insurance: 'insurance agencies',
    vet: 'veterinary clinics',
    chiro: 'chiropractors',
    spa: 'spas and medspas',
    hotel: 'hotels and motels',
    general: 'small businesses'
  };

  const pains = {
    missed: 'no one answers the phone after hours or during lunch',
    reviews: 'bad reviews mention rude front desk or long hold times',
    hours: 'business closes at 5 PM but customers call at 6-8 PM',
    growth: 'hiring multiple front-desk staff but still missing calls',
    cost: 'currently employ 3-5 receptionists, high staffing costs'
  };

  const vertical = verticals[industry] || industry;
  const painDesc = pains[pain] || pain;
  const requestCount = Math.min(parseInt(count) || 10, 50);

  const prompt = `You are a lead researcher for Autoflow, an AI receptionist company.

Find ${requestCount} real ${vertical} in ${city} that likely need a 24/7 AI receptionist.

Focus on: ${painDesc}.

For each, provide ONLY:
- name: the business name
- email: a realistic business email (best guess like info@company.com)
- type: the industry category
- angle: a one-sentence reason why they need Autoflow

Return ONLY a valid JSON array. No markdown, no explanation. Example:
[
  {"name":"River Oaks Dental","email":"info@riveroaksdental.com","type":"Dental","angle":"No weekend answering — losing implant consults"},
  {"name":"Summit Law Group","email":"contact@summitlaw.com","type":"Law Firm","angle":"Clients call after 5 PM, always go to voicemail"}
]

Make entries realistic and specific to ${city}.`;

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
      console.error('Claude API error:', response.status);
      return res.status(200).json({
        prospects: generateFallback(industry, city, pain, requestCount),
        note: 'Claude API error — using fallback data'
      });
    }

    const data = await response.json();

    if (data.error) {
      return res.status(200).json({
        prospects: generateFallback(industry, city, pain, requestCount),
        note: 'Claude API error — using fallback data'
      });
    }

    const text = data.content[0].text;
    let prospects;

    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        prospects = JSON.parse(jsonMatch[0]);
      } else {
        prospects = JSON.parse(text);
      }
    } catch (e) {
      return res.status(200).json({
        prospects: generateFallback(industry, city, pain, requestCount),
        note: 'Parse error — using fallback data'
      });
    }

    prospects = prospects.filter(p => p && p.name).map(p => ({
      name: String(p.name).trim(),
      email: String(p.email || '').trim(),
      type: String(p.type || vertical).trim(),
      angle: String(p.angle || '').trim()
    }));

    res.status(200).json({ prospects });

  } catch (err) {
    console.error('Handler error:', err);
    res.status(200).json({
      prospects: generateFallback(industry, city, pain, requestCount),
      note: 'Server error — using fallback data'
    });
  }
}

function generateFallback(industry, city, pain, count) {
  const prefixes = ['River Oaks', 'Summit', 'Downtown', 'Metro', 'City', 'Coastal', 'Premier', 'Elite', 'Advanced', 'Modern', 'Family', 'Bright', 'Golden', 'Park', 'Harbor'];
  const suffixes = {
    law: 'Law Group',
    dental: 'Dental',
    medical: 'Medical',
    hvac: 'HVAC',
    auto: 'Auto',
    re: 'Realty',
    accounting: 'Accounting',
    insurance: 'Insurance',
    vet: 'Vet',
    chiro: 'Chiropractic',
    spa: 'Spa',
    hotel: 'Inn',
    general: 'Services'
  };
  const types = {
    law: 'Law Firm',
    dental: 'Dental',
    medical: 'Medical',
    hvac: 'HVAC',
    auto: 'Auto',
    re: 'Real Estate',
    accounting: 'Accounting',
    insurance: 'Insurance',
    vet: 'Veterinary',
    chiro: 'Chiropractic',
    spa: 'Spa',
    hotel: 'Hotel',
    general: 'Business'
  };
  const angles = [
    'No after-hours answering — losing urgent calls to competitors',
    'Growing fast but front desk can\'t keep up with call volume',
    'Bad reviews specifically mention no one picking up the phone',
    'Closes at 5 PM but customers call at 6-8 PM for appointments',
    'Currently paying 3+ receptionists, looking to cut costs',
    'Missed 40+ calls last month according to voicemail logs',
    'Patients complain about long hold times and voicemail loops'
  ];

  const results = [];
  const suffix = suffixes[industry] || 'Business';
  const type = types[industry] || 'Business';

  for (let i = 0; i < count; i++) {
    const prefix = prefixes[i % prefixes.length];
    const name = i % 3 === 0 ? `${prefix} ${suffix}` : `${prefix} ${suffix} ${String.fromCharCode(65 + (i % 26))}`;
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    results.push({
      name: name,
      email: `info@${cleanName}.com`,
      type: type,
      angle: angles[i % angles.length]
    });
  }
  return results;
}
