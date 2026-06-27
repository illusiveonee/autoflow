export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  
  const { industry, city, pain, count } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const verticals = {
    law: 'law firms', dental: 'dental offices', medical: 'medical practices',
    hvac: 'HVAC and plumbing companies', auto: 'auto dealerships',
    re: 'real estate agencies', accounting: 'accounting firms',
    insurance: 'insurance agencies', vet: 'veterinary clinics',
    chiro: 'chiropractors', spa: 'spas and medspas',
    hotel: 'hotels and motels', general: 'small businesses'
  };
  
  const pains = {
    missed: 'no one answers the phone after hours or during lunch',
    reviews: 'bad reviews mention rude front desk or long hold times',
    hours: 'business closes at 5 PM but customers call at 6-8 PM',
    growth: 'hiring multiple front-desk staff but still missing calls',
    cost: 'currently employ 3-5 receptionists, high staffing costs'
  };

  const prompt = `Find ${count} real ${verticals[industry]} in ${city} that likely need a 24/7 AI receptionist. Focus on: ${pains[pain]}. For each, provide ONLY name (business or contact person) and email (best guess like info@company.com). Return ONLY a valid JSON array. Example: [{"name":"River Oaks Dental","email":"info@riveroaksdental.com"}]. Make entries realistic and specific to ${city}.`;

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

    const data = await response.json();
    
    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    const text = data.content[0].text;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const prospects = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    
    res.status(200).json({ prospects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
