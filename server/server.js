'use strict';
/* =====================================================================
   SERVIDOR ONLINE do Batalha Naval  (cliente <-> servidor <-> clientes)

   - Salas com código, lobby, pronto/iniciar, placar, tempo e limite de abates.
   - Cada cliente simula o próprio navio (autoridade do dono); o servidor valida
     o projeto do navio (custo/estrutura) com as MESMAS regras do jogo (parts.js),
     retransmite tiros e faz a NÉVOA DE GUERRA: você só recebe a posição de quem
     seu time consegue detectar (visão, radar, sonar, revelação ao atirar).
   - Também hospeda os arquivos do jogo, então um único serviço (ex.: Render) serve
     o site e o multijogador no mesmo endereço.

   Uso:  npm install && npm start        (porta: variável PORT, padrão 8787)
   ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const G = require('../parts.js');

const PORT = +process.env.PORT || 8787;
const ROOT = path.join(__dirname, '..');
const MAX_PLAYERS = 8;
const MAX_ROOMS = 60;
const RESPAWN_MS = 5000;
const HALF = 1800;                                   // meio-lado do mapa (mundo de 3600)
const SHOT_KINDS = new Set(['shell', 'bullet', 'heavy', 'flame', 'rail', 'mortar', 'torp', 'missile']);
const LOUD_SHOTS = new Set(['shell', 'rail', 'mortar', 'torp', 'missile']);   // revelam quem atira

/* ------------------------------------------------------------ arquivos estáticos */
const STATIC = new Set(['index.html', 'style.css', 'parts.js', 'builder.js', 'touch.js', 'battle.js', 'net.js', 'main.js', 'config.js',
  'manifest.json', 'sw.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png']);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png' };

const rooms = new Map();
const players = new Set();

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, ''); } catch (e) { p = ''; }
  if (p === 'health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, game: 'batalha-naval', version: G.VERSION, rooms: rooms.size, players: players.size }));
    return;
  }
  if (p === '') p = 'index.html';
  if (!STATIC.has(p)) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Não encontrado'); return; }
  fs.readFile(path.join(ROOT, p), (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Não encontrado'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
});

/* ------------------------------------------------------------------ utilidades */
const send = (ws, obj) => { if (ws.readyState === 1) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
const clean = (s, n = 16) => String(s == null ? '' : s).replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v, lo, hi, d = 0) => { v = +v; return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const rnd = (a, b) => a + Math.random() * (b - a);
let nextId = 1;

function roomCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let k = 0; k < 50; k++) {
    let c = ''; for (let i = 0; i < 4; i++) c += A[(Math.random() * A.length) | 0];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function cleanSettings(s, old) {
  s = s || {};
  const mode = s.mode === 'teams' ? 'teams' : 'ffa';
  const budget = [0, 200, 300, 450, 700, 1000, 1500].includes(+s.budget) ? +s.budget : (old ? old.budget : 450);
  const killLimit = [5, 10, 15, 20, 30, 50].includes(+s.killLimit) ? +s.killLimit : (old ? old.killLimit : 15);
  const minutes = [0, 5, 10, 15, 20].includes(+s.minutes) ? +s.minutes : (old ? old.minutes : 10);
  return { mode, budget, killLimit, minutes };
}

function assignTeams(r) {
  let i = 0;
  for (const p of r.players.values()) { p.team = r.settings.mode === 'teams' ? (i % 2 ? 'B' : 'A') : 'p' + p.id; i++; }
}

function roomInfo(r) {
  return {
    code: r.code, host: r.hostId, settings: r.settings, state: r.state,
    endsAt: r.endsAt || 0,
    players: [...r.players.values()].map(p => ({
      id: p.id, name: p.name, team: p.team, ready: p.ready, cost: p.stats ? p.stats.cost : 0, hasDesign: !!p.design,
      kills: p.kills, deaths: p.deaths,
    })),
  };
}
const broadcast = (r, obj, except) => { const s = JSON.stringify(obj); for (const p of r.players.values()) if (p !== except) send(p.ws, s); };
const broadcastRoom = r => broadcast(r, { t: 'room', room: roomInfo(r) });

function scoreboard(r) {
  const list = [...r.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths }));
  list.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const teams = {};
  if (r.settings.mode === 'teams') for (const p of list) teams[p.team] = (teams[p.team] || 0) + p.kills;
  return { list, teams };
}

/* ------------------------------------------------------------------ detecção */
const dstate = (p, now) => ({
  x: p.x, y: p.y, vision: p.vision, sonar: p.sonar, pingR: p.pingR, ping: now < p.pingUntil,
  sig: p.sig, reveal: now < p.revealUntil, revealR: p.revealR,
});
/** o jogador q (ou um aliado dele) enxerga p? */
function canSee(r, q, p, now) {
  if (q.team === p.team || !q.alive) return true;                 // aliados e espectadores veem tudo
  const t = dstate(p, now);
  for (const o of r.players.values()) if (o.alive && o.team === q.team && G.detects(dstate(o, now), t)) return true;
  return false;
}

function spawnPoint(r, self) {
  let best = null, bd = -1;
  for (let k = 0; k < 24; k++) {
    const a = rnd(0, Math.PI * 2), d = rnd(900, 1450);
    const x = Math.sin(a) * d, y = -Math.cos(a) * d;
    let md = 1e9;
    for (const o of r.players.values()) if (o !== self && o.alive) md = Math.min(md, Math.hypot(o.x - x, o.y - y));
    if (md > bd) { bd = md; best = { x, y }; }
    if (md > 900) break;
  }
  return { x: Math.round(best.x), y: Math.round(best.y), a: +Math.atan2(-best.x, best.y).toFixed(3) };
}

/* ------------------------------------------------------------------ salas */
function leaveRoom(p) {
  const r = p.room;
  if (!r) return;
  clearTimeout(p.respawnTimer);
  r.players.delete(p.id); p.room = null; p.ready = false; p.alive = false;
  if (!r.players.size) { clearInterval(r.tick); rooms.delete(r.code); return; }
  if (r.hostId === p.id) r.hostId = r.players.keys().next().value;
  assignTeams(r);
  broadcast(r, { t: 'left', id: p.id });
  broadcastRoom(r);
  if (r.state === 'playing' && r.players.size < 2) endMatch(r, 'Os outros jogadores saíram.');
}

function joinRoom(p, r) {
  if (p.room) leaveRoom(p);
  if (r.players.size >= MAX_PLAYERS) return send(p.ws, { t: 'error', msg: 'Sala cheia.' });
  if (r.state === 'playing') return send(p.ws, { t: 'error', msg: 'A partida já começou.' });
  r.players.set(p.id, p); p.room = r; p.ready = false; p.kills = p.deaths = 0; p.alive = false;
  assignTeams(r);
  send(p.ws, { t: 'joined', code: r.code });
  broadcastRoom(r);
}

function createRoom(p, settings) {
  if (rooms.size >= MAX_ROOMS) return send(p.ws, { t: 'error', msg: 'Servidor cheio. Tente mais tarde.' });
  const code = roomCode();
  if (!code) return send(p.ws, { t: 'error', msg: 'Não foi possível criar a sala.' });
  const r = { code, hostId: p.id, settings: cleanSettings(settings), players: new Map(), state: 'lobby', startedAt: 0, endsAt: 0, tick: null };
  r.tick = setInterval(() => roomTick(r), 1000);
  rooms.set(code, r);
  joinRoom(p, r);
}

function startMatch(r) {
  const now = Date.now();
  r.state = 'playing'; r.startedAt = now;
  r.endsAt = r.settings.minutes ? now + r.settings.minutes * 60000 : 0;
  assignTeams(r);
  const spawns = {};
  for (const p of r.players.values()) {
    p.kills = p.deaths = 0; p.alive = true; p.ready = false; p.lastSnapAt = 0;
    p.vision = p.stats.vision; p.sonar = p.stats.sonarR; p.pingR = p.stats.pingR; p.sig = p.stats.sig;
    p.revealUntil = p.pingUntil = 0; p.revealR = 0;
    const sp = spawnPoint(r, p); p.x = sp.x; p.y = sp.y; spawns[p.id] = sp;
  }
  const list = [...r.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, design: p.design }));
  for (const p of r.players.values()) send(p.ws, { t: 'start', you: p.id, settings: r.settings, players: list, spawns, endsAt: r.endsAt });
}

function endMatch(r, reason) {
  if (r.state !== 'playing') return;
  r.state = 'lobby'; r.endsAt = 0;
  const sb = scoreboard(r);
  broadcast(r, { t: 'end', ranking: sb.list, teams: sb.teams, reason: reason || '' });
  for (const p of r.players.values()) { clearTimeout(p.respawnTimer); p.ready = false; p.alive = false; }
  broadcastRoom(r);
}

function roomTick(r) {
  if (r.state !== 'playing') return;
  const now = Date.now();
  if (r.endsAt && now >= r.endsAt) return endMatch(r, 'Tempo esgotado!');
  const sb = scoreboard(r);
  broadcast(r, { t: 'score', list: sb.list, teams: sb.teams, left: r.endsAt ? Math.max(0, Math.round((r.endsAt - now) / 1000)) : -1 });
}

function checkWin(r) {
  const sb = scoreboard(r), L = r.settings.killLimit;
  if (r.settings.mode === 'teams') {
    for (const t in sb.teams) if (sb.teams[t] >= L) return endMatch(r, 'Equipe ' + t + ' venceu!');
  } else if (sb.list[0] && sb.list[0].kills >= L) return endMatch(r, sb.list[0].name + ' venceu!');
}

/* ------------------------------------------------------------------ mensagens */
function onMessage(p, raw) {
  let m;
  try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || typeof m.t !== 'string') return;
  const now = Date.now();
  if (now - p.rateT > 1000) { p.rateT = now; p.rateN = 0; }
  if (++p.rateN > 400) return;                                   // anti-flood

  const r = p.room;
  switch (m.t) {
    case 'hello':
      p.name = clean(m.name) || ('Capitão' + p.id);
      send(p.ws, { t: 'welcome', id: p.id, name: p.name, version: G.VERSION });
      break;
    case 'p': send(p.ws, { t: 'po', c: m.c }); break;
    case 'rooms': {
      const list = [...rooms.values()].filter(x => x.state === 'lobby' && x.players.size < MAX_PLAYERS)
        .map(x => ({ code: x.code, host: (x.players.get(x.hostId) || {}).name || '?', n: x.players.size, settings: x.settings }));
      send(p.ws, { t: 'rooms', list });
      break;
    }
    case 'create': createRoom(p, m.settings); break;
    case 'join': {
      const rr = rooms.get(clean(m.code, 4).toUpperCase());
      if (!rr) return send(p.ws, { t: 'error', msg: 'Sala não encontrada.' });
      joinRoom(p, rr);
      break;
    }
    case 'leave': leaveRoom(p); send(p.ws, { t: 'left', id: p.id, self: true }); break;
    case 'settings':
      if (r && r.state === 'lobby' && r.hostId === p.id) {
        r.settings = cleanSettings(m.settings, r.settings); assignTeams(r);
        for (const q of r.players.values()) { q.ready = false; if (q.design) revalidate(q, r); }
        broadcastRoom(r);
      }
      break;
    case 'design':
      if (r && r.state === 'lobby') {
        const v = G.validateDesign(m.design, r.settings.budget);
        if (!v.ok) { p.design = null; p.stats = null; p.ready = false; send(p.ws, { t: 'designErr', msg: v.error }); broadcastRoom(r); break; }
        p.design = m.design; p.stats = v.stats; p.ready = false;
        send(p.ws, { t: 'designOk', cost: v.stats.cost });
        broadcastRoom(r);
      }
      break;
    case 'ready':
      if (r && r.state === 'lobby' && p.design) { p.ready = !!m.v; broadcastRoom(r); }
      break;
    case 'start':
      if (r && r.state === 'lobby' && r.hostId === p.id) {
        if (r.players.size < 2) return send(p.ws, { t: 'error', msg: 'São necessários pelo menos 2 jogadores.' });
        for (const q of r.players.values()) if (!q.design) return send(p.ws, { t: 'error', msg: q.name + ' ainda não enviou um navio válido.' });
        for (const q of r.players.values()) if (q.id !== p.id && !q.ready) return send(p.ws, { t: 'error', msg: q.name + ' ainda não está pronto.' });
        startMatch(r);
      }
      break;

    /* ------- durante a partida ------- */
    case 'snap': {
      if (!r || r.state !== 'playing' || !p.alive) return;
      if (now - p.lastSnapAt < 35) return;
      p.lastSnapAt = now;
      const x = num(m.x, -HALF, HALF), y = num(m.y, -HALF, HALF);
      if (!Number.isFinite(+m.x) || !Number.isFinite(+m.y)) return;
      p.x = x; p.y = y;
      // o cliente só pode ser MENOS furtivo/atento que o projeto permite
      p.vision = num(m.v, 0, p.stats.vision, p.stats.vision);
      p.sonar = num(m.sp, 0, p.stats.sonarR, 0);
      p.pingR = num(m.pr, 0, p.stats.pingR, 0);
      p.sig = num(m.sg, p.stats.sig, 1, 1);
      const out = { t: 'snap', id: p.id, x, y, a: num(m.a, -50, 50), vx: num(m.vx, -400, 400), vy: num(m.vy, -400, 400),
        fl: num(m.fl, 0, 1), sh: num(m.sh, 0, 500), v: p.vision, sp: p.sonar, pr: p.pingR, sg: p.sig };
      if (Array.isArray(m.c) && m.c.length <= 700) out.c = m.c;
      if (Array.isArray(m.tp) && m.tp.length <= 350) out.tp = m.tp;
      const nowT = Date.now();
      if (nowT < p.revealUntil) out.rv = p.revealR;
      if (nowT < p.pingUntil) out.pg = 1;
      const s = JSON.stringify(out);
      for (const q of r.players.values()) if (q !== p && canSee(r, q, p, nowT)) send(q.ws, s);
      break;
    }
    case 'shot': {
      if (!r || r.state !== 'playing' || !p.alive || !SHOT_KINDS.has(m.kind)) return;
      const vals = ['x', 'y', 'vx', 'vy', 'life', 'dmg'];
      for (const k of vals) if (!Number.isFinite(+m[k])) return;
      const sh = { t: 'shot', kind: m.kind, id: clean(m.id, 24), owner: p.id, team: p.team,
        x: +m.x, y: +m.y, vx: num(m.vx, -1500, 1500), vy: num(m.vy, -1500, 1500), life: num(m.life, 0, 6), dmg: num(m.dmg, 0, 16),
        pierce: num(m.pierce, 0, 4), big: !!m.big, splash: num(m.splash, 0, 70), turn: num(m.turn, 0, 4), ang: num(m.ang, -50, 50), speed: num(m.speed, 0, 1200),
        tx: num(m.tx, -4000, 4000), ty: num(m.ty, -4000, 4000), T: num(m.T, 0, 6), x0: num(m.x0, -4000, 4000), y0: num(m.y0, -4000, 4000), tg: clean(m.tg, 12) };
      if (LOUD_SHOTS.has(m.kind)) { p.revealUntil = now + 1500; p.revealR = 900; }
      const s = JSON.stringify(sh);
      for (const q of r.players.values()) {
        if (q === p) continue;
        if (q.team === p.team || !q.alive || Math.hypot(q.x - sh.x, q.y - sh.y) < 2600) send(q.ws, s);
      }
      break;
    }
    case 'hit':
      if (r && r.state === 'playing') broadcast(r, { t: 'hit', id: clean(m.id, 24), x: num(m.x, -4000, 4000), y: num(m.y, -4000, 4000) }, p);
      break;
    case 'ping':
      if (r && r.state === 'playing' && p.alive && p.stats && p.stats.pings > 0) {
        p.pingUntil = now + 2000; p.revealUntil = Math.max(p.revealUntil, now + 1600); p.revealR = Math.max(p.revealR, 2200);
      }
      break;
    case 'died': {
      if (!r || r.state !== 'playing' || !p.alive) return;
      p.alive = false; p.deaths++;
      const by = r.players.get(clean(m.by, 12));
      if (by && by !== p && by.team !== p.team) by.kills++;
      const sb = scoreboard(r);
      broadcast(r, { t: 'died', id: p.id, by: by ? by.id : null, list: sb.list, teams: sb.teams });
      checkWin(r);
      if (r.state === 'playing') {
        p.respawnTimer = setTimeout(() => {
          if (r.state !== 'playing' || !r.players.has(p.id)) return;
          p.alive = true; p.lastSnapAt = 0;
          const sp = spawnPoint(r, p); p.x = sp.x; p.y = sp.y;
          p.vision = p.stats.vision; p.sonar = p.stats.sonarR; p.pingR = p.stats.pingR; p.sig = p.stats.sig;
          p.revealUntil = p.pingUntil = 0;
          broadcast(r, { t: 'spawn', id: p.id, x: sp.x, y: sp.y, a: sp.a });
        }, RESPAWN_MS);
      }
      break;
    }
  }
}

/** a sala mudou o orçamento: revalida o navio de quem já enviou */
function revalidate(q, r) {
  const v = G.validateDesign(q.design, r.settings.budget);
  if (!v.ok) { q.design = null; q.stats = null; send(q.ws, { t: 'designErr', msg: v.error }); } else q.stats = v.stats;
}

/* ------------------------------------------------------------------ conexões */
const wss = new WebSocketServer({ server, maxPayload: 128 * 1024 });
wss.on('connection', ws => {
  if (players.size >= 400) { ws.close(1013, 'cheio'); return; }
  const p = { id: 'u' + (nextId++), ws, name: '', room: null, design: null, stats: null, ready: false, team: '', kills: 0, deaths: 0, alive: false,
    x: 0, y: 0, vision: 650, sonar: 0, pingR: 0, sig: 1, revealUntil: 0, revealR: 0, pingUntil: 0, lastSnapAt: 0, rateT: 0, rateN: 0, respawnTimer: null, isAlive: true };
  players.add(p);
  send(ws, { t: 'hi', id: p.id, version: G.VERSION });
  ws.on('message', data => { try { onMessage(p, data.toString()); } catch (e) { console.error('erro de mensagem:', e.message); } });
  ws.on('pong', () => { p.isAlive = true; });
  ws.on('close', () => { leaveRoom(p); players.delete(p); });
  ws.on('error', () => {});
});
setInterval(() => {                                               // derruba conexões mortas
  for (const p of players) {
    if (!p.isAlive) { p.ws.terminate(); continue; }
    p.isAlive = false; try { p.ws.ping(); } catch (e) { /* ignore */ }
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`Batalha Naval v${G.VERSION} — servidor online na porta ${PORT}`);
  console.log(`  Jogo + multijogador:  http://localhost:${PORT}   |   saúde: /health`);
});
