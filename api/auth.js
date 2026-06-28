const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { password } = req.body || {};
  const correctPassword = process.env.ADMIN_PASSWORD;

  if (!correctPassword) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD not set in environment variables' });
  }

  if (password === correctPassword) {
    return res.status(200).json({ success: true, token: 'autoflow-admin-session' });
  }

  return res.status(401).json({ success: false, error: 'Invalid password' });
}
