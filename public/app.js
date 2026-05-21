// ── CONFIG ────────────────────────────────────────────────────────────────
const EMOJI_CHOICES = ['🏓','🔥','🦄','🤖','🐯','🎧','🌊','⚡','🍉','🛰️','🐼','🎯','🎸','🌙','🦊','🎨'];
const MAX_FEED = 60;
// Session key is scoped to the room so two tabs in different rooms don't clash
const sessKey = (room) => `pp:${room}`;

// ── SESSION HELPERS ───────────────────────────────────────────────────────
// Stored: { name, emoji, seat, clientId }
// Keyed per-room so each room/tab has its own record.
function saveSession(room, data) {
  try { sessionStorage.setItem(sessKey(room), JSON.stringify(data)); } catch {}
}
function loadSession(room) {
  try { return JSON.parse(sessionStorage.getItem(sessKey(room)) || 'null'); } catch { return null; }
}
function clearSession(room) {
  try { sessionStorage.removeItem(sessKey(room)); } catch {}
}
// Generate a stable per-tab client ID, stored in sessionStorage (not per-room)
function getOrCreateClientId() {
  try {
    let id = sessionStorage.getItem('pp:clientId');
    if (!id) { id = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('pp:clientId', id); }
    return id;
  } catch { return Math.random().toString(36).slice(2, 10); }
}

// ── STATE ─────────────────────────────────────────────────────────────────
const state = {
  room: '',
  me: { name: '', emoji: '🏓' },
  mySeat: null,        // 0 = ping/host, 1 = pong/guest — assigned ONCE, never changed
  myClientId: getOrCreateClientId(),
  rs: { seats: [null, null], next: 'ping', activeSeat: 0, lastMove: null, feed: [] },
  realtime: null,
  channel: null,
  connected: false,
};

// ── UTILS ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const esc = (s = '') =>
  s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
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
    s.classList.remove('active'); s.classList.add('hidden');
  });
  const s = $(id);
  if (s) { s.classList.remove('hidden'); s.classList.add('active'); }
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
function toggleTheme() { setTheme(theme === 'dark' ? 'light' : 'dark'); }

// ── QR BUILD ──────────────────────────────────────────────────────────────
function buildQR(containerId, url) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = '';
  new QRCode(el, { text: url, width: 200, height: 200,
    colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M });
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
    b.onclick = () => { state.me.emoji = e; buildEmojiGrid(gridId); };
    grid.appendChild(b);
  });
}

function showStep(id) {
  ['step-name', 'step-room', 'step-qr'].forEach((s) => {
    const el = $(s);
    if (el) el.classList.toggle('hidden', s !== id);
  });
}

function setupOnboarding() {
  const hashRoom = readHash();

  // ── RESTORE: same tab refreshed while in a game ────────────────────────
  // Check if this tab has a saved session for the current room hash.
  // If yes, skip onboarding entirely and jump straight back into the game.
  if (hashRoom) {
    const saved = loadSession(hashRoom);
    if (saved && saved.clientId === state.myClientId && saved.seat != null) {
      state.me.name    = saved.name;
      state.me.emoji   = saved.emoji;
      state.room       = hashRoom;
      state.mySeat     = saved.seat;
      enterGame(/* restored= */ true);
      return;
    }
  }

  // ── FRESH ONBOARDING ──────────────────────────────────────────────────
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

  // HOST: creates room → gets seat 0 (ping) deterministically
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

  // Host clicks "I'm ready" → seat 0
  $('qr-continue-btn').onclick = async () => {
    state.mySeat = 0; // HOST always ping side
    persistAndEnter();
  };

  // GUEST: arrives via link → seat 1 (pong) deterministically
  $('guest-join-btn').onclick = async () => {
    state.mySeat = 1; // GUEST always pong side
    persistAndEnter();
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

// Called once seat is assigned — persist then enter game
function persistAndEnter() {
  saveSession(state.room, {
    name: state.me.name,
    emoji: state.me.emoji,
    seat: state.mySeat,
    clientId: state.myClientId,
  });
  enterGame(/* restored= */ false);
}

// ── ENTER GAME ────────────────────────────────────────────────────────────
async function enterGame(restored = false) {
  showScreen('screen-game');
  $('feedRoomCode').textContent = state.room;
  renderGame();
  await connect(restored);
}

// ── ABLY CONNECT ──────────────────────────────────────────────────────────
async function connect(restored = false) {
  if (!state.room) return;
  if (state.realtime) {
    try { state.realtime.close(); } catch {}
    state.realtime = null;
    state.channel = null;
  }

  state.realtime = new Ably.Realtime({
    authUrl: `/api/ably-auth?clientId=${encodeURIComponent(state.myClientId)}`,
  });

  state.realtime.connection.on('connected', async () => {
    state.connected = true;
    hideReconnect();
    renderGame();
    // Announce our seat so the opponent sees us (on both fresh join and restore)
    if (state.mySeat !== null) {
      await state.channel.publish('seat-claim', {
        seat:     state.mySeat,
        name:     state.me.name,
        emoji:    state.me.emoji,
        clientId: state.myClientId,
        restored, // lets opponent show "reconnected" vs "joined"
        time:     Date.now(),
      });
      renderGame();
    }
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
      renderGame();
    }

    if (msg.name === 'seat-claim') {
      // Accept the claim only if:
      //   a) the incoming clientId owns this seat (their own echo or a real claim), OR
      //   b) the seat is currently empty
      // Never allow a different clientId to overwrite an already-occupied seat.
      const existing = state.rs.seats[d.seat];
      const isOccupiedByOther = existing && existing.clientId !== d.clientId;
      if (!isOccupiedByOther) {
        state.rs.seats[d.seat] = {
          name: d.name, emoji: d.emoji, seat: d.seat, clientId: d.clientId,
        };
        // Show feed message only for the opponent's claim (not our own echo)
        if (d.clientId !== state.myClientId) {
          const verb = d.restored ? 'reconnected to' : 'joined';
          state.rs.feed.unshift({
            type: 'system',
            text: `${d.emoji} ${d.name} ${verb} ${d.seat === 0 ? 'Ping side' : 'Pong side'}`,
            time: Date.now(),
          });
        }
      }
      renderGame();
    }

    if (msg.name === 'reset') {
      clearSession(state.room);
      state.rs = {
        seats: [null, null], next: 'ping', activeSeat: 0, lastMove: null,
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
  const paddle = $(seat === 0 ? 'paddleLeft' : 'paddleRight');
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
      vs.className = 'vs-badge'; vs.textContent = 'VS';
      view.appendChild(vs);
    }
    const pill = document.createElement('div');
    pill.className = 'player-pill' + (state.rs.activeSeat === i ? ' active' : '');
    pill.innerHTML = seat
      ? `<span class="pip"></span><span>${seat.emoji} ${esc(seat.name)}</span><span class="seat-label">${labels[i]}</span>`
      : `<span class="pip"></span><span style="color:var(--faint)">Open seat</span><span class="seat-label">${labels[i]}</span>`;
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
  feed.innerHTML = state.rs.feed.map((item) => {
    if (item.type === 'system')
      return `<article class="event system"><div class="event-head"><span class="event-who" style="color:var(--faint)">Room</span><span class="event-time">${timeText(item.time)}</span></div><div class="event-body">${esc(item.text)}</div></article>`;
    return `<article class="event ${item.action}"><div class="event-head"><span class="event-who">${item.emoji} ${esc(item.name)}</span><span class="event-action ${item.action}">${item.action.toUpperCase()}</span><span class="event-time">${timeText(item.time)}</span></div>${item.text ? `<div class="event-body">${linkify(item.text)}</div>` : ''}</article>`;
  }).join('');
}

function renderComposer() {
  const sendBtn = $('sendBtn');
  const hint = $('composerHint');
  if (!sendBtn || !hint) return;
  const myTurn = state.mySeat !== null && state.rs.activeSeat === state.mySeat && state.channel && state.connected;
  sendBtn.disabled = !myTurn;
  if (!state.room)           hint.innerHTML = 'Create or join a room first.';
  else if (state.mySeat === null) hint.innerHTML = 'Waiting to claim a seat…';
  else if (!myTurn)          hint.innerHTML = `Waiting for opponent's <strong>${state.rs.next}</strong>…`;
  else                       hint.innerHTML = `Your turn — send <strong>${state.rs.next.toUpperCase()}</strong>`;
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
  if (!state.channel)          { showFieldError($('composerError'), 'Not connected.'); return; }
  if (state.mySeat === null)   { showFieldError($('composerError'), 'Seat not set.'); return; }
  if (state.rs.activeSeat !== state.mySeat) { showFieldError($('composerError'), 'Not your turn.'); return; }
  const seat = state.rs.seats[state.mySeat];
  if (!seat) { showFieldError($('composerError'), 'Seat missing — refresh.'); return; }
  const text = ($('messageInput').value || '').trim();
  if (text.length > 1000) { showFieldError($('composerError'), 'Message too long (max 1000).'); return; }

  $('sendBtn').disabled = true;
  try {
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomCode: state.room, action: state.rs.next,
        seat: state.mySeat, name: seat.name, emoji: seat.emoji,
        text, expectedNext: state.rs.next,
      }),
    });
    const data = await res.json();
    if (!res.ok) { showFieldError($('composerError'), data.error || 'Failed to send.'); return; }
    $('messageInput').value = '';
    updateCharCount();
  } finally {
    renderComposer();
  }
}

// ── QR MODAL ──────────────────────────────────────────────────────────────
function openQRModal() {
  const url = location.href;
  $('qr-modal-link').value = url;
  buildQR('qr-modal-wrap', url);
  $('qr-modal').classList.remove('hidden');
}

// ── COPY ──────────────────────────────────────────────────────────────────
async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => (btn.textContent = orig), 1500);
  } catch { prompt('Copy this link:', text); }
}

// ── CHAR COUNT ────────────────────────────────────────────────────────────
function updateCharCount() {
  const len = ($('messageInput') || { value: '' }).value.length;
  const cc = $('charCount');
  if (cc) { cc.textContent = `${len} / 1000`; cc.classList.toggle('over', len > 1000); }
}

// ── BANNERS ───────────────────────────────────────────────────────────────
let errorTimer = null;
function showError(msg) {
  $('errorMsg').textContent = msg;
  $('errorBanner').classList.remove('hidden');
  clearTimeout(errorTimer);
  errorTimer = setTimeout(clearError, 6000);
}
function clearError() { $('errorBanner').classList.add('hidden'); }
function showReconnect(msg, showBtn) {
  $('reconnectMsg').textContent = msg;
  $('reconnectBanner').classList.remove('hidden');
  $('reconnectBtn').style.display = showBtn ? '' : 'none';
}
function hideReconnect() { $('reconnectBanner').classList.add('hidden'); }

// ── BOOT ──────────────────────────────────────────────────────────────────
function boot() {
  setTheme(theme);
  setupOnboarding();

  if ($('themeToggleGame')) $('themeToggleGame').onclick = toggleTheme;
  if ($('shareBtn'))        $('shareBtn').onclick = openQRModal;
  if ($('qrModalClose'))    $('qrModalClose').onclick = () => $('qr-modal').classList.add('hidden');
  if ($('qr-modal'))        $('qr-modal').addEventListener('click', (e) => { if (e.target === $('qr-modal')) $('qr-modal').classList.add('hidden'); });
  if ($('qr-modal-copy'))   $('qr-modal-copy').onclick = () => copyText($('qr-modal-link').value, $('qr-modal-copy'));
  if ($('sendBtn'))         $('sendBtn').onclick = sendTurn;
  if ($('resetRoomBtn'))    $('resetRoomBtn').onclick = async () => {
    if (!state.channel) return;
    if (!confirm('Reset room for both players?')) return;
    await state.channel.publish('reset', { time: Date.now() });
  };
  if ($('errorDismiss'))    $('errorDismiss').onclick = clearError;
  if ($('reconnectBtn'))    $('reconnectBtn').onclick = () => connect(true);
  if ($('messageInput')) {
    $('messageInput').addEventListener('input', updateCharCount);
    $('messageInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendTurn(); }
    });
  }

  showScreen('screen-onboard');
}

boot();
