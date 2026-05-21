// ── state ──────────────────────────────────────────────────────────────
const state = {
  room: '',
  me: { name: '', emoji: '🏓' },
  mySeat: null,
  rs: { seats: [null, null], next: 'ping', activeSeat: 0, lastMove: null, feed: [] },
  realtime: null,
  channel: null,
  connected: false,
  notificationsEnabled: false
};

// ── helpers ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const els = {
  roomCode: $('roomCode'), makeRoomBtn: $('makeRoomBtn'), copyRoomBtn: $('copyRoomBtn'),
  notifyBtn: $('notifyBtn'), playerName: $('playerName'), playerEmoji: $('playerEmoji'),
  savePlayerBtn: $('savePlayerBtn'), claimSeatBtn: $('claimSeatBtn'),
  playersView: $('playersView'), turnBadge: $('turnBadge'), syncBadge: $('syncBadge'),
  turnText: $('turnText'), ball: $('ball'), impactText: $('impactText'),
  messageInput: $('messageInput'), sendBtn: $('sendBtn'), resetRoomBtn: $('resetRoomBtn'),
  feed: $('feed'), emojiGrid: $('emojiGrid'), themeToggle: $('themeToggle')
};
const emojiChoices = ['🏓','🔥','🦄','🤖','🐯','🎧','🌊','⚡','🍉','🛰️','🐼','🎯'];
const esc = (s='') => s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const linkify = (t='') => esc(t).replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
const shortCode = () => Math.random().toString(36).slice(2,8).toUpperCase();
const timeText = ts => new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
const setHash = code => { const u=new URL(location.href); u.hash=code?'#room='+encodeURIComponent(code):''; history.replaceState({},'',u); };
const readHash = () => { const m=(location.hash||'').match(/room=([^&]+)/); return m?decodeURIComponent(m[1]):''; };

// ── theme ───────────────────────────────────────────────────────────────
function initTheme() {
  let t = matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';
  document.documentElement.dataset.theme=t;
  els.themeToggle.textContent=t==='dark'?'☀︎':'☾';
  els.themeToggle.onclick=()=>{ t=t==='dark'?'light':'dark'; document.documentElement.dataset.theme=t; els.themeToggle.textContent=t==='dark'?'☀︎':'☾'; };
}

// ── render ───────────────────────────────────────────────────────────────
function renderEmojiGrid() {
  els.emojiGrid.innerHTML='';
  emojiChoices.forEach(e=>{ const b=document.createElement('button'); b.type='button'; b.className='emoji-btn'+(e===state.me.emoji?' active':''); b.textContent=e; b.onclick=()=>{ state.me.emoji=e; els.playerEmoji.value=e; renderEmojiGrid(); }; els.emojiGrid.appendChild(b); });
}
function renderPlayers() {
  els.playersView.innerHTML='';
  ['Ping side','Pong side'].forEach((label,i)=>{
    const seat=state.rs.seats[i]; const div=document.createElement('div');
    div.className='player-pill'+(state.rs.activeSeat===i?' active':'');
    div.innerHTML=seat?`<div class="name-line"><span>${seat.emoji}</span><span>${esc(seat.name)}</span></div><div style="font-size:var(--text-xs);color:var(--color-text-muted)">${label}</div>`:`<div class="name-line"><span>○</span><span>Open seat</span></div><div style="font-size:var(--text-xs);color:var(--color-text-muted)">${label}</div>`;
    els.playersView.appendChild(div);
  });
}
function renderFeed() {
  if (!state.rs.feed.length) { els.feed.innerHTML='<div class="empty">No hits yet. First move is <strong>ping</strong>.</div>'; return; }
  els.feed.innerHTML=state.rs.feed.map(item=>
    item.type==='system'
      ?`<article class="event"><div class="event-head"><strong>Room</strong><span class="event-meta">${timeText(item.time)}</span></div><div class="event-body muted">${esc(item.text)}</div></article>`
      :`<article class="event"><div class="event-head"><strong>${item.emoji} ${esc(item.name)} · ${item.action.toUpperCase()}</strong><span class="event-meta">${timeText(item.time)}</span></div><div class="event-body">${item.text?linkify(item.text):'<span class="muted">No attachment</span>'}</div></article>`
  ).join('');
}
function render() {
  renderPlayers(); renderFeed();
  els.syncBadge.textContent=state.connected?`● Realtime · ${state.room||'?'}`:'○ Disconnected';
  els.turnBadge.textContent=state.room?`Next: ${state.rs.next}`:'Waiting for room';
  const cs=state.rs.seats[state.rs.activeSeat];
  els.turnText.textContent=!state.room?'Create a room to start.':cs?`${cs.emoji} ${cs.name} must send ${state.rs.next}.`:`Seat ${state.rs.activeSeat+1} is open — claim it.`;
  if (state.rs.lastMove) {
    els.impactText.textContent=`${state.rs.lastMove.emoji} ${state.rs.lastMove.name} → ${state.rs.lastMove.action.toUpperCase()}`;
    els.ball.className='ball '+(state.rs.lastMove.seat===0?'left-side':'right-side');
  } else { els.impactText.textContent='No rally yet'; els.ball.className='ball'; }
}

// ── ably realtime ────────────────────────────────────────────────────────
async function connect() {
  if (!state.room) return;
  if (state.realtime) { try{state.realtime.close();}catch{} state.realtime=null; state.channel=null; }
  const clientId=`${state.me.name||'player'}-${Math.random().toString(36).slice(2,6)}`;
  state.realtime=new Ably.Realtime({ authUrl:`/api/ably-auth?clientId=${encodeURIComponent(clientId)}` });
  state.realtime.connection.on('connected',()=>{ state.connected=true; render(); });
  state.realtime.connection.on('disconnected',()=>{ state.connected=false; render(); });
  state.realtime.connection.on('failed',()=>{ state.connected=false; render(); });
  state.channel=state.realtime.channels.get(`pingpong:${state.room}`);
  state.channel.subscribe(msg=>{
    const d=msg.data;
    if (msg.name==='move') {
      state.rs.feed.unshift(d); state.rs.feed=state.rs.feed.slice(0,50);
      state.rs.lastMove=d; state.rs.next=d.action==='ping'?'pong':'ping'; state.rs.activeSeat=d.seat===0?1:0;
      if (state.notificationsEnabled&&document.hidden&&Notification.permission==='granted') {
        new Notification(`${d.emoji} ${d.name} sent ${d.action.toUpperCase()}`,{ body:d.text||'Your turn!' });
      }
      render();
    }
    if (msg.name==='seat-claim') {
      state.rs.seats[d.seat]={ name:d.name, emoji:d.emoji, seat:d.seat };
      state.rs.feed.unshift({ type:'system', text:`${d.emoji} ${d.name} joined ${d.seat===0?'Ping side':'Pong side'}`, time:Date.now() });
      render();
    }
    if (msg.name==='reset') {
      state.rs={ seats:[null,null], next:'ping', activeSeat:0, lastMove:null, feed:[{type:'system',text:'Room was reset',time:Date.now()}] };
      state.mySeat=null; render();
    }
  });
}

// ── actions ──────────────────────────────────────────────────────────────
async function makeRoom() {
  const code=(els.roomCode.value||shortCode()).trim().replace(/[^a-zA-Z0-9_-]/g,'').slice(0,24)||shortCode();
  state.room=code; els.roomCode.value=code; setHash(code);
  await connect(); render();
}
async function copyLink() {
  if (!state.room) await makeRoom();
  try { await navigator.clipboard.writeText(location.href); els.copyRoomBtn.textContent='Copied ✓'; setTimeout(()=>els.copyRoomBtn.textContent='Copy link',1400); }
  catch { prompt('Copy this room link:',location.href); }
}
async function requestNotifications() {
  if (!('Notification' in window)) return alert('Notifications not supported in this browser.');
  const r=await Notification.requestPermission();
  state.notificationsEnabled=r==='granted';
  els.notifyBtn.textContent=state.notificationsEnabled?'🔔 Notifications on':'🔔 Enable notifications';
}
function savePlayer() {
  state.me.name=(els.playerName.value||'Player').trim().slice(0,24)||'Player';
  state.me.emoji=(els.playerEmoji.value||'🏓').trim().slice(0,2)||'🏓';
  els.playerName.value=state.me.name; els.playerEmoji.value=state.me.emoji;
  renderEmojiGrid(); render();
}
async function claimSeat() {
  savePlayer();
  if (!state.channel) return alert('Create or join a room first.');
  const open=state.rs.seats.findIndex(s=>!s);
  const seat=open===-1?0:open;
  state.mySeat=seat;
  state.rs.seats[seat]={ name:state.me.name, emoji:state.me.emoji, seat };
  await state.channel.publish('seat-claim',{ seat, name:state.me.name, emoji:state.me.emoji, time:Date.now() });
  render();
}
async function sendTurn() {
  if (!state.channel) return alert('Join a room first.');
  if (state.mySeat===null) return alert('Claim a seat first.');
  if (state.rs.activeSeat!==state.mySeat) return alert('Not your turn yet.');
  const seat=state.rs.seats[state.mySeat];
  if (!seat) return alert('Seat missing — claim again.');
  const payload={ roomCode:state.room, action:state.rs.next, seat:state.mySeat, name:seat.name, emoji:seat.emoji, text:els.messageInput.value.trim(), expectedNext:state.rs.next };
  els.sendBtn.disabled=true; els.sendBtn.textContent='Sending…';
  try {
    const res=await fetch('/api/publish',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const data=await res.json();
    if (!res.ok) { alert(data.error||'Failed to send move.'); return; }
    els.messageInput.value='';
  } finally { els.sendBtn.disabled=false; els.sendBtn.textContent='Send move'; }
}
async function resetRoom() {
  if (!state.channel) return;
  if (!confirm('Reset this room for both players?')) return;
  await state.channel.publish('reset',{ time:Date.now() });
}

// ── boot ─────────────────────────────────────────────────────────────────
function boot() {
  initTheme();
  const hashRoom=readHash();
  if (hashRoom) { state.room=hashRoom; els.roomCode.value=hashRoom; }
  els.playerEmoji.value=state.me.emoji;
  renderEmojiGrid(); render();
  els.makeRoomBtn.onclick=makeRoom;
  els.copyRoomBtn.onclick=copyLink;
  els.notifyBtn.onclick=requestNotifications;
  els.savePlayerBtn.onclick=savePlayer;
  els.claimSeatBtn.onclick=claimSeat;
  els.sendBtn.onclick=sendTurn;
  els.resetRoomBtn.onclick=resetRoom;
  els.roomCode.addEventListener('keydown',e=>{ if(e.key==='Enter') makeRoom(); });
  if (state.room) connect();
}
boot();
