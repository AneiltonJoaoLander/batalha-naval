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
  : { VERSION, DEEP, PRESETS, validateDesign, detects, stripCrew, BIOME_KEYS, genMap, pickSpawn, zoneStep, routeLength, routeProject, routePoint, CARGO_DESIGN };     // globais de parts.js no navegador

const MAX_PLAYERS = 8;
const MAX_ROOMS = 60;
const SHOT_KINDS = new Set(['shell', 'bullet', 'heavy', 'flame', 'rail', 'mortar', 'torp', 'missile', 'mine', 'depth', 'ballistic']);
const LOUD_SHOTS = new Set(['shell', 'rail', 'mortar', 'torp', 'missile', 'ballistic']);
const DRONE_KINDS = ['recon', 'attack', 'kamikaze', 'escort', 'bomber', 'torpedo', 'swarm', 'aew'];
const LOCK_KINDS = ['radar', 'heat', 'gps', 'tele'];   // revelam quem atira

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
    mode: ['ffa', 'teams', 'zone', 'convoy'].includes(s.mode) ? s.mode : (o.mode || 'ffa'),
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
    env: (s.env === 'rand' || G.BIOME_KEYS.includes(s.env)) ? s.env : (o.env || 'rand'),
    islands: pick(s.islands, [0, 1, 2, 3], o.islands !== undefined ? o.islands : 2),
    scoreLimit: pick(s.scoreLimit, [100, 200, 300, 500], o.scoreLimit || 300),
    cargoLives: pick(s.cargoLives, [2, 3, 5, 8], o.cargoLives || 3),
    locked: bool(s.locked, !!o.locked),
    pass: (s.setPass || !old) && typeof s.pass === 'string' ? clean(s.pass, 8) : (o.pass || ''),   // só muda se pedirem (evita apagar a senha ao mexer em outra regra)
  };
}
const halfOf = r => (r.settings.arena || 3600) / 2;
const teamMode = r => r.settings.mode !== 'ffa';
const objMode = r => (r.settings.mode === 'zone' || r.settings.mode === 'convoy') ? r.settings.mode : '';

function assignTeams(r) {
  let i = 0;
  for (const p of r.players.values()) {
    if (p.cargo) { p.team = 'A'; continue; }
    p.team = teamMode(r) ? (p.teamPref || (i % 2 ? 'B' : 'A')) : 'p' + p.id; i++;
  }
}

function roomInfo(r) {
  return {
    code: r.code, host: r.hostId, state: r.state, paused: !!r.paused,
    settings: Object.assign({}, r.settings, { pass: undefined, hasPass: !!r.settings.pass }),
    endsAt: r.endsAt || 0,
    players: [...r.players.values()].filter(p => !p.cargo).map(p => ({
      id: p.id, name: p.name, team: p.team, ready: p.ready, cost: p.stats ? p.stats.cost : 0, hasDesign: !!p.design,
      kills: p.kills, deaths: p.deaths, bot: !!p.isBot, diff: p.diff || '', owner: p.owner || '',
    })),
  };
}
const broadcast = (r, obj, except) => { const s = JSON.stringify(obj); for (const p of r.players.values()) if (p !== except) tell(p, s); };
const broadcastRoom = r => broadcast(r, { t: 'room', room: roomInfo(r) });

function scoreboard(r) {
  const list = [...r.players.values()].filter(p => !p.cargo).map(p => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths }));
  list.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const teams = {};
  if (teamMode(r)) for (const p of list) teams[p.team] = (teams[p.team] || 0) + p.kills;
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
  for (const o of r.players.values()) {
    if (!o.alive || o.team !== q.team) continue;
    if (G.detects(dstate(o, now), t)) return true;
    for (const d of o.drones || []) if (G.detects({ x: d[0], y: d[1], vision: d[5], sonar: 0, pingR: 0, ping: false, sig: 1, reveal: false, revealR: 0, sub: false, quiet: 1 }, t)) return true;   // drones aliados enxergam
  }
  return false;
}

function spawnPoint(r, self) {
  const avoid = [];
  for (const o of r.players.values()) if (o !== self && o.alive) avoid.push([o.x, o.y]);
  const sp = G.pickSpawn(r.map, objMode(r) ? self.team : '', Math.random, avoid);       // longe das ilhas; modos com objetivo: cada equipe num lado
  return { x: sp.x, y: sp.y, a: sp.a };
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
  const real = [...r.players.values()].filter(q => !q.cargo).length;
  if (r.state === 'playing' && (humans.length < 1 || real < 2)) endMatch(r, 'Os outros jogadores saíram.');
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
  const now = Date.now(), S = r.settings, om = objMode(r);
  r.state = 'playing'; r.startedAt = now; r.paused = false;
  r.endsAt = S.minutes ? now + S.minutes * 60000 : 0;
  assignTeams(r);
  const env = S.env === 'rand' ? G.BIOME_KEYS[(Math.random() * G.BIOME_KEYS.length) | 0] : S.env;
  r.mapInfo = { seed: (Math.random() * 1e9) | 0, env, level: S.islands };
  r.map = G.genMap(r.mapInfo.seed, S.arena, env, S.islands, om);
  r.obj = { zs: { z: [], score: { A: 0, B: 0 } }, maxProg: 0, cur: 0, lives: S.cargoLives, len: om === 'convoy' ? G.routeLength(r.map.route) : 0 };
  const spawns = {};
  if (om === 'convoy') {                                                       // o cargueiro é uma "entidade-bot" hospedada pelo anfitrião
    const v = G.validateDesign(G.CARGO_DESIGN, 0, {}), rt = r.map.route, a = Math.atan2(rt[1][0] - rt[0][0], -(rt[1][1] - rt[0][1]));
    r.players.set('cargo', { id: 'cargo', isBot: true, cargo: true, owner: r.hostId, send: () => {}, name: '🚢 Cargueiro', room: r, design: G.CARGO_DESIGN, stats: v.stats, ready: true,
      team: 'A', teamPref: 'A', diff: 'normal', kills: 0, deaths: 0, alive: true, x: rt[0][0] + 90, y: rt[0][1], vision: v.stats.vision, sonar: 0, pingR: 0, sig: v.stats.sig, sub: false, quiet: 1,
      dp: 0, revealUntil: 0, revealR: 0, pingUntil: 0, lastSnapAt: 0, rateT: 0, rateN: 0, respawnTimer: null });
    spawns.cargo = { x: rt[0][0] + 90, y: rt[0][1], a: +a.toFixed(3) };
  }
  for (const p of r.players.values()) {
    p.kills = p.deaths = 0; p.alive = true; p.ready = !!p.isBot; p.lastSnapAt = 0;
    p.vision = p.stats.vision; p.sonar = p.stats.sonarR; p.pingR = p.stats.pingR; p.sig = p.stats.sig; p.dp = 0; p.sub = false; p.quiet = 1;
    p.revealUntil = p.pingUntil = 0; p.revealR = 0; p.drones = [];
    if (p.cargo) continue;
    const sp = spawnPoint(r, p); p.x = sp.x; p.y = sp.y; spawns[p.id] = sp;
  }
  const owns = (a, b) => a.id === b.id || a.team === b.team || a.id === b.owner || b.id === a.owner;      // a tripulação só é visível para o próprio time
  for (const p of r.players.values()) {
    const list = [...r.players.values()].map(o => ({ id: o.id, name: o.name, team: o.team, design: owns(p, o) ? o.design : G.stripCrew(o.design), bot: !!o.isBot, owner: o.owner || '', diff: o.diff || '', cargo: !!o.cargo }));
    tell(p, { t: 'start', you: p.id, settings: r.settings, players: list, spawns, endsAt: r.endsAt, map: r.mapInfo });
  }
}

function endMatch(r, reason) {
  if (r.state !== 'playing') return;
  r.state = 'lobby'; r.endsAt = 0; r.paused = false;
  const sb = scoreboard(r);
  const cg = r.players.get('cargo'); if (cg) { clearTimeout(cg.respawnTimer); r.players.delete('cargo'); }
  broadcast(r, { t: 'end', ranking: sb.list, teams: sb.teams, reason: reason || '' });
  for (const p of r.players.values()) { clearTimeout(p.respawnTimer); p.ready = !!p.isBot; p.alive = false; }
  r.map = null; r.obj = null;
  broadcastRoom(r);
}

/** atualiza o objetivo (zonas / comboio) e devolve o resumo enviado aos clientes */
function objTick(r) {
  const om = objMode(r), o = r.obj;
  if (!om || !o || !r.map) return null;
  if (om === 'zone') {
    const ships = [...r.players.values()].filter(p => p.alive && !p.cargo).map(p => ({ x: p.x, y: p.y, team: p.team }));
    G.zoneStep(o.zs, r.map.zones, ships, 1, ['A', 'B']);
    const sc = o.zs.score, L = r.settings.scoreLimit;
    if ((sc.A || 0) >= L) endMatch(r, 'Equipe A dominou as zonas!'); else if ((sc.B || 0) >= L) endMatch(r, 'Equipe B dominou as zonas!');
    return { mode: 'zone', z: o.zs.z.map(z => [+z.cap.toFixed(3), z.owner, z.contested ? 1 : 0]), sc: { A: Math.floor(sc.A || 0), B: Math.floor(sc.B || 0) }, lim: L };
  }
  const c = r.players.get('cargo');
  if (c && c.alive) {
    const pr = G.routeProject(r.map.route, c.x, c.y);
    o.cur = pr.t; o.maxProg = Math.max(o.maxProg, pr.t);
    if (pr.t > o.len - 150) endMatch(r, 'Equipe A venceu: o comboio chegou ao destino!');
  }
  return { mode: 'convoy', prog: o.len ? +(o.cur / o.len).toFixed(3) : 0, lives: o.lives, alive: !!(c && c.alive) };
}

function roomTick(r) {
  if (r.state !== 'playing') return;
  const now = Date.now();
  if (r.paused) { broadcast(r, { t: 'score', list: scoreboard(r).list, teams: scoreboard(r).teams, left: r.endsAt ? Math.max(0, Math.round((r.endsAt - r.pausedAt) / 1000)) : -1 }); return; }
  if (r.endsAt && now >= r.endsAt) {
    const om = objMode(r);
    if (om === 'zone') { const sc = r.obj ? r.obj.zs.score : {}; return endMatch(r, (sc.A || 0) === (sc.B || 0) ? 'Tempo esgotado: empate!' : 'Tempo esgotado: Equipe ' + ((sc.A || 0) > (sc.B || 0) ? 'A' : 'B') + ' venceu!'); }
    if (om === 'convoy') return endMatch(r, 'Tempo esgotado: Equipe B venceu (o comboio não chegou)!');
    return endMatch(r, 'Tempo esgotado!');
  }
  const obj = objTick(r);
  if (r.state !== 'playing') return;
  const sb = scoreboard(r);
  broadcast(r, { t: 'score', list: sb.list, teams: sb.teams, left: r.endsAt ? Math.max(0, Math.round((r.endsAt - now) / 1000)) : -1, obj: obj || undefined });
}

function checkWin(r) {
  if (objMode(r)) return;                                                       // nos modos com objetivo os abates não encerram a partida
  const sb = scoreboard(r), L = r.settings.killLimit;
  if (teamMode(r)) {
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
      if (r && r.state === 'lobby' && r.hostId === p.id && teamMode(r)) {
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
      out.wt = num(m.wt, 0, 1, 0);
      if (Array.isArray(m.fi) && m.fi.length <= 120) out.fi = m.fi.filter(n => Number.isInteger(n) && n >= 0 && n < 350);
      p.drones = [];
      if (Array.isArray(m.dr) && p.stats.hangars) {
        for (const d of m.dr.slice(0, Math.min(12, p.stats.hangars * 3))) {
          if (!Array.isArray(d) || !DRONE_KINDS.includes(d[3])) continue;
          p.drones.push([num(d[0], -H, H), num(d[1], -H, H), num(d[2], -50, 50), d[3], num(d[4], 0, 20), Math.min(num(d[5], 0, 750), 750)]);
        }
      }
      if (p.drones.length) out.dr = p.drones;
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
      if (m.kind === 'ballistic' && !(p.stats && p.stats.ballistics)) return;
      if (m.kind === 'missile' && !(p.stats && p.stats.missiles)) return;
      const sh = { t: 'shot', kind: m.kind, id: clean(m.id, 24), owner: p.id, team: p.team,
        x: +m.x, y: +m.y, vx: num(m.vx, -1500, 1500), vy: num(m.vy, -1500, 1500), life: num(m.life, 0, 14), dmg: num(m.dmg, 0, 16),
        pierce: num(m.pierce, 0, 4), big: !!m.big, splash: num(m.splash, 0, 130), turn: num(m.turn, 0, 4), ang: num(m.ang, -50, 50), speed: num(m.speed, 0, 1200),
        tx: num(m.tx, -4000, 4000), ty: num(m.ty, -4000, 4000), T: num(m.T, 0, 14), x0: num(m.x0, -4000, 4000), y0: num(m.y0, -4000, 4000), tg: clean(m.tg, 12),
        fuse: num(m.fuse, 0, 4), dmgSurf: num(m.dmgSurf, 0, 16), arm: num(m.arm, 0, 6),
        lk: LOCK_KINDS.includes(m.lk) ? m.lk : '', sz: ['S', 'M', 'L', 'G'].includes(m.sz) ? m.sz : '', gx: num(m.gx, -4000, 4000), gy: num(m.gy, -4000, 4000) };
      if (LOUD_SHOTS.has(m.kind)) { p.revealUntil = now + 1500; p.revealR = 900; }
      const s = JSON.stringify(sh);
      for (const q of r.players.values()) {
        if (q === p || q.isBot || q.id === p.owner) continue;
        if (sh.kind === 'ballistic' || q.team === p.team || !q.alive || [q, ...botsOf(r, q)].some(o => Math.hypot(o.x - sh.x, o.y - sh.y) < 2600)) tell(q, s);   // balístico: alerta para todos
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
      if (p.cargo && r.obj) { r.obj.lives--; if (r.obj.lives <= 0) { endMatch(r, 'Equipe B venceu: o cargueiro foi destruído!'); break; } }
      checkWin(r);
      if (r.state === 'playing') scheduleRespawn(r, p, (p.cargo ? 10 : r.settings.respawn) * 1000);
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
    let sp;
    if (p.cargo && r.map && r.obj) {                                          // o cargueiro renasce no último ponto de controle
      const step = r.obj.len / 5, cp = Math.floor(r.obj.maxProg / step) * step, p1 = G.routePoint(r.map.route, cp), p2 = G.routePoint(r.map.route, Math.min(r.obj.len, cp + 80));
      sp = { x: Math.round(p1[0]), y: Math.round(p1[1]), a: +Math.atan2(p2[0] - p1[0], -(p2[1] - p1[1])).toFixed(3) };
    } else sp = spawnPoint(r, p);
    p.x = sp.x; p.y = sp.y;
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
