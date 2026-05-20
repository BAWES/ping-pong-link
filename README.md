# 🏓 Ping Pong Link

A real-time, turn-based ping pong messaging game. Share a link, pick your name and emoji, claim a side, then rally — each hit can carry a text note, a URL, or a song.

## Stack

- **Frontend**: Vanilla HTML/CSS/JS (single file, no build step)
- **Backend**: Vercel Serverless Functions (Node.js)
- **Realtime**: [Ably](https://ably.com) WebSockets (free tier: 6M messages/month)
- **Notifications**: Web Push via browser `Notification` API

## Setup

### 1. Get an Ably API key
1. Sign up at [ably.com](https://ably.com) — free
2. Create an app, copy the **Root API key** from the dashboard

### 2. Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/BAWES/ping-pong-link)

Or via CLI:
```bash
npm i -g vercel
vercel
```

### 3. Add environment variable
In Vercel project → Settings → Environment Variables:
```
ABLY_API_KEY=your_root_key_here
```

Locally, create `.env.local`:
```
ABLY_API_KEY=your_root_key_here
```

## How to play
1. Open the app, enter a room code → **Make room**
2. Copy the link and send it to your friend
3. Each player claims a seat (Ping side / Pong side) and sets name + emoji
4. First player sends **PING**, second must reply with **PONG** — strictly alternating
5. Optionally attach a text note, link, or song to each hit

## Project structure
```
/
├── public/
│   └── index.html       ← entire frontend (no build step)
├── api/
│   ├── ably-auth.js     ← mints Ably token requests (keeps key secret)
│   └── publish.js       ← validates + publishes a game move server-side
├── vercel.json
├── package.json
└── README.md
```
