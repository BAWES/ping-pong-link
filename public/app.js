// ── state ──────────────────────────────────────────────────────────────
const state = {
  room: '',
  me: { name: '', emoji: '🏓' },
  mySeat: null,
  rs: { seats: [null, null], next: 'ping', activeSeat: 0, lastMove: null, feed: [] },
  realtime: null,
  channel: null,
  connected: false,
  notificationsEnabled: false,
  reconnectAttempts: 0,
};

// ── element refs ───────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {
  roomCode: $('roomCode'),
  makeRoomBtn: $('makeRoomBtn'),
  copyRoomBtn: $('copyRoomBtn'),
  notifyBtn: $('notifyBtn'),
  playerName: $('playerName'),
  playerEmoji: $('playerEmoji'),
  savePlayerBtn: $('savePlayerBtn'),
  claimSeatBtn: $('claimSeatBtn'),
  playersView: $('playersView'),
  turnBadge: $('turnBadge'),
  syncBadge: $('syncBadge'),
  turnText: $('turnText'),
  ball: $('ball'),
  impactText: $('impactText'),
  messageInput: $('messageInput'),
  sendBtn: $('sendBtn'),
  resetRoomBtn: $('resetRoomBtn'),
  feed: $('feed'),
  emojiGrid: $('emojiGrid'),
  themeToggle: $('themeToggle'),
  errorBanner: $('errorBanner'),
  errorMsg: $('errorMsg'),
  errorDismiss: $('errorDismiss'),
  reconnectBanner: $('reconnectBanner'),
  reconnectMsg: $('reconnectMsg'),
  reconnectBtn: $('reconnectBtn'),
  charCount: $('charCount'),
  roomCodeError: $('roomCodeError'),
  playerError: $('playerError'),
  composerError: $('composerError'),
};
const emojiChoices = ['🏓', '🔥', '🦄', '🤖', '🐯', '🎧', '🌊', '⚡', '🍉', '🛰️', '🐼', '🎯'];
const esc = (s = '') =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const linkify = (t = '') =>
  esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
const shortCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const timeText = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const setHash = (code) => {
  const u = new URL(location.href);
  u.hash = code ? '#room=' + encodeURIComponent(code) : '';
  history.replaceState({}, '', u);
};
const readHash = () => {
  const m = (location.hash || '').match(/room=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : '';
};

// ── validation ─────────────────────────────────────────────────────────
const ROOM_RE = /^[a-zA-Z0-9_-]+$/;
function validateRoomCode(code) {
  if (!code || !ROOM_RE.test(code)) return 'Room code can only contain letters, numbers, hyphens, and underscores.';
  if (code.length > 24) return 'Room code is too long.';
  return '';
}
function validateName(name) {
  if (!name || !name.trim()) return 'Name is required.';
  if (name.length > 32) return 'Name is too long (max 32 characters).';
  return '';
}
function validateEmoji(emoji) {
  if (!emoji || !emoji.trim()) return 'Emoji is required.';
  return '';
}

function showFieldError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('visible', !!msg);
}

// ── error banner ───────────────────────────────────────────────────────
let errorTimer = null;
function showError(msg, focusEl) {
  els.errorMsg.textContent = msg;
  els.errorBanner.classList.remove('hidden');
  clearTimeout(errorTimer);
  errorTimer = setTimeout(clearError, 6000);
  if (focusEl) focusEl.focus();
}
function clearError() {
  els.errorBanner.classList.add('hidden');
  els.errorMsg.textContent = '';
  clearTimeout(errorTimer);
}

// ── reconnect banner ───────────────────────────────────────────────────
function showReconnect(msg, showButton) {
  els.reconnectMsg.textContent = msg;
  els.reconnectBanner.classList.remove('hidden');
  els.reconnectBtn.classList.toggle('hidden', !showButton);
}
function hideReconnect() {
  els.reconnectBanner.classList.add('hidden');
  state.reconnectAttempts = 0;
}

// ── theme ──────────────────────────────────────────────────────────────
function initTheme() {
  let t = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  els.themeToggle.textContent = t === 'dark' ? '☀︎' : '☾';
  els.themeToggle.onclick = () => {
    t = t === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    els.themeToggle.textContent = t === 'dark' ? '☀︎' : '☾';
  };
}

// ── render ─────────────────────────────────────────────────────────────
function renderEmojiGrid() {
  els.emojiGrid.innerHTML = '';
  emojiChoices.forEach((e) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'emoji-btn' + (e === state.me.emoji ? ' active' : '');
    b.textContent = e;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', e === state.me.emoji ? 'true' : 'false');
    b.setAttribute('aria-label', `Emoji: ${e}`);
    if (e === state.me.emoji) b.setAttribute('aria-pressed', 'true');
    b.onclick = () => {
      state.me.emoji = e;
      els.playerEmoji.value = e;
      renderEmojiGrid();
    };
    els.emojiGrid.appendChild(b);
  });
}
function renderPlayers() {
  els.playersView.innerHTML = '';
  ['Ping side', 'Pong side'].forEach((label, i) => {
    const seat = state.rs.seats[i];
    const div = document.createElement('div');
    div.className = 'player-pill' + (state.rs.activeSeat === i ? ' active' : '');
    div.setAttribute('aria-label', `${label}: ${seat ? seat.name : 'Open seat'}`);
    div.innerHTML = seat
      ? `<div class="name-line"><span aria-hidden="true">${seat.emoji}</span><span>${esc(seat.name)}</span></div><div style="font-size:var(--text-xs);color:var(--color-text-muted)">${label}</div>`
      : `<div class="name-line"><span aria-hidden="true">○</span><span>Open seat</span></div><div style="font-size:var(--text-xs);color:var(--color-text-muted)">${label}</div>`;
    els.playersView.appendChild(div);
  });
}
function renderFeed() {
  if (!state.rs.feed.length) {
    els.feed.innerHTML = '<div class="empty">No hits yet. First move is <strong>ping</strong>.</div>';
    return;
  }
  els.feed.innerHTML = state.rs.feed
    .map((item) =>
      item.type === 'system'
        ? `<article class="event" aria-label="System event: ${esc(item.text)}"><div class="event-head"><strong>Room</strong><span class="event-meta">${timeText(item.time)}</span></div><div class="event-body muted">${esc(item.text)}</div></article>`
        : `<article class="event" aria-label="Move by ${esc(item.name)}: ${item.action.toUpperCase()}"><div class="event-head"><strong>${item.emoji} ${esc(item.name)} · ${item.action.toUpperCase()}</strong><span class="event-meta">${timeText(item.time)}</span></div><div class="event-body">${item.text ? linkify(item.text) : '<span class="muted">No attachment</span>'}</div></article>`,
    )
    .join('');
}
function render() {
  renderPlayers();
  renderFeed();
  els.syncBadge.textContent = state.connected ? `● Realtime · ${state.room || '?'}` : '○ Disconnected';
  els.turnBadge.textContent = state.room ? `Next: ${state.rs.next}` : 'Waiting for room';
  const cs = state.rs.seats[state.rs.activeSeat];
  els.turnText.textContent = !state.room
    ? 'Create a room to start.'
    : cs
      ? `${cs.emoji} ${cs.name} must send ${state.rs.next}.`
      : `Seat ${state.rs.activeSeat + 1} is open — claim it.`;
  if (state.rs.lastMove) {
    els.impactText.textContent = `${state.rs.lastMove.emoji} ${state.rs.lastMove.name} → ${state.rs.lastMove.action.toUpperCase()}`;
    els.ball.className = 'ball ' + (state.rs.lastMove.seat === 0 ? 'left-side' : 'right-side');
  } else {
    els.impactText.textContent = 'No rally yet';
    els.ball.className = 'ball';
  }
}

// ── ably realtime ──────────────────────────────────────────────────────
async function connect() {
  if (!state.room) return;
  if (state.realtime) {
    try {
      state.realtime.close();
    } catch {}
    state.realtime = null;
    state.channel = null;
  }
  const clientId = `${state.me.name || 'player'}-${Math.random().toString(36).slice(2, 6)}`;
  state.realtime = new Ably.Realtime({ authUrl: `/api/ably-auth?clientId=${encodeURIComponent(clientId)}` });
  state.realtime.connection.on('connected', () => {
    state.connected = true;
    hideReconnect();
    render();
  });
  state.realtime.connection.on('disconnected', () => {
    state.connected = false;
    showReconnect('Connection lost. Reconnecting automatically…', false);
    render();
  });
  state.realtime.connection.on('suspended', () => {
    state.connected = false;
    state.reconnectAttempts++;
    showReconnect('Reconnection failed. Click to try again.', true);
    render();
  });
  state.realtime.connection.on('failed', () => {
    state.connected = false;
    showReconnect('Connection failed. Check your network and try again.', true);
    render();
  });
  state.channel = state.realtime.channels.get(`pingpong:${state.room}`);
  state.channel.subscribe((msg) => {
    const d = msg.data;
    if (msg.name === 'move') {
      state.rs.feed.unshift(d);
      state.rs.feed = state.rs.feed.slice(0, 50);
      state.rs.lastMove = d;
      state.rs.next = d.action === 'ping' ? 'pong' : 'ping';
      state.rs.activeSeat = d.seat === 0 ? 1 : 0;
      if (state.notificationsEnabled && document.hidden && Notification.permission === 'granted') {
        new Notification(`${d.emoji} ${d.name} sent ${d.action.toUpperCase()}`, { body: d.text || 'Your turn!' });
      }
      render();
    }
    if (msg.name === 'seat-claim') {
      state.rs.seats[d.seat] = { name: d.name, emoji: d.emoji, seat: d.seat };
      state.rs.feed.unshift({
        type: 'system',
        text: `${d.emoji} ${d.name} joined ${d.seat === 0 ? 'Ping side' : 'Pong side'}`,
        time: Date.now(),
      });
      render();
    }
    if (msg.name === 'reset') {
      state.rs = {
        seats: [null, null],
        next: 'ping',
        activeSeat: 0,
        lastMove: null,
        feed: [{ type: 'system', text: 'Room was reset', time: Date.now() }],
      };
      state.mySeat = null;
      render();
    }
  });
}

// ── actions ────────────────────────────────────────────────────────────
async function makeRoom() {
  const raw = (els.roomCode.value || shortCode())
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 24);
  const code = raw || shortCode();
  const err = validateRoomCode(code);
  if (err) {
    showFieldError(els.roomCodeError, err);
    els.roomCode.classList.add('input-error');
    els.roomCode.focus();
    return;
  }
  showFieldError(els.roomCodeError, '');
  els.roomCode.classList.remove('input-error');
  state.room = code;
  els.roomCode.value = code;
  setHash(code);
  await connect();
  render();
  els.playerName.focus();
}
async function copyLink() {
  if (!state.room) await makeRoom();
  if (!state.room) return;
  try {
    await navigator.clipboard.writeText(location.href);
    els.copyRoomBtn.textContent = 'Copied ✓';
    setTimeout(() => (els.copyRoomBtn.textContent = 'Copy link'), 1400);
  } catch {
    prompt('Copy this room link:', location.href);
  }
}
async function requestNotifications() {
  if (!('Notification' in window)) {
    showError('Notifications are not supported in this browser.');
    return;
  }
  const r = await Notification.requestPermission();
  state.notificationsEnabled = r === 'granted';
  els.notifyBtn.textContent = state.notificationsEnabled ? '🔔 Notifications on' : '🔔 Enable notifications';
}
function savePlayer() {
  const name = (els.playerName.value || 'Player').trim().slice(0, 32);
  const emoji = (els.playerEmoji.value || '🏓').trim().slice(0, 2);
  const nameErr = validateName(name);
  const emojiErr = validateEmoji(emoji);
  if (nameErr || emojiErr) {
    showFieldError(els.playerError, nameErr || emojiErr);
    if (nameErr) {
      els.playerName.classList.add('input-error');
      els.playerName.focus();
    } else {
      els.playerEmoji.classList.add('input-error');
      els.playerEmoji.focus();
    }
    return false;
  }
  showFieldError(els.playerError, '');
  els.playerName.classList.remove('input-error');
  els.playerEmoji.classList.remove('input-error');
  state.me.name = name;
  state.me.emoji = emoji || '🏓';
  els.playerName.value = state.me.name;
  els.playerEmoji.value = state.me.emoji;
  renderEmojiGrid();
  render();
  return true;
}
async function claimSeat() {
  if (!savePlayer()) return;
  if (!state.channel) {
    showError('Create or join a room first.', els.roomCode);
    return;
  }
  const open = state.rs.seats.findIndex((s) => !s);
  const seat = open === -1 ? 0 : open;
  state.mySeat = seat;
  state.rs.seats[seat] = { name: state.me.name, emoji: state.me.emoji, seat };
  await state.channel.publish('seat-claim', { seat, name: state.me.name, emoji: state.me.emoji, time: Date.now() });
  render();
  els.messageInput.focus();
}
async function sendTurn() {
  showFieldError(els.composerError, '');
  if (!state.channel) {
    showError('Join a room first.', els.roomCode);
    return;
  }
  if (state.mySeat === null) {
    showError('Claim a seat first.', els.claimSeatBtn);
    return;
  }
  if (state.rs.activeSeat !== state.mySeat) {
    showFieldError(els.composerError, 'Not your turn yet.');
    return;
  }
  const seat = state.rs.seats[state.mySeat];
  if (!seat) {
    showError('Seat missing — claim again.', els.claimSeatBtn);
    return;
  }
  const text = els.messageInput.value.trim();
  if (text.length > 1000) {
    showFieldError(els.composerError, 'Message is too long (max 1000 characters).');
    return;
  }
  const payload = {
    roomCode: state.room,
    action: state.rs.next,
    seat: state.mySeat,
    name: seat.name,
    emoji: seat.emoji,
    text,
    expectedNext: state.rs.next,
  };
  els.sendBtn.disabled = true;
  els.sendBtn.textContent = 'Sending…';
  try {
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      showFieldError(els.composerError, data.error || 'Failed to send move.');
      return;
    }
    els.messageInput.value = '';
    updateCharCount();
    els.messageInput.focus();
  } finally {
    els.sendBtn.disabled = false;
    els.sendBtn.textContent = 'Send move';
  }
}
async function resetRoom() {
  if (!state.channel) return;
  if (!confirm('Reset this room for both players?')) return;
  await state.channel.publish('reset', { time: Date.now() });
}
function retryConnect() {
  connect();
}

// ── character count ────────────────────────────────────────────────────
function updateCharCount() {
  const len = els.messageInput.value.length;
  els.charCount.textContent = `${len} / 1000`;
  els.charCount.classList.toggle('over', len > 1000);
}

// ── boot ───────────────────────────────────────────────────────────────
function boot() {
  initTheme();
  const hashRoom = readHash();
  if (hashRoom) {
    state.room = hashRoom;
    els.roomCode.value = hashRoom;
  }
  els.playerEmoji.value = state.me.emoji;
  renderEmojiGrid();
  render();
  els.makeRoomBtn.onclick = makeRoom;
  els.copyRoomBtn.onclick = copyLink;
  els.notifyBtn.onclick = requestNotifications;
  els.savePlayerBtn.onclick = () => {
    if (savePlayer()) els.playerName.focus();
  };
  els.claimSeatBtn.onclick = claimSeat;
  els.sendBtn.onclick = sendTurn;
  els.resetRoomBtn.onclick = resetRoom;
  els.errorDismiss.onclick = clearError;
  els.reconnectBtn.onclick = retryConnect;

  // keyboard: Enter on room code -> makeRoom
  els.roomCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') makeRoom();
  });
  // keyboard: Enter on player inputs -> savePlayer then focus claim seat
  els.playerName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      savePlayer();
      els.claimSeatBtn.focus();
    }
  });
  els.playerEmoji.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      savePlayer();
      els.claimSeatBtn.focus();
    }
  });
  // keyboard: Ctrl+Enter / Cmd+Enter on message -> sendTurn
  els.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendTurn();
    }
  });
  // character count
  els.messageInput.addEventListener('input', updateCharCount);
  // clear field errors on input
  els.roomCode.addEventListener('input', () => {
    showFieldError(els.roomCodeError, '');
    els.roomCode.classList.remove('input-error');
  });
  els.playerName.addEventListener('input', () => {
    showFieldError(els.playerError, '');
    els.playerName.classList.remove('input-error');
  });
  els.playerEmoji.addEventListener('input', () => {
    showFieldError(els.playerError, '');
    els.playerEmoji.classList.remove('input-error');
  });

  if (state.room) connect();
}
boot();
