'use strict';
/* =====================================================================
   LÓGICA DO SERVIDOR DO JOGO (salas, validação, névoa de guerra, placar).
   Independe do transporte: roda no Node (server/server.js, via WebSocket)
   e DENTRO DO NAVEGADOR DO ANFITRIÃO (net.js, via WebRTC/PeerJS), então
   o online funciona só com o GitHub Pages, sem hospedar servidor.

   Uso:  const gs = createGameServer();
         const p = gs.connect(texto => enviarAoCliente(texto));
         gs.message(p, textoRecebido);   gs.disconnect(p);
   ===================================================================== */
(function (root) {
const G = (typeof module !== 'undefined' && module.exports)
  ? require('./parts.js')
  : { VERSION, DEEP, PRESETS, validateDesign, detects };                       // globais de parts.js no navegador

const MAX_PLAYERS = 8;
const MAX_ROOMS = 60;
const SHOT_KINDS = new Set(['shell', 'bullet', 'heavy', 'flame', 'rail', 'mortar', 'torp', 'missile', 'mine', 'depth']);
const LOUD_SHOTS = new Set(['shell', 'rail', 'mortar', 'torp', 'missile']);   // revelam quem atira

function createGameServer() {
const rooms = new Map();
const players = new Set();
let nextId = 1;

/* ------------------------------------------------------------------ utilidades */
const tell = (p, obj) => { try { p.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch (e) { /* conexão fechada */ } };
const clean = (s, n = 16) => String(s == null ? '' : s).replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v, lo, hi, d = 0) => { v = +v; return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const rnd = (a, b) => a + Math.random() * (b - a);

function roomCode(wanted) {
  if (wanted && /^[A-Z0-9]{4}$/.test(wanted) && !rooms.has(wanted)) return wanted;
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let k = 0; k < 50; k++) {
    let c = ''; for (let i = 0; i < 4; i++) c += A[(Math.random() * A.length) | 0];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function cleanSettings(s, old, minPlayers = 2) {
  s = s || {};
  const o = old || {};
  const pick = (v, list, d) => list.includes(+v) ? +v : d;
  const bool = (v, d) => v === undefined ? d : !!v;
  return {
    mode: s.mode === 'teams' ? 'teams' : (s.mode === 'ffa' ? 'ffa' : (o.mode || 'ffa')),
    budget: pick(s.budget, [0, 200, 300, 450, 700, 1000, 1500], o.budget !== undefined ? o.budget : 450),
    killLimit: pick(s.killLimit, [5, 10, 15, 20, 30, 50], o.killLimit || 15),
    minutes: pick(s.minutes, [0, 5, 10, 15, 20], o.minutes !== undefined ? o.minutes : 10),
    maxPlayers: Math.max(minPlayers, pick(s.maxPlayers, [2, 3, 4, 5, 6, 7, 8], o.maxPlayers || 8)),
    respawn: pick(s.respawn, [1, 3, 5, 8, 12, 15], o.respawn || 5),
    arena: pick(s.arena, [2400, 3600, 5000], o.arena || 3600),
    fog: bool(s.fog, o.fog !== undefined ? o.fog : true),
    ff: bool(s.ff, !!o.ff),
    allowSub: bool(s.allowSub, o.allowSub !== undefined ? o.allowSub : true),
    allowStealth: bool(s.allowStealth, o.allowStealth !== undefined ? o.allowStealth : true),
    allowGuided: bool(s.allowGuided, o.allowGuided !== undefined ? o.allowGuided : true),
    locked: bool(s.locked, !!o.locked),
    pass: (s.setPass || !old) && typeof s.pass === 'string' ? clean(s.pass, 8) : (o.pass || ''),   // só muda se pedirem (evita apagar a senha ao mexer em outra regra)
  };
}
const halfOf = r => (r.settings.arena || 3600) / 2;

function assignTeams(r) {
  let i = 0;
  for (const p of r.players.values()) { p.team = r.settings.mode === 'teams' ? (p.teamPref || (i % 2 ? 'B' : 'A')) : 'p' + p.id; i++; }
}

function roomInfo(r) {
  return {
    code: r.code, host: r.hostId, state: r.state, paused: !!r.paused,
    settings: Object.assign({}, r.settings, { pass: undefined, hasPass: !!r.settings.pass }),
    endsAt: r.endsAt || 0,
    players: [...r.players.values()].map(p => ({
      id: p.id, name: p.name, team: p.team, ready: p.ready, cost: p.stats ? p.stats.cost : 0, hasDesign: !!p.design,
      kills: p.kills, deaths: p.deaths, bot: !!p.isBot, diff: p.diff || '', owner: p.owner || '',
    })),
  };
}
const broadcast = (r, obj, except) => { const s = JSON.stringify(obj); for (const p of r.players.values()) if (p !== except) tell(p, s); };
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
  sig: p.sig, reveal: now < p.revealUntil, revealR: p.revealR, sub: p.sub, quiet: p.quiet,
});
/** bots controlados (hospedados) pelo jogador q */
const botsOf = (r, q) => { const out = []; for (const b of r.players.values()) if (b.owner === q.id) out.push(b); return out; };

/** o jogador q (ou um aliado dele) enxerga p? */
function canSee(r, q, p, now) {
  if (!r.settings.fog || q.team === p.team || !q.alive) return true;                 // aliados e espectadores veem tudo
  const t = dstate(p, now);
  for (const o of r.players.values()) if (o.alive && o.team === q.team && G.detects(dstate(o, now), t)) return true;
  return false;
}

function spawnPoint(r, self) {
  let best = null, bd = -1;
  for (let k = 0; k < 24; k++) {
    const H = halfOf(r), a = rnd(0, Math.PI * 2), d = rnd(H * 0.5, H * 0.8);
    const x = Math.sin(a) * d, y = -Math.cos(a) * d;
    let md = 1e9;
    for (const o of r.players.values()) if (o !== self && o.alive) md = Math.min(md, Math.hypot(o.x - x, o.y - y));
    if (md > bd) { bd = md; best = { x, y }; }
    if (md > halfOf(r) * 0.5) break;
  }
  return { x: Math.round(best.x), y: Math.round(best.y), a: +Math.atan2(-best.x, best.y).toFixed(3) };
}

/* ------------------------------------------------------------------ salas */
function leaveRoom(p) {
  const r = p.room;
  if (!r) return;
  clearTimeout(p.respawnTimer);
  r.players.delete(p.id); p.room = null; p.ready = false; p.alive = false;
  for (const b of [...r.players.values()]) if (b.owner === p.id) { clearTimeout(b.respawnTimer); r.players.delete(b.id); }   // os bots de quem saiu somem
  const humans = [...r.players.values()].filter(q => !q.isBot);
  if (!humans.length) { clearInterval(r.tick); rooms.delete(r.code); return; }
  if (r.hostId === p.id) r.hostId = humans[0].id;
  assignTeams(r);
  broadcast(r, { t: 'left', id: p.id });
  broadcastRoom(r);
  if (r.state === 'playing' && humans.length < 1 || (r.state === 'playing' && r.players.size < 2)) endMatch(r, 'Os outros jogadores saíram.');
}

function joinRoom(p, r, pass, asHost) {
  if (p.room) leaveRoom(p);
  if (!asHost) {
    if (r.state === 'playing') return tell(p, { t: 'error', msg: 'A partida já começou.' });
    if (r.bans.has(String(p.name).toLowerCase())) return tell(p, { t: 'error', msg: 'Você foi banido desta sala.' });
    if (r.settings.locked) return tell(p, { t: 'error', msg: 'A sala está trancada pelo anfitrião.' });
    if (r.settings.pass && clean(pass, 8) !== r.settings.pass) return tell(p, { t: 'error', msg: 'Esta sala tem senha. Digite a senha correta.', needPass: true });
  }
  if (r.players.size >= Math.min(MAX_PLAYERS, r.settings.maxPlayers || MAX_PLAYERS)) return tell(p, { t: 'error', msg: 'Sala cheia.' });
  r.players.set(p.id, p); p.room = r; p.ready = false; p.kills = p.deaths = 0; p.alive = false;
  assignTeams(r);
  tell(p, { t: 'joined', code: r.code });
  broadcastRoom(r);
}

function createRoom(p, settings, wantedCode) {
  if (rooms.size >= MAX_ROOMS) return tell(p, { t: 'error', msg: 'Servidor cheio. Tente mais tarde.' });
  const code = roomCode(wantedCode);
  if (!code) return tell(p, { t: 'error', msg: 'Não foi possível criar a sala.' });
  const r = { code, hostId: p.id, settings: cleanSettings(settings), players: new Map(), state: 'lobby', startedAt: 0, endsAt: 0, tick: null, paused: false, bans: new Set() };
  r.tick = setInterval(() => roomTick(r), 1000);
  rooms.set(code, r);
  joinRoom(p, r, '', true);
}

function startMatch(r) {
  const now = Date.now();
  r.state = 'playing'; r.startedAt = now; r.paused = false;
  r.endsAt = r.settings.minutes ? now + r.settings.minutes * 60000 : 0;
  assignTeams(r);
  const spawns = {};
  for (const p of r.players.values()) {
    p.kills = p.deaths = 0; p.alive = true; p.ready = !!p.isBot; p.lastSnapAt = 0;
    p.vision = p.stats.vision; p.sonar = p.stats.sonarR; p.pingR = p.stats.pingR; p.sig = p.stats.sig; p.dp = 0; p.sub = false; p.quiet = 1;
    p.revealUntil = p.pingUntil = 0; p.revealR = 0;
    const sp = spawnPoint(r, p); p.x = sp.x; p.y = sp.y; spawns[p.id] = sp;
  }
  const list = [...r.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, design: p.design, bot: !!p.isBot, owner: p.owner || '', diff: p.diff || '' }));
  for (const p of r.players.values()) tell(p, { t: 'start', you: p.id, settings: r.settings, players: list, spawns, endsAt: r.endsAt });
}

function endMatch(r, reason) {
  if (r.state !== 'playing') return;
  r.state = 'lobby'; r.endsAt = 0; r.paused = false;
  const sb = scoreboard(r);
  broadcast(r, { t: 'end', ranking: sb.list, teams: sb.teams, reason: reason || '' });
  for (const p of r.players.values()) { clearTimeout(p.respawnTimer); p.ready = !!p.isBot; p.alive = false; }
  broadcastRoom(r);
}

function roomTick(r) {
  if (r.state !== 'playing') return;
  const now = Date.now();
  if (r.paused) { broadcast(r, { t: 'score', list: scoreboard(r).list, teams: scoreboard(r).teams, left: r.endsAt ? Math.max(0, Math.round((r.endsAt - r.pausedAt) / 1000)) : -1 }); return; }
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
  if (++p.rateN > 1500) return;                                  // anti-flood
  // o anfitrião pode agir em nome dos próprios bots: { as: idDoBot }
  if (m.as && (m.t === 'snap' || m.t === 'shot' || m.t === 'ping' || m.t === 'died') && p.room) {
    const b = p.room.players.get(String(m.as).slice(0, 12));
    if (b && b.isBot && b.owner === p.id) p = b;
  }

  const r = p.room;
  switch (m.t) {
    case 'hello':
      p.name = clean(m.name) || ('Capitão' + p.id);
      tell(p, { t: 'welcome', id: p.id, name: p.name, version: G.VERSION });
      break;
    case 'p': tell(p, { t: 'po', c: m.c }); break;
    case 'rooms': {
      const list = [...rooms.values()].filter(x => x.state === 'lobby' && !x.settings.locked && x.players.size < (x.settings.maxPlayers || MAX_PLAYERS))
        .map(x => ({ code: x.code, host: (x.players.get(x.hostId) || {}).name || '?', n: x.players.size,
          settings: Object.assign({}, x.settings, { pass: undefined, hasPass: !!x.settings.pass }) }));
      tell(p, { t: 'rooms', list });
      break;
    }
    case 'create': createRoom(p, m.settings, clean(m.code, 4).toUpperCase()); break;
    case 'join': {
      const rr = rooms.get(clean(m.code, 4).toUpperCase());
      if (!rr) return tell(p, { t: 'error', msg: 'Sala não encontrada.' });
      joinRoom(p, rr, m.pass);
      break;
    }
    case 'leave': leaveRoom(p); tell(p, { t: 'left', id: p.id, self: true }); break;
    case 'settings':
      if (r && r.state === 'lobby' && r.hostId === p.id) {
        r.settings = cleanSettings(m.settings, r.settings, r.players.size); assignTeams(r);
        for (const q of [...r.players.values()]) {
          q.ready = !!q.isBot;
          if (q.isBot) { if (!G.validateDesign(q.design, 0, r.settings).ok) dropBot(r, q); }             // bots que violam as regras saem
          else if (q.design) revalidate(q, r);
        }
        broadcastRoom(r);
      }
      break;
    case 'addBot':
      if (r && r.state === 'lobby' && r.hostId === p.id) {
        const err = addBotTo(r, p, m.preset, m.design, m.diff, m.team);
        if (err) return tell(p, { t: 'error', msg: err });
        assignTeams(r); broadcastRoom(r);
      }
      break;
    case 'removeBot':
      if (r && r.hostId === p.id) {
        const b = r.players.get(clean(m.id, 12));
        if (b && b.isBot) { dropBot(r, b); assignTeams(r); broadcastRoom(r); }
      }
      break;
    case 'clearBots':
      if (r && r.hostId === p.id) {
        for (const b of [...r.players.values()]) if (b.isBot) dropBot(r, b);
        assignTeams(r); broadcastRoom(r);
      }
      break;
    case 'fillBots':
      if (r && r.state === 'lobby' && r.hostId === p.id) {
        const limit = Math.min(MAX_PLAYERS, r.settings.maxPlayers), want = Math.min(+m.n | 0, limit - r.players.size);
        const pool = G.PRESETS.filter(x => G.validateDesign(x.design, r.settings.budget || 0, r.settings).ok);
        let added = 0;
        for (let i = 0; i < want && pool.length; i++) {
          const pre = pool[(Math.random() * pool.length) | 0];
          if (!addBotTo(r, p, pre.id, null, m.diff, '')) added++;
        }
        if (!added) tell(p, { t: 'error', msg: 'Nenhum modelo de bot cabe nas regras/orçamento da sala.' });
        assignTeams(r); broadcastRoom(r);
      }
      break;
    case 'setTeam':
      if (r && r.state === 'lobby' && r.hostId === p.id && r.settings.mode === 'teams') {
        const t = r.players.get(clean(m.id, 12));
        if (t) { t.teamPref = (m.team === 'A' || m.team === 'B') ? m.team : ''; assignTeams(r); broadcastRoom(r); }
      }
      break;
    case 'balance':
      if (r && r.state === 'lobby' && r.hostId === p.id) {
        for (const q of r.players.values()) q.teamPref = '';
        assignTeams(r); broadcastRoom(r);
      }
      break;
    case 'kick': {
      if (!r || r.hostId !== p.id) break;
      const t = r.players.get(clean(m.id, 12));
      if (!t || t.isBot || t.id === p.id) break;
      if (m.ban) r.bans.add(String(t.name).toLowerCase());
      tell(t, { t: 'kicked', ban: !!m.ban });
      setTimeout(() => { leaveRoom(t); try { if (t.close) t.close(); } catch (e) { /* ignore */ } }, 80);
      break;
    }
    case 'pause':
      if (r && r.state === 'playing' && r.hostId === p.id && !!m.v !== r.paused) {
        r.paused = !!m.v;
        if (r.paused) r.pausedAt = now; else if (r.endsAt) r.endsAt += now - r.pausedAt;
        broadcast(r, { t: 'paused', v: r.paused });
      }
      break;
    case 'endNow':
      if (r && r.state === 'playing' && r.hostId === p.id) endMatch(r, 'Partida encerrada pelo anfitrião.');
      break;
    case 'addTime':
      if (r && r.state === 'playing' && r.hostId === p.id) {
        const mins = Math.max(1, Math.min(30, +m.min | 0));
        r.endsAt = (r.endsAt || (r.paused ? r.pausedAt : now)) + mins * 60000;
        broadcast(r, { t: 'say', text: '+' + mins + ' min de partida', from: 'Anfitrião' });
      }
      break;
    case 'live':                                                   // ajustes durante a partida
      if (r && r.state === 'playing' && r.hostId === p.id) {
        const keep = {};
        for (const k of ['killLimit', 'respawn', 'ff']) if (m.settings && m.settings[k] !== undefined) keep[k] = m.settings[k];
        r.settings = cleanSettings(Object.assign({}, r.settings, keep), r.settings, r.players.size);
        broadcastRoom(r); checkWin(r);
      }
      break;
    case 'say':
      if (r && r.hostId === p.id) { const text = clean(m.text, 90); if (text) broadcast(r, { t: 'say', text, from: p.name }); }
      break;
    case 'design':
      if (r && r.state === 'lobby') {
        const v = G.validateDesign(m.design, r.settings.budget, r.settings);
        if (!v.ok) { p.design = null; p.stats = null; p.ready = false; tell(p, { t: 'designErr', msg: v.error }); broadcastRoom(r); break; }
        p.design = m.design; p.stats = v.stats; p.ready = false;
        tell(p, { t: 'designOk', cost: v.stats.cost });
        broadcastRoom(r);
      }
      break;
    case 'ready':
      if (r && r.state === 'lobby' && p.design) { p.ready = !!m.v; broadcastRoom(r); }
      break;
    case 'start':
      if (r && r.state === 'lobby' && r.hostId === p.id) {
        if (r.players.size < 2) return tell(p, { t: 'error', msg: 'São necessários pelo menos 2 jogadores.' });
        for (const q of r.players.values()) if (!q.design) return tell(p, { t: 'error', msg: q.name + ' ainda não enviou um navio válido.' });
        for (const q of r.players.values()) if (q.id !== p.id && !q.ready) return tell(p, { t: 'error', msg: q.name + ' ainda não está pronto.' });
        startMatch(r);
      }
      break;

    /* ------- durante a partida ------- */
    case 'snap': {
      if (!r || r.state !== 'playing' || !p.alive || r.paused) return;
      if (now - p.lastSnapAt < 35) return;
      p.lastSnapAt = now;
      const H = halfOf(r), x = num(m.x, -H, H), y = num(m.y, -H, H);
      if (!Number.isFinite(+m.x) || !Number.isFinite(+m.y)) return;
      p.x = x; p.y = y;
      // o cliente só pode ser MENOS furtivo/atento que o projeto permite
      p.vision = num(m.v, 0, p.stats.vision, p.stats.vision);
      p.sonar = num(m.sp, 0, p.stats.sonarR, 0);
      p.pingR = num(m.pr, 0, p.stats.pingR, 0);
      p.sig = num(m.sg, p.stats.sig, 1, 1);
      p.dp = p.stats.sub ? num(m.dp, 0, 1) : 0; p.sub = p.dp > G.DEEP; p.quiet = num(m.qt, p.stats.quiet * 0.5, 1, 1);
      const out = { t: 'snap', id: p.id, x, y, a: num(m.a, -50, 50), vx: num(m.vx, -400, 400), vy: num(m.vy, -400, 400),
        fl: num(m.fl, 0, 1), sh: num(m.sh, 0, 500), v: p.vision, sp: p.sonar, pr: p.pingR, sg: p.sig, dp: p.dp, qt: p.quiet };
      if (Array.isArray(m.c) && m.c.length <= 700) out.c = m.c;
      if (Array.isArray(m.tp) && m.tp.length <= 350) out.tp = m.tp;
      const nowT = Date.now();
      if (nowT < p.revealUntil) out.rv = p.revealR;
      if (nowT < p.pingUntil) out.pg = 1;
      const s = JSON.stringify(out);
      for (const q of r.players.values()) {
        if (q === p || q.isBot || q.id === p.owner) continue;
        const mine = [q, ...botsOf(r, q)];
        if (mine.length === 1) { if (canSee(r, q, p, nowT)) tell(q, s); continue; }
        const vis = mine.filter(o => (o === q || o.alive) && canSee(r, o, p, nowT)).map(o => o.id);   // quais dos meus (eu e meus bots) enxergam
        if (vis.length) tell(q, JSON.stringify(Object.assign({}, out, { vis })));
      }
      break;
    }
    case 'shot': {
      if (!r || r.state !== 'playing' || !p.alive || r.paused || !SHOT_KINDS.has(m.kind)) return;
      const vals = ['x', 'y', 'vx', 'vy', 'life', 'dmg'];
      for (const k of vals) if (!Number.isFinite(+m[k])) return;
      const sh = { t: 'shot', kind: m.kind, id: clean(m.id, 24), owner: p.id, team: p.team,
        x: +m.x, y: +m.y, vx: num(m.vx, -1500, 1500), vy: num(m.vy, -1500, 1500), life: num(m.life, 0, 6), dmg: num(m.dmg, 0, 16),
        pierce: num(m.pierce, 0, 4), big: !!m.big, splash: num(m.splash, 0, 70), turn: num(m.turn, 0, 4), ang: num(m.ang, -50, 50), speed: num(m.speed, 0, 1200),
        tx: num(m.tx, -4000, 4000), ty: num(m.ty, -4000, 4000), T: num(m.T, 0, 6), x0: num(m.x0, -4000, 4000), y0: num(m.y0, -4000, 4000), tg: clean(m.tg, 12),
        fuse: num(m.fuse, 0, 4), dmgSurf: num(m.dmgSurf, 0, 16), arm: num(m.arm, 0, 6) };
      if (LOUD_SHOTS.has(m.kind)) { p.revealUntil = now + 1500; p.revealR = 900; }
      const s = JSON.stringify(sh);
      for (const q of r.players.values()) {
        if (q === p || q.isBot || q.id === p.owner) continue;
        if (q.team === p.team || !q.alive || [q, ...botsOf(r, q)].some(o => Math.hypot(o.x - sh.x, o.y - sh.y) < 2600)) tell(q, s);
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
      if (r.state === 'playing') scheduleRespawn(r, p, r.settings.respawn * 1000);
      break;
    }
  }
}

function scheduleRespawn(r, p, ms) {
  clearTimeout(p.respawnTimer);
  p.respawnTimer = setTimeout(() => {
    if (r.state !== 'playing' || !r.players.has(p.id)) return;
    if (r.paused) return scheduleRespawn(r, p, 500);                // pausado: espera
    p.alive = true; p.lastSnapAt = 0;
    const sp = spawnPoint(r, p); p.x = sp.x; p.y = sp.y;
    p.vision = p.stats.vision; p.sonar = p.stats.sonarR; p.pingR = p.stats.pingR; p.sig = p.stats.sig; p.dp = 0; p.sub = false; p.quiet = 1;
    p.revealUntil = p.pingUntil = 0;
    broadcast(r, { t: 'spawn', id: p.id, x: sp.x, y: sp.y, a: sp.a });
  }, ms);
}

/** cria um bot na sala (devolve texto de erro ou null) */
function addBotTo(r, owner, presetId, design, diff, teamPref) {
  const limit = Math.min(MAX_PLAYERS, r.settings.maxPlayers || MAX_PLAYERS);
  if (r.players.size >= limit) return 'Sala cheia.';
  let name = '';
  const pre = G.PRESETS.find(x => x.id === presetId);
  if (pre) { design = pre.design; name = pre.name; } else if (presetId === 'meu' && design) { name = 'Clone'; } else design = null;
  if (!design) return 'Modelo de bot inválido.';
  const v = G.validateDesign(design, 0, r.settings);
  if (!v.ok) return 'Bot não permitido: ' + v.error;
  diff = ['facil', 'normal', 'dificil', 'mestre'].includes(diff) ? diff : 'normal';
  let n = 1; for (const q of r.players.values()) if (q.isBot && q.name.replace(/ \d+$/, '') === '🤖 ' + name) n++;
  const id = 'b' + (nextId++);
  r.players.set(id, { id, isBot: true, owner: owner.id, send: () => {}, name: '🤖 ' + name + (n > 1 ? ' ' + n : ''), room: r, design, stats: v.stats, ready: true,
    team: '', teamPref: (teamPref === 'A' || teamPref === 'B') ? teamPref : '', diff, kills: 0, deaths: 0, alive: false,
    x: 0, y: 0, vision: 650, sonar: 0, pingR: 0, sig: 1, sub: false, quiet: 1, dp: 0, revealUntil: 0, revealR: 0, pingUntil: 0, lastSnapAt: 0, rateT: 0, rateN: 0, respawnTimer: null });
  return null;
}

/** remove um bot (também durante a partida: os clientes recebem "left") */
function dropBot(r, b) {
  clearTimeout(b.respawnTimer); r.players.delete(b.id);
  if (r.state === 'playing') broadcast(r, { t: 'left', id: b.id });
}

/** a sala mudou o orçamento: revalida o navio de quem já enviou */
function revalidate(q, r) {
  const v = G.validateDesign(q.design, r.settings.budget, r.settings);
  if (!v.ok) { q.design = null; q.stats = null; tell(q, { t: 'designErr', msg: v.error }); } else q.stats = v.stats;
}


/* ------------------------------------------------------------------ conexões */
/** registra um novo cliente; sendFn(texto) entrega mensagens a ele */
function connect(sendFn, closeFn) {
  const p = { id: 'u' + (nextId++), send: sendFn, close: closeFn, name: '', room: null, design: null, stats: null, ready: false, team: '', kills: 0, deaths: 0, alive: false,
    x: 0, y: 0, vision: 650, sonar: 0, pingR: 0, sig: 1, sub: false, quiet: 1, dp: 0, revealUntil: 0, revealR: 0, pingUntil: 0, lastSnapAt: 0, rateT: 0, rateN: 0, respawnTimer: null };
  players.add(p);
  tell(p, { t: 'hi', id: p.id, version: G.VERSION });
  return p;
}
function disconnect(p) { leaveRoom(p); players.delete(p); }
function message(p, raw) { try { onMessage(p, typeof raw === 'string' ? raw : String(raw)); } catch (e) { if (typeof console !== 'undefined') console.error('erro de mensagem:', e.message); } }

return { connect, disconnect, message, rooms, players };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createGameServer };
else root.createGameServer = createGameServer;
})(typeof window !== 'undefined' ? window : globalThis);
