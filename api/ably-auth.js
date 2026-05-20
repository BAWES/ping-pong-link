// api/ably-auth.js
// Mints a short-lived Ably token request so the real API key never reaches the browser.
import Ably from 'ably';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.ABLY_API_KEY;
  if (!key) return res.status(500).json({ error: 'ABLY_API_KEY not configured' });

  const clientId = (req.query.clientId || 'anon').slice(0, 64);
  const client = new Ably.Rest(key);

  try {
    const tokenRequest = await client.auth.createTokenRequest({ clientId });
    res.status(200).json(tokenRequest);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
