// api/publish.js
// Validates a game move (turn order, action) then publishes via Ably REST.
// Server-side validation prevents clients from spoofing out-of-turn moves.
import Ably from 'ably';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.ABLY_API_KEY;
  if (!key) return res.status(500).json({ error: 'ABLY_API_KEY not configured' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { roomCode, action, seat, name, emoji, text, expectedNext } = body;

  if (!roomCode || !action || seat === undefined || !name || !emoji) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!['ping', 'pong'].includes(action)) {
    return res.status(400).json({ error: 'Action must be ping or pong' });
  }
  if (action !== expectedNext) {
    return res.status(409).json({ error: `Expected ${expectedNext}, got ${action}. Wait your turn.` });
  }

  const client = new Ably.Rest(key);
  const channel = client.channels.get(`pingpong:${roomCode}`);

  const event = {
    type: 'move',
    action,
    seat,
    name: String(name).slice(0, 32),
    emoji: String(emoji).slice(0, 2),
    text: String(text || '').slice(0, 1000),
    time: Date.now()
  };

  try {
    await channel.publish('move', event);
    res.status(200).json({ ok: true, event });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
