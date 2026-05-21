// ── AUDIO ──────────────────────────────────────────────────────────────
function makeSound(freq, type = 'sine', dur = 0.12) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + dur);
  } catch {}
}
const sounds = {
  ping: () => makeSound(880, 'sine', 0.10),
  pong: () => makeSound(523, 'triangle', 0.12),
  join: () => makeSound(660, 'sine', 0.18),
};

// ── STATE ──────────────────────────────────────────────────────────────
const state = {
  room: '',
  me: { name: '', emoji: '🏓' },
  mySeat: null,
  rs: { seats: [null, null], next: 'ping', activeSeat: 0, lastMove: null, feed: [] },
  realtime: null,
  channel: null,
  connected: false,
  notificationsEnabled: false,
  moveCount: 0,
};

// ── HELPERS ────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = (s = '') =>
  s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
const linkify = (t = '') =>
  esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
const shortCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const timeText = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const setHash = code => {
  const u = new URL(location.href);
  u.hash = code ? '#room=' + encodeURIComponent(code) : '';
  history.replaceState({}, '', u);
};
const readHash = () => {
  const m = (location.hash || '').match(/room=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : '';
};
const emojiChoices = ['🏓','🔥','🦄','🤖','🐯','🎧','🌊','⚡','🍉','🛰️','🐼','🎯'];

// ── THEME ──────────────────────────────────────────────────────────────
function initTheme() {
  let t = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  const icon = () => t === 'dark' ? '☀︎' : '☾';
  ['themeToggle','themeToggle2','themeToggle3'].forEach(id => {
    const btn = $(id);
    if (!btn) return;
    btn.textContent = icon();
    btn.onclick = () => {
      t = t === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = t;
      ['themeToggle','themeToggle2','themeToggle3'].forEach(i => {
        const b = $(i); if (b) b.textContent = icon();
      });
    };
  });
}

// ── SCREENS ────────────────────────────────────────────────────────────
function showScreen(id) {
  ['screenOnboard','screenShare','screenGame'].forEach(s => {
    const el = $(s);
    if (el) el.classList.toggle('active', s === id);
  });
}

// ── QR CODE ────────────────────────────────────────────────────────────
function renderQR(containerId, url) {
  const el = $(containerId);
  if (!el || !url) return;
  el.innerHTML = '';
  try {
    new QRCode(el, { text: url, width: 200, height: 200, colorDark: '#28251d', colorLight: '#ffffff' });
  } catch {
    el.innerHTML = `<p style="font-size:.75rem;color:#888;padding:1rem;text-align:center">QR unavailable<br>${url}</p>`;
  }
}

// ── ONBOARD EMOJI GRID ──────────────────────────────────────────────────
function renderOnboardEmoji() {
  const grid = $('obEmojiGrid');
  if (!grid) return;
  grid.innerHTML = '';
  emojiChoices.forEach(e => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'emoji-btn' + (e === state.me.emoji ? ' active' : '');
    b.textContent = e;
    b.setAttribute('aria-label', `Pick emoji ${e}`);
    b.onclick = () => { state.me.emoji = e; $('obEmoji').value = e; renderOnboardEmoji(); };
    grid.appendChild(b);
  });
}

// ── ARENA ANIMATION ────────────────────────────────────────────────────
function animateBall(fromSeat) {
  const ball = $('ball');
  if (!ball) return;
  ball.classList.remove('flying', 'flying-back');
  void ball.offsetWidth; // reflow to restart
  ball.classList.add(fromSeat === 0 ? 'flying' : 'flying-back');

  // Paddle squish
  const paddle = fromSeat === 0 ? $('paddleLeft') : $('paddleRight');
  if (paddle) {
    paddle.classList.remove('hit');
    void paddle.offsetWidth;
    paddle.classList.add('hit');
    setTimeout(() => paddle.classList.remove('hit'), 300);
  }

  // Impact ring on the receiving side
  const ring = $('impactRing');
  if (ring) {
    ring.style.left = fromSeat === 0 ? '72%' : '28%';
    ring.style.top  = fromSeat === 0 ? '55%' : '45%';
    ring.classList.remove('burst');
    void ring.offsetWidth;
    ring.classList.add('burst');
    setTimeout(() => ring.classList.remove('burst'), 500);
  }
}

function updateArenaPlayers() {
  const s0 = state.rs.seats[0];
  const s1 = state.rs.seats[1];
  const tagL = $('tagLeft');  const tagR = $('tagRight');
  if (tagL) {
    tagL.querySelector('.tag-emoji').textContent = s0 ? s0.emoji : '○';
    tagL.querySelector('.tag-name').textContent  = s0 ? esc(s0.name) : 'Ping side';
    tagL.classList.toggle('active', state.rs.activeSeat === 0);
  }
  if (tagR) {
    tagR.querySelector('.tag-emoji').textContent = s1 ? s1.emoji : '○';
    tagR.querySelector('.tag-name').textContent  = s1 ? esc(s1.name) : 'Pong side';
    tagR.classList.toggle('active', state.rs.activeSeat === 1);
  }
  const tc = $('turnCenter');
  if (tc) {
    const active = state.rs.seats[state.rs.activeSeat];
    tc.textContent = active ? active.emoji : '🏓';
  }
}

// ── RENDER ────────────────────────────────────────────────────────────
function renderFeed() {
  const feed = $('feed');
  if (!feed) return;
  if (!state.rs.feed.length) {
    feed.innerHTML = '<div class="empty">No hits yet — first move is <strong>ping</strong>.</div>';
    return;
  }
  feed.innerHTML = state.rs.feed.map(item =>
    item.type === 'system'
      ? `<article class="event system-event"><div class="event-head"><strong>Room</strong><span class="event-meta">${timeText(item.time)}</span></div><div class="event-body">${esc(item.text)}</div></article>`
      : `<article class="event ${item.action}-event"><div class="event-head"><strong>${item.emoji} ${esc(item.name)} · ${item.action.toUpperCase()}</strong><span class="event-meta">${timeText(item.time)}</span></div><div class="event-body">${item.text ? linkify(item.text) : '<span style="opacity:.6">No attachment</span>'}</div></article>`
  ).join('');
}

function render() {
  updateArenaPlayers();
  renderFeed();
  const sync = $('syncBadge');
  if (sync) {
    sync.textContent = state.connected ? `● Live · ${state.room}` : '○ Connecting';
    sync.classList.toggle('live', state.connected);
  }
  const tb = $('turnBadge');
  if (tb) tb.textContent = state.room ? `Next: ${state.rs.next}` : 'No room';

  const cs = state.rs.seats[state.rs.activeSeat];
  const tt = $('turnText');
  if (tt) {
    tt.textContent = !state.room ? 'Create a room to start.'
      : cs ? `${cs.emoji} ${cs.name} must ${state.rs.next}.`
      : 'Waiting for players to join…';
  }
  const mb = $('myBadge');
  if (mb && state.me.name) mb.textContent = `${state.me.emoji} ${state.me.name}`;
}

// ── ABLY ──────────────────────────────────────────────────────────────
async function connect() {
  if (!state.room) return;
  if (state.realtime) { try { state.realtime.close(); } catch {} state.realtime = null; state.channel = null; }
  const clientId = `${state.me.name || 'player'}-${Math.random().toString(36).slice(2, 6)}`;
  state.realtime = new Ably.Realtime({ authUrl: `/api/ably-auth?clientId=${encodeURIComponent(clientId)}` });
  state.realtime.connection.on('connected', () => { state.connected = true; render(); });
  state.realtime.connection.on('disconnected', () => { state.connected = false; render(); showReconnect('Connection lost. Reconnecting…', false); });
  state.realtime.connection.on('suspended',   () => { state.connected = false; render(); showReconnect('Reconnection failed.', true); });
  state.realtime.connection.on('failed',      () => { state.connected = false; render(); showReconnect('Connection failed.', true); });
  state.channel = state.realtime.channels.get(`pingpong:${state.room}`);
  state.channel.subscribe(msg => {
    const d = msg.data;
    if (msg.name === 'move') {
      state.rs.feed.unshift(d);
      state.rs.feed = state.rs.feed.slice(0, 50);
      state.rs.lastMove = d;
      const prevSeat = d.seat;
      state.rs.next = d.action === 'ping' ? 'pong' : 'ping';
      state.rs.activeSeat = d.seat === 0 ? 1 : 0;
      state.moveCount++;
      // Animations + sound
      animateBall(prevSeat);
      sounds[d.action]();
      // Notification
      if (state.notificationsEnabled && document.hidden && Notification.permission === 'granted') {
        new Notification(`${d.emoji} ${d.name} sent ${d.action.toUpperCase()}`, { body: d.text || 'Your turn!' });
      }
      render();
      // Auto-jump to game screen for the second player
      if (!$('screenGame').classList.contains('active')) showScreen('screenGame');
    }
    if (msg.name === 'seat-claim') {
      state.rs.seats[d.seat] = { name: d.name, emoji: d.emoji, seat: d.seat };
      state.rs.feed.unshift({ type: 'system', text: `${d.emoji} ${d.name} joined ${d.seat === 0 ? 'Ping side' : 'Pong side'}`, time: Date.now() });
      sounds.join();
      render();
      // If share screen and both seats filled → go to game
      if ($('screenShare').classList.contains('active') && state.rs.seats[0] && state.rs.seats[1]) {
        setTimeout(() => showScreen('screenGame'), 600);
      }
    }
    if (msg.name === 'reset') {
      state.rs = { seats: [null, null], next: 'ping', activeSeat: 0, lastMove: null, feed: [{ type: 'system', text: 'Room was reset', time: Date.now() }] };
      state.mySeat = null;
      state.moveCount = 0;
      render();
    }
  });
}

// ── RECONNECT BANNER ──────────────────────────────────────────────────
function showReconnect(msg, btn) {
  const b = $('reconnectBanner'); const m = $('reconnectMsg'); const rb = $('reconnectBtn');
  if (!b) return;
  if (m) m.textContent = msg;
  if (rb) rb.classList.toggle('hidden', !btn);
  b.classList.remove('hidden');
}
function hideReconnect() { const b = $('reconnectBanner'); if (b) b.classList.add('hidden'); }

// ── ACTIONS ───────────────────────────────────────────────────────────
async function startGame() {
  const nameVal = $('obName').value.trim().slice(0, 24);
  if (!nameVal) { $('obNameError').textContent = 'Please enter your name.'; $('obName').focus(); return; }
  $('obNameError').textContent = '';
  state.me.name  = nameVal;
  state.me.emoji = $('obEmoji').value || '🏓';

  // Generate room code, set hash
  const code = shortCode();
  state.room = code;
  setHash(code);

  // Render share screen
  $('shareYouLabel').textContent = `${state.me.emoji} ${state.me.name}`;
  const shareUrl = location.href;
  $('shareUrl').textContent = shareUrl;
  renderQR('qrBox', shareUrl);
  showScreen('screenShare');

  // Connect to Ably
  await connect();

  // Claim seat 0 (Ping side)
  state.mySeat = 0;
  state.rs.seats[0] = { name: state.me.name, emoji: state.me.emoji, seat: 0 };
  if (state.channel) {
    await state.channel.publish('seat-claim', { seat: 0, name: state.me.name, emoji: state.me.emoji, time: Date.now() });
  }
  render();
}

async function joinExisting(roomCode) {
  // Second player arrived via QR/link
  state.room = roomCode;
  setHash(roomCode);
  await connect();
  // Go straight to game, claim seat 1
  showScreen('screenGame');
  render();
  // Auto-claim pong side after a tick (channel needs a moment)
  setTimeout(async () => {
    if (state.mySeat !== null) return; // already claimed
    const open = state.rs.seats.findIndex(s => !s);
    const seat = open === -1 ? 1 : open;
    state.mySeat = seat;
    state.rs.seats[seat] = { name: state.me.name, emoji: state.me.emoji, seat };
    if (state.channel) {
      await state.channel.publish('seat-claim', { seat, name: state.me.name, emoji: state.me.emoji, time: Date.now() });
    }
    render();
  }, 1200);
}

async function sendTurn() {
  const err = $('composerError');
  if (err) err.textContent = '';
  if (!state.channel) { if (err) err.textContent = 'Not connected.'; return; }
  if (state.mySeat === null) { if (err) err.textContent = 'Claim a seat first.'; return; }
  if (state.rs.activeSeat !== state.mySeat) { if (err) err.textContent = 'Not your turn yet.'; return; }
  const seat = state.rs.seats[state.mySeat];
  if (!seat) { if (err) err.textContent = 'Seat missing — refresh.'; return; }
  const text = ($('messageInput').value || '').trim();
  if (text.length > 280) { if (err) err.textContent = 'Message too long (max 280 chars).'; return; }
  const payload = { roomCode: state.room, action: state.rs.next, seat: state.mySeat, name: seat.name, emoji: seat.emoji, text, expectedNext: state.rs.next };
  const btn = $('sendBtn');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res = await fetch('/api/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) { if (err) err.textContent = data.error || 'Failed.'; return; }
    $('messageInput').value = '';
    updateCharCount();
  } finally { btn.disabled = false; btn.textContent = 'Send'; }
}

async function resetRoom() {
  if (!state.channel) return;
  if (!confirm('Reset this room for both players?')) return;
  await state.channel.publish('reset', { time: Date.now() });
}

function openShareModal() {
  if (!state.room) return;
  const url = location.origin + location.pathname + '#room=' + encodeURIComponent(state.room);
  $('shareUrlModal').textContent = url;
  renderQR('qrBoxModal', url);
  $('qrModal').classList.remove('hidden');
}
function closeShareModal() { $('qrModal').classList.add('hidden'); }

async function copyLink(outputEl, url) {
  const u = url || location.href;
  try { await navigator.clipboard.writeText(u); if (outputEl) { outputEl.textContent = 'Copied ✓'; setTimeout(() => outputEl.textContent = 'Copy link', 1400); } }
  catch { prompt('Copy link:', u); }
}

async function requestNotifications() {
  if (!('Notification' in window)) { alert('Notifications not supported.'); return; }
  const r = await Notification.requestPermission();
  state.notificationsEnabled = r === 'granted';
  const btn = $('shareNotifyBtn');
  if (btn) btn.textContent = state.notificationsEnabled ? '🔔 On' : '🔔 Notify me';
}

function updateCharCount() {
  const len = ($('messageInput').value || '').length;
  const cc = $('charCount');
  if (cc) { cc.textContent = `${len} / 280`; cc.classList.toggle('over', len > 280); }
}

// ── ONBOARDING FOR JOINING PLAYER ────────────────────────────────────
function showJoinFlow(roomCode) {
  // Show onboarding with a "Join room" CTA instead
  $('obStartBtn').textContent = 'Join game →';
  const hint = document.createElement('p');
  hint.style.cssText = 'font-size:var(--text-xs);color:var(--muted);text-align:center';
  hint.textContent = `Joining room ${roomCode}`;
  $('cardName').appendChild(hint);
  $('obStartBtn').onclick = async () => {
    const nameVal = $('obName').value.trim().slice(0, 24);
    if (!nameVal) { $('obNameError').textContent = 'Please enter your name.'; $('obName').focus(); return; }
    $('obNameError').textContent = '';
    state.me.name  = nameVal;
    state.me.emoji = $('obEmoji').value || '🏓';
    await joinExisting(roomCode);
  };
}

// ── BOOT ──────────────────────────────────────────────────────────────
function boot() {
  initTheme();
  renderOnboardEmoji();

  const hashRoom = readHash();

  if (hashRoom) {
    // Second player: show onboarding to collect name, then join
    showScreen('screenOnboard');
    showJoinFlow(hashRoom);
  } else {
    showScreen('screenOnboard');
    $('obStartBtn').onclick = startGame;
  }

  // Game screen events
  $('sendBtn').onclick = sendTurn;
  $('resetRoomBtn').onclick = resetRoom;
  $('shareAgainBtn').onclick = openShareModal;
  $('qrModalClose').onclick = closeShareModal;
  $('qrModal').onclick = e => { if (e.target === $('qrModal')) closeShareModal(); };
  $('reconnectBtn').onclick = () => connect();

  const cb = $('shareCopyBtn');
  if (cb) cb.onclick = () => copyLink(cb, location.href);
  const mcb = $('modalCopyBtn');
  if (mcb) mcb.onclick = () => copyLink(mcb, $('shareUrlModal').textContent);
  const nb = $('shareNotifyBtn');
  if (nb) nb.onclick = requestNotifications;

  // Keyboard shortcuts
  const mi = $('messageInput');
  if (mi) {
    mi.addEventListener('input', updateCharCount);
    mi.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendTurn(); }
    });
  }
  const obName = $('obName');
  if (obName) obName.addEventListener('keydown', e => { if (e.key === 'Enter') $('obStartBtn').click(); });
}
boot();
