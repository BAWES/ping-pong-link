// ── CONFIG ───────────────────────────────────────────────────────────────
const EMOJI_CHOICES = ['🏓', '🔥', '🦄', '🤖', '🐯', '🎧', '🌊', '⚡', '🍉', '🛰️', '🐼', '🎯', '🎸', '🌙', '🦊', '🎯'];
const MAX_FEED = 60;

// ── STATE ─────────────────────────────────────────────────────────────────
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

// ── UTILS ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
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
const showFieldError = (el, msg) => {
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('visible', !!msg);
};

// ── SCREENS ───────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });
  const s = $(id);
  s.classList.remove('hidden');
  s.classList.add('active');
}

// ── THEME ─────────────────────────────────────────────────────────────────
let theme = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
function setTheme(t) {
  theme = t;
  document.documentElement.dataset.theme = t;
  const icon = t === 'dark' ? '☀︎' : '☾';
  if ($('themeToggle')) $('themeToggle').textContent = icon;
  if ($('themeToggleGame')) $('themeToggleGame').textContent = icon;
}
function toggleTheme() {
  setTheme(theme === 'dark' ? 'light' : 'dark');
}

// ── ONBOARDING ────────────────────────────────────────────────────────────
function buildEmojiGrid(gridId) {
  const grid = $(gridId);
  if (!grid) return;
  grid.innerHTML = '';
  EMOJI_CHOICES.forEach((e) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'emoji-btn' + (e === state.me.emoji ? ' active' : '');
    b.textContent = e;
    b.setAttribute('aria-label', `Emoji ${e}`);
    b.onclick = () => {
      state.me.emoji = e;
      buildEmojiGrid(gridId);
    };
    grid.appendChild(b);
  });
}

function showStep(id) {
  ['step-name', 'step-room', 'step-qr'].forEach((s) => {
    const el = $(s);
    if (el) el.classList.toggle('hidden', s !== id);
  });
}

function buildQR(containerId, url) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = '';
  new QRCode(el, {
    text: url,
    width: 200,
    height: 200,
    colorDark: '#000',
    colorLight: '#fff',
    correctLevel: QRCode.CorrectLevel.M,
  });
}

function setupOnboarding() {
  const hashRoom = readHash();
  buildEmojiGrid('ob-emoji-row');
  setTheme(theme);

  $('ob-next-btn').onclick = () => {
    const name = ($('ob-name').value || '').trim();
    if (!name) {
      showFieldError($('ob-name-error'), 'Name is required.');
      $('ob-name').classList.add('input-error');
      $('ob-name').focus();
      return;
    }
    showFieldError($('ob-name-error'), '');
    $('ob-name').classList.remove('input-error');
    state.me.name = name;
    $('ob-greeting').innerHTML = `Hey <strong>${esc(name)}</strong> ${state.me.emoji}`;
    if (hashRoom) {
      state.room = hashRoom;
      $('guest-room-code').textContent = hashRoom;
      $('guest-join-wrap').classList.remove('hidden');
      $('host-create-wrap').classList.add('hidden');
    } else {
      $('guest-join-wrap').classList.add('hidden');
      $('host-create-wrap').classList.remove('hidden');
    }
    showStep('step-room');
  };

  $('guest-join-btn').onclick = async () => {
    await enterGame();
    autoClaimSeat();
  };

  $('host-create-btn').onclick = async () => {
    const code = shortCode();
    state.room = code;
    setHash(code);
    const shareUrl = location.href;
    $('qr-link-input').value = shareUrl;
    buildQR('qr-wrap', shareUrl);
    showStep('step-qr');
  };

  $('qr-copy-btn').onclick = () => copyText($('qr-link-input').value, $('qr-copy-btn'));
  $('qr-continue-btn').onclick = async () => {
    await enterGame();
    autoClaimSeat();
  };
  $('qr-show-qr-btn').onclick = () => buildQR('qr-wrap', $('qr-link-input').value);

  $('ob-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('ob-next-btn').click();
  });
  $('ob-name').addEventListener('input', () => {
    showFieldError($('ob-name-error'), '');
    $('ob-name').classList.remove('input-error');
  });

  if ($('themeToggle')) $('themeToggle').onclick = toggleTheme;
}

// ── ENTER GAME ────────────────────────────────────────────────────────────
async function enterGame() {
  showScreen('screen-game');
  $('feedRoomCode').textContent = state.room;
  renderGame();
  await connect();
}

// ── AUTO CLAIM SEAT ───────────────────────────────────────────────────────
async function autoClaimSeat() {
  if (!state.channel) {
    setTimeout(autoClaimSeat, 800);
    return;
  }
  const open = state.rs.seats.findIndex((s) => !s);
  const seat = open === -1 ? 0 : open;
  state.mySeat = seat;
  state.rs.seats[seat] = { name: state.me.name, emoji: state.me.emoji, seat };
  await state.channel.publish('seat-claim', { seat, name: state.me.name, emoji: state.me.emoji, time: Date.now() });
  renderGame();
}

// ── ABLY CONNECT ──────────────────────────────────────────────────────────
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
    renderGame();
  });
  state.realtime.connection.on('disconnected', () => {
    state.connected = false;
    showReconnect('Connection lost. Reconnecting…', false);
    renderGame();
  });
  state.realtime.connection.on('suspended', () => {
    state.connected = false;
    showReconnect('Reconnection failed.', true);
    renderGame();
  });
  state.realtime.connection.on('failed', () => {
    state.connected = false;
    showReconnect('Connection failed. Check network.', true);
    renderGame();
  });
  state.channel = state.realtime.channels.get(`pingpong:${state.room}`);
  state.channel.subscribe((msg) => {
    const d = msg.data;
    if (msg.name === 'move') {
      state.rs.feed.unshift(d);
      state.rs.feed = state.rs.feed.slice(0, MAX_FEED);
      state.rs.lastMove = d;
      state.rs.next = d.action === 'ping' ? 'pong' : 'ping';
      state.rs.activeSeat = d.seat === 0 ? 1 : 0;
      animateBall(d.seat);
      if (state.notificationsEnabled && document.hidden && Notification.permission === 'granted')
        new Notification(`${d.emoji} ${d.name} sent ${d.action.toUpperCase()}`, { body: d.text || 'Your turn!' });
      renderGame();
    }
    if (msg.name === 'seat-claim') {
      state.rs.seats[d.seat] = { name: d.name, emoji: d.emoji, seat: d.seat };
      state.rs.feed.unshift({
        type: 'system',
        text: `${d.emoji} ${d.name} joined ${d.seat === 0 ? 'Ping side' : 'Pong side'}`,
        time: Date.now(),
      });
      renderGame();
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
      renderGame();
    }
  });
}

// ── BALL ANIMATION ────────────────────────────────────────────────────────
function animateBall(seat) {
  const ball = $('ball');
  if (!ball) return;
  ball.classList.remove('ping-side', 'pong-side', 'hit');
  void ball.offsetWidth;
  ball.classList.add(seat === 0 ? 'ping-side' : 'pong-side', 'hit');
  const paddleId = seat === 0 ? 'paddleLeft' : 'paddleRight';
  const paddle = $(paddleId);
  if (paddle) paddle.style.top = 28 + Math.random() * 44 + '%';
}

// ── RENDER ────────────────────────────────────────────────────────────────
function renderGame() {
  renderPlayers();
  renderFeed();
  renderComposer();
  renderSyncBadge();
}

function renderPlayers() {
  const view = $('playersView');
  if (!view) return;
  const labels = ['Ping side', 'Pong side'];
  view.innerHTML = '';
  state.rs.seats.forEach((seat, i) => {
    if (i === 1) {
      const vs = document.createElement('span');
      vs.className = 'vs-badge';
      vs.textContent = 'VS';
      view.appendChild(vs);
    }
    const pill = document.createElement('div');
    pill.className = 'player-pill' + (state.rs.activeSeat === i ? ' active' : '');
    pill.innerHTML = seat
      ? `<span class="pip"></span><span>${seat.emoji} ${esc(seat.name)}</span><span class="seat-label">${labels[i]}</span>`
      : `<span class="pip"></span><span style="color:var(--color-text-faint)">Open seat</span><span class="seat-label">${labels[i]}</span>`;
    view.appendChild(pill);
  });
}

function renderFeed() {
  const feed = $('feed');
  if (!feed) return;
  if (!state.rs.feed.length) {
    feed.innerHTML = '<div class="feed-empty">No hits yet.<br>First move is <strong>ping</strong>.</div>';
    return;
  }
  feed.innerHTML = state.rs.feed
    .map((item) => {
      if (item.type === 'system')
        return `<article class="event system"><div class="event-head"><span class="event-who" style="color:var(--color-text-faint)">Room</span><span class="event-time">${timeText(item.time)}</span></div><div class="event-body">${esc(item.text)}</div></article>`;
      return `<article class="event ${item.action}"><div class="event-head"><span class="event-who">${item.emoji} ${esc(item.name)}</span><span class="event-action ${item.action}">${item.action.toUpperCase()}</span><span class="event-time">${timeText(item.time)}</span></div>${item.text ? `<div class="event-body">${linkify(item.text)}</div>` : ''}</article>`;
    })
    .join('');
}

function renderComposer() {
  const sendBtn = $('sendBtn');
  const hint = $('composerHint');
  if (!sendBtn || !hint) return;
  const myTurn = state.mySeat !== null && state.rs.activeSeat === state.mySeat && state.channel;
  sendBtn.disabled = !myTurn;
  if (!state.room) hint.innerHTML = 'Create or join a room first.';
  else if (state.mySeat === null) hint.innerHTML = 'Waiting to claim a seat…';
  else if (!myTurn) hint.innerHTML = `Waiting for opponent's <strong>${state.rs.next}</strong>…`;
  else hint.innerHTML = `Your turn: send <strong>${state.rs.next}</strong>`;
  const turnText = $('turnText');
  if (turnText) {
    const cs = state.rs.seats[state.rs.activeSeat];
    turnText.textContent = cs ? `${cs.emoji} ${cs.name} → ${state.rs.next.toUpperCase()}` : 'Waiting for players…';
  }
}

function renderSyncBadge() {
  const badge = $('syncBadge');
  if (!badge) return;
  badge.textContent = state.connected ? `● ${state.room}` : '○ Connecting';
  badge.className = 'badge' + (state.connected ? ' connected' : '');
}

// ── SEND TURN ─────────────────────────────────────────────────────────────
async function sendTurn() {
  showFieldError($('composerError'), '');
  if (!state.channel) {
    showFieldError($('composerError'), 'Join a room first.');
    return;
  }
  if (state.mySeat === null) {
    showFieldError($('composerError'), 'Seat not claimed yet.');
    return;
  }
  if (state.rs.activeSeat !== state.mySeat) {
    showFieldError($('composerError'), 'Not your turn.');
    return;
  }
  const seat = state.rs.seats[state.mySeat];
  if (!seat) {
    showFieldError($('composerError'), 'Seat missing — refresh.');
    return;
  }
  const text = ($('messageInput').value || '').trim();
  if (text.length > 1000) {
    showFieldError($('composerError'), 'Message too long (max 1000).');
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
  const sendBtn = $('sendBtn');
  sendBtn.disabled = true;
  try {
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      showFieldError($('composerError'), data.error || 'Failed to send.');
      return;
    }
    $('messageInput').value = '';
    updateCharCount();
  } finally {
    renderComposer();
  }
}

// ── SHARE / QR MODAL ──────────────────────────────────────────────────────
function openQRModal() {
  const url = location.href;
  $('qr-modal-link').value = url;
  buildQR('qr-modal-wrap', url);
  $('qr-modal').classList.remove('hidden');
}

// ── COPY HELPER ───────────────────────────────────────────────────────────
async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => (btn.textContent = orig), 1500);
  } catch {
    prompt('Copy this link:', text);
  }
}

// ── CHAR COUNT ────────────────────────────────────────────────────────────
function updateCharCount() {
  const len = ($('messageInput') || { value: '' }).value.length;
  const cc = $('charCount');
  if (cc) {
    cc.textContent = `${len} / 1000`;
    cc.classList.toggle('over', len > 1000);
  }
}

// ── BANNERS ───────────────────────────────────────────────────────────────
let errorTimer = null;
function showError(msg) {
  $('errorMsg').textContent = msg;
  $('errorBanner').classList.remove('hidden');
  clearTimeout(errorTimer);
  errorTimer = setTimeout(clearError, 6000);
}
function clearError() {
  $('errorBanner').classList.add('hidden');
}
function showReconnect(msg, btn) {
  $('reconnectMsg').textContent = msg;
  $('reconnectBanner').classList.remove('hidden');
  $('reconnectBtn').classList.toggle('hidden', !btn);
}
function hideReconnect() {
  $('reconnectBanner').classList.add('hidden');
}

// ── BOOT ──────────────────────────────────────────────────────────────────
function boot() {
  setTheme(theme);
  setupOnboarding();

  if ($('themeToggleGame')) $('themeToggleGame').onclick = toggleTheme;
  if ($('shareBtn')) $('shareBtn').onclick = openQRModal;
  if ($('qrModalClose')) $('qrModalClose').onclick = () => $('qr-modal').classList.add('hidden');
  if ($('qr-modal'))
    $('qr-modal').addEventListener('click', (e) => {
      if (e.target === $('qr-modal')) $('qr-modal').classList.add('hidden');
    });
  if ($('qr-modal-copy')) $('qr-modal-copy').onclick = () => copyText($('qr-modal-link').value, $('qr-modal-copy'));
  if ($('sendBtn')) $('sendBtn').onclick = sendTurn;
  if ($('resetRoomBtn'))
    $('resetRoomBtn').onclick = async () => {
      if (!state.channel) return;
      if (!confirm('Reset room for both players?')) return;
      await state.channel.publish('reset', { time: Date.now() });
    };
  if ($('errorDismiss')) $('errorDismiss').onclick = clearError;
  if ($('reconnectBtn')) $('reconnectBtn').onclick = () => connect();
  if ($('messageInput')) {
    $('messageInput').addEventListener('input', updateCharCount);
    $('messageInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendTurn();
      }
    });
  }

  showScreen('screen-onboard');
}

boot();
