// api/publish.js
// Validates a game move (turn order, action) then publishes via Ably REST.
// Server-side validation prevents clients from spoofing out-of-turn moves.
import Ably from 'ably';

// ── rate limiter ──────────────────────────────────────────────────────────
const rateMap = new Map();
const RATE_WINDOW_MS = 1000;
const RATE_MAX = 10;

function rateLimit(roomCode) {
  const now = Date.now();
  const entry = rateMap.get(roomCode);
  if (!entry || now > entry.resetAt) {
    rateMap.set(roomCode, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  if (entry.count > RATE_MAX) return false;
  return true;
}

// Purge stale entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateMap) { if (now > v.resetAt) rateMap.delete(k); }
}, 60_000).unref?.();

// ── validators ────────────────────────────────────────────────────────────
const ROOM_RE = /^[a-zA-Z0-9_-]{1,24}$/;

function validate(body) {
  const errs = [];
  if (!body.roomCode || typeof body.roomCode !== 'string' || !ROOM_RE.test(body.roomCode)) {
    errs.push('Invalid or missing room code.');
  }
  if (!['ping', 'pong'].includes(body.action)) {
    errs.push('Action must be ping or pong.');
  }
  if (body.seat !== 0 && body.seat !== 1) {
    errs.push('Seat must be 0 or 1.');
  }
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    errs.push('Name is required.');
  }
  if (!body.emoji || typeof body.emoji !== 'string') {
    errs.push('Emoji is required.');
  }
  if (body.action !== body.expectedNext) {
    errs.push(`Expected ${body.expectedNext}, got ${body.action}. Wait your turn.`);
  }
  return errs;
}

// ── handler ───────────────────────────────────────────────────────────────
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

  const errs = validate(body);
  if (errs.length) return res.status(400).json({ error: errs.join(' ') });

  if (!rateLimit(body.roomCode)) {
    return res.status(429).json({ error: 'Too many requests. Slow down.' });
  }

  const client = new Ably.Rest(key);
  const channel = client.channels.get(`pingpong:${body.roomCode}`);

  const event = {
    type: 'move',
    action: body.action,
    seat: body.seat,
    name: String(body.name).trim().slice(0, 32),
    emoji: String(body.emoji).slice(0, 2),
    text: String(body.text || '').slice(0, 1000),
    time: Date.now()
  };

  try {
    await channel.publish('move', event);
    res.status(200).json({ ok: true, event });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
