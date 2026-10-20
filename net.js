'use strict';
/* =====================================================================
   MODO ONLINE (cliente). Funciona só com o GitHub Pages:
     - Padrão (P2P): WebRTC via PeerJS. O navegador do ANFITRIÃO roda a lógica do
       servidor (gameserver.js); os outros jogadores se conectam a ele por código/link.
       Estrutura cliente <-> servidor (anfitrião) <-> clientes.
     - Opcional: servidor dedicado por WebSocket (server/server.js).
   ===================================================================== */
const PEER_PREFIX = 'bnaval1-';
const PEER_OPTS = {
  debug: 0,
  config: { iceServers: (window.BN_CONFIG && BN_CONFIG.iceServers) || [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ] },
};
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const Online = {
  ws: null, tx: null, kind: null, peer: null, conn: null, gs: null, localP: null, code: '',
  ok: false, connecting: false, id: null, name: '', room: null, url: '',
  pingMs: 0, cfg: null, inMatch: false, designOk: false, designMsg: '',
  snapT: 0, snapN: 0, scores: [], teams: {}, left: -1, feed: [], noticeT: 0, pingTimer: null,

  /* ------------------------------------------------------------ endereço padrão */
  defaultUrl() {
    if (window.BN_CONFIG && BN_CONFIG.serverUrl) return BN_CONFIG.serverUrl;
    if (Meta.server) return Meta.server;
    const h = location.hostname;
    if (location.protocol === 'file:') return '';
    if (h === 'localhost' || h === '127.0.0.1') return 'ws://' + h + ':8787';
    return '';
  },

  /* ----------------------------------------------------------------- interface */
  init() {
    const $ = id => document.getElementById(id);
    $('on-name').value = Meta.name || ('Capitão' + (1000 + ((Math.random() * 9000) | 0)));
    $('on-url').value = this.defaultUrl();
    $('on-back').onclick = () => { UI.show('yard'); };
    $('on-create').onclick = () => this.createRoom();
    $('on-join').onclick = () => this.joinRoom($('on-code').value);
    $('on-code').onkeydown = e => { if (e.key === 'Enter') $('on-join').click(); };
    $('on-connect-btn').onclick = () => this.connect();
    $('on-disconnect').onclick = () => this.disconnect();
    $('on-refresh').onclick = () => this.send({ t: 'rooms' });
    $('on-edit-ship').onclick = () => UI.show('yard');
    $('on-send-ship').onclick = () => this.sendDesign();
    $('on-ready').onclick = () => { const me = this.me(); this.send({ t: 'ready', v: !(me && me.ready) }); };
    $('on-start').onclick = () => this.send({ t: 'start' });
    $('on-leave').onclick = () => this.leaveRoom();
    $('on-copy').onclick = () => this.copyLink();
    const envOpts = '<option value="rand">Aleatório</option>' + BIOME_KEYS.map(k => `<option value="${k}">${BIOMES[k].name}</option>`).join('');
    $('cr-env').innerHTML = envOpts; $('lb-env').innerHTML = envOpts;
    const sel = $('ba-model');
    sel.innerHTML = PRESETS.map(p => `<option value="${p.id}">${esc(p.name)} (poder ${p.power})</option>`).join('') + '<option value="meu">Clone do meu navio</option>';
    $('ba-diff').innerHTML = Object.keys(BOT_DIFFS).map(k => `<option value="${k}">${BOT_DIFFS[k].name}</option>`).join('');
    $('ba-diff').value = Meta.bots.diff;
    $('ba-add').onclick = () => {
      const m = { t: 'addBot', preset: sel.value, diff: $('ba-diff').value, team: $('ba-team').value };
      if (sel.value === 'meu') m.design = Builder.getDesign();
      this.send(m);
    };
    for (const id of ['lb-mode', 'lb-budget', 'lb-kills', 'lb-min', 'lb-max', 'lb-resp', 'lb-arena', 'lb-fog', 'lb-ff', 'lb-sub', 'lb-stealth', 'lb-guided', 'lb-lock', 'lb-env', 'lb-isl', 'lb-score', 'lb-lives'])
      $(id).onchange = () => this.send({ t: 'settings', settings: this.formSettings('lb') });
    $('lb-pass').onchange = () => this.send({ t: 'settings', settings: Object.assign(this.formSettings('lb'), { pass: $('lb-pass').value.trim(), setPass: true }) });
    $('ht-fill').onclick = () => this.send({ t: 'fillBots', n: 8, diff: $('ba-diff').value });
    $('ht-clear').onclick = () => this.send({ t: 'clearBots' });
    $('ht-balance').onclick = () => this.send({ t: 'balance' });
    $('host-btn').onclick = () => this.openHostPanel();
    this.render();
    // convite por link: ?sala=CODIGO entra direto
    const q = new URLSearchParams(location.search).get('sala');
    if (q && /^[A-Za-z0-9]{4}$/.test(q)) { $('on-code').value = q.toUpperCase(); this.show(); setTimeout(() => this.joinRoom(q), 300); }
  },
  formSettings(p) {
    const $ = id => document.getElementById(p + '-' + id);
    const o = { mode: $('mode').value, budget: +$('budget').value, killLimit: +$('kills').value, minutes: +$('min').value };
    const num = (id, key) => { const e = $(id); if (e) o[key] = +e.value; };
    const chk = (id, key) => { const e = $(id); if (e) o[key] = e.checked; };
    num('max', 'maxPlayers'); num('resp', 'respawn'); num('arena', 'arena'); num('isl', 'islands'); num('score', 'scoreLimit'); num('lives', 'cargoLives');
    { const e = $('env'); if (e) o.env = e.value; }
    chk('fog', 'fog'); chk('ff', 'ff'); chk('sub', 'allowSub'); chk('stealth', 'allowStealth'); chk('guided', 'allowGuided'); chk('lock', 'locked');
    const pw = $('pass'); if (pw && p === 'cr') o.pass = pw.value.trim();             // no lobby a senha tem campo/evento próprio
    return o;
  },
  makeCode() { let c = ''; for (let i = 0; i < 4; i++) c += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0]; return c; },
  myName() { const n = document.getElementById('on-name').value.trim().slice(0, 16); return n || 'Capitão'; },
  me() { return this.room ? this.room.players.find(p => p.id === this.id) : null; },
  isHost() { return !!(this.room && this.room.host === this.id); },
  err(msg) { const e = document.getElementById('on-error'); e.textContent = msg || ''; e.classList.toggle('hidden', !msg); },

  show() {
    UI.show('online');
    document.getElementById('on-url').value = document.getElementById('on-url').value || this.defaultUrl();
    if (this.ok && this.room) this.sendDesign();            // navio pode ter mudado no estaleiro
    else if (this.ok && this.kind === 'ws') this.send({ t: 'rooms' });
    this.render();
  },

  render() {
    const $ = id => document.getElementById(id);
    const where = this.kind === 'host' ? 'anfitrião' : this.kind === 'peer' ? 'convidado' : this.kind === 'ws' ? 'servidor' : '';
    $('on-status').textContent = this.ok ? ('● conectado (' + where + ')' + (this.pingMs ? ' · ' + this.pingMs + ' ms' : '')) : this.connecting ? '… conectando' : '○ offline';
    $('on-status').className = 'status ' + (this.ok ? 'ok' : '');
    $('on-connect').classList.toggle('hidden', !!this.room);
    $('on-lobby').classList.toggle('hidden', !this.room);
    $('on-conn-info').classList.toggle('hidden', this.kind !== 'ws' || !this.ok);
    $('on-who').textContent = this.name;
    $('on-rooms-wrap').classList.toggle('hidden', !(this.kind === 'ws' && this.ok));
    for (const id of ['on-create', 'on-join', 'on-connect-btn']) $(id).disabled = this.connecting;
    $('on-copy').classList.toggle('hidden', this.kind === 'ws');
    if (this.room) this.renderLobby();
  },

  renderLobby() {
    const $ = id => document.getElementById(id), r = this.room, host = this.isHost(), me = this.me();
    $('lobby-code').textContent = r.code;
    const S = r.settings, teams = S.mode !== 'ffa', om = S.mode === 'zone' || S.mode === 'convoy';
    $('lb-mode').value = S.mode; $('lb-budget').value = S.budget; $('lb-kills').value = S.killLimit; $('lb-min').value = S.minutes;
    $('lb-max').value = S.maxPlayers; $('lb-resp').value = S.respawn; $('lb-arena').value = S.arena;
    $('lb-env').value = S.env || 'rand'; $('lb-isl').value = String(S.islands == null ? 2 : S.islands); $('lb-score').value = String(S.scoreLimit || 300); $('lb-lives').value = String(S.cargoLives || 3);
    $('lb-score-wrap').style.display = S.mode === 'zone' ? '' : 'none'; $('lb-lives-wrap').style.display = S.mode === 'convoy' ? '' : 'none'; $('lb-kills-wrap').style.display = om ? 'none' : '';
    $('lb-fog').checked = S.fog !== false; $('lb-ff').checked = !!S.ff; $('lb-sub').checked = S.allowSub !== false;
    $('lb-stealth').checked = S.allowStealth !== false; $('lb-guided').checked = S.allowGuided !== false; $('lb-lock').checked = !!S.locked;
    if (document.activeElement !== $('lb-pass')) $('lb-pass').value = '';
    $('lb-pass').placeholder = S.hasPass ? '(senha definida — digite para trocar)' : 'sem senha';
    for (const id of ['lb-mode', 'lb-budget', 'lb-kills', 'lb-min', 'lb-max', 'lb-resp', 'lb-arena', 'lb-fog', 'lb-ff', 'lb-sub', 'lb-stealth', 'lb-guided', 'lb-lock', 'lb-pass', 'lb-env', 'lb-isl', 'lb-score', 'lb-lives']) $(id).disabled = !host;
    $('lb-ff').disabled = !host || !teams;
    $('lobby-flags').textContent = [S.mode === 'zone' ? '🏁 Controle de Zona' : S.mode === 'convoy' ? '🚢 Comboio (A defende, B ataca)' : '', '🗺 ' + (S.env === 'rand' || !BIOMES[S.env] ? 'ambiente aleatório' : BIOMES[S.env].name), S.locked ? '🔒 sala trancada' : '', S.hasPass ? '🔑 com senha' : '', S.fog === false ? '👁 sem névoa' : '', S.ff ? '💥 fogo amigo' : '',
      S.allowSub === false ? '🚫 submarinos' : '', S.allowStealth === false ? '🚫 furtivo' : '', S.allowGuided === false ? '🚫 guiadas' : ''].filter(Boolean).join(' · ');
    $('lobby-players').innerHTML = r.players.map(p => {
      const isHostRow = p.id === r.host;
      const teamBadge = teams ? (host ? `<button class="team t${p.team} tbtn-team" data-team="${p.id}" data-cur="${p.team}" title="Trocar de equipe">Equipe ${p.team} ⇄</button>` : `<span class="team t${p.team}">Equipe ${p.team}</span>`) : '';
      const status = p.bot ? ((BOT_DIFFS[p.diff] || {}).name || 'bot') : isHostRow ? 'anfitrião' : p.ready ? 'pronto' : 'aguardando';
      const actions = host ? (p.bot ? ` <button class="x-btn" data-rm="${p.id}" title="Remover bot">✕</button>`
        : !isHostRow ? ` <button class="x-btn" data-kick="${p.id}" title="Expulsar">⏏</button><button class="x-btn" data-ban="${p.id}" title="Banir">🚫</button>` : '') : '';
      return `<div class="pl-row ${p.id === this.id ? 'me' : ''}">
        <span class="pl-name">${isHostRow ? '👑 ' : ''}${esc(p.name)}</span>${teamBadge}
        <span class="pl-cost">${p.hasDesign ? '🪙 ' + p.cost : 'sem navio'}</span>
        <span class="pl-ready ${p.ready || isHostRow || p.bot ? 'on' : ''}">${status}${actions}</span></div>`;
    }).join('');
    const L = $('lobby-players');
    L.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => this.send({ t: 'removeBot', id: b.dataset.rm }));
    L.querySelectorAll('[data-team]').forEach(b => b.onclick = () => this.send({ t: 'setTeam', id: b.dataset.team, team: b.dataset.cur === 'A' ? 'B' : 'A' }));
    L.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => { if (confirm('Expulsar este jogador da sala?')) this.send({ t: 'kick', id: b.dataset.kick }); });
    L.querySelectorAll('[data-ban]').forEach(b => b.onclick = () => { if (confirm('Banir este jogador? Ele não poderá entrar de novo com o mesmo nome.')) this.send({ t: 'kick', id: b.dataset.ban, ban: true }); });
    $('host-tools').classList.toggle('hidden', !host);
    $('ht-balance').classList.toggle('hidden', !teams);
    $('bot-add').classList.toggle('hidden', !host);
    $('ba-team').classList.toggle('hidden', !teams);
    const budget = r.settings.budget ? r.settings.budget : '∞';
    const mine = Builder.analyze();
    $('lobby-ship').innerHTML = `Seu navio: <b>🪙 ${mine.stats.cost}</b> / ${budget}` +
      (this.designOk ? ' <span class="okc">✔ enviado</span>' : (this.designMsg ? ` <span class="errc">⛔ ${esc(this.designMsg)}</span>` : ''));
    $('on-ready').textContent = me && me.ready ? '✋ Cancelar pronto' : '✔ Estou pronto';
    $('on-ready').classList.toggle('hidden', host);
    $('on-ready').disabled = !this.designOk;
    $('on-start').classList.toggle('hidden', !host);
    $('on-start').disabled = r.players.length < 2;
  },

  renderRooms(list) {
    const el = document.getElementById('on-rooms');
    el.innerHTML = list.length ? list.map(x => `<button class="room-row" data-code="${x.code}">
        <b>${x.code}</b> <span>${esc(x.host)}</span> <small>${x.n}/8 · ${({ teams: 'equipes', zone: 'controle de zona', convoy: 'comboio' })[x.settings.mode] || 'todos contra todos'} · 🪙${x.settings.budget || '∞'} · ${x.settings.killLimit} abates</small></button>`).join('')
      : '<p class="muted">Nenhuma sala aberta. Crie a sua!</p>';
    el.querySelectorAll('.room-row').forEach(b => b.onclick = () => this.send({ t: 'join', code: b.dataset.code }));
  },

  /* ------------------------------------------------------------------ transporte */
  fail(msg) { this.connecting = false; this.cleanup(); this.err(msg); this.render(); },

  /** derruba conexões e estado; mantém a tela */
  cleanup() {
    clearInterval(this.pingTimer);
    if (this.conn) { try { this.conn.close(); } catch (e) { /* ignore */ } }
    if (this.peer) { try { this.peer.destroy(); } catch (e) { /* ignore */ } }
    if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch (e) { /* ignore */ } }
    this.ws = this.conn = this.peer = this.tx = this.gs = this.localP = null;
    this.kind = null; this.ok = false; this.room = null; this.id = null; this.code = '';
  },

  /** carrega a PeerJS só quando preciso (a campanha continua leve/offline) */
  loadPeer() {
    if (window.Peer) return Promise.resolve();
    return new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = 'vendor/peerjs.min.js'; sc.onload = res; sc.onerror = () => rej(new Error('peerjs'));
      document.head.appendChild(sc);
    });
  },

  createRoom() {
    if (this.kind === 'ws' && this.ok) return this.send({ t: 'create', settings: this.formSettings('cr') });
    this.startHost();
  },
  joinRoom(code) {
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) return this.err('Digite o código de 4 letras/números da sala.');
    const pass = (document.getElementById('on-pass').value || '').trim();
    this.joinPass = pass;
    if (this.kind === 'ws' && this.ok) return this.send({ t: 'join', code, pass });
    if (this.kind === 'peer' && this.ok && !this.room && this.joinCode === code) return this.send({ t: 'join', code, pass });   // já conectado ao anfitrião: só reenvia (senha corrigida)
    this.startJoin(code);
  },
  leaveRoom() {
    if (this.kind === 'host' || this.kind === 'peer') { this.cleanup(); this.err(''); this.render(); return; }   // anfitrião saindo encerra a sala
    this.send({ t: 'leave' });
  },

  /** P2P — ANFITRIÃO: este navegador é o servidor da sala */
  async startHost() {
    this.err(''); this.name = this.myName(); this.cleanup(); this.connecting = true; this.render();
    try { await this.loadPeer(); } catch (e) { return this.fail('Não foi possível carregar a biblioteca de conexão.'); }
    const settings = this.formSettings('cr');
    const timeout = setTimeout(() => { if (!this.ok) this.fail('Tempo esgotado ao registrar a sala (sem internet?).'); }, 20000);
    const open = () => {
      const code = this.makeCode();
      const peer = new Peer(PEER_PREFIX + code, PEER_OPTS);
      this.peer = peer; this.kind = 'host';
      peer.on('open', () => {
        clearTimeout(timeout);
        this.code = code;
        this.gs = createGameServer();
        this.localP = this.gs.connect(s => { try { this.onMessage(JSON.parse(s)); } catch (e) { console.error(e); } });   // o próprio anfitrião entra por "loopback"
        this.tx = { send: s => this.gs.message(this.localP, s) };
        this.send({ t: 'hello', name: this.name });
        this.send({ t: 'create', settings, code });
      });
      peer.on('connection', conn => this.acceptGuest(conn));
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
      peer.on('error', err => {
        if (err.type === 'unavailable-id') { peer.destroy(); open(); return; }
        clearTimeout(timeout); this.fail('Erro de conexão: ' + err.type);
      });
    };
    open();
  },
  acceptGuest(conn) {
    let p = null;
    conn.on('open', () => { p = this.gs.connect(s => { try { conn.send(s); } catch (e) { /* convidado saiu */ } }, () => { try { conn.close(); } catch (e) { /* ignore */ } }); });
    conn.on('data', d => { if (p && typeof d === 'string') this.gs.message(p, d); });
    conn.on('close', () => { if (p) { this.gs.disconnect(p); p = null; } });
    conn.on('error', () => {});
  },

  /** P2P — CONVIDADO: conecta ao navegador do anfitrião pelo código */
  async startJoin(code) {
    this.err(''); this.name = this.myName(); this.cleanup(); this.connecting = true; this.render();
    try { await this.loadPeer(); } catch (e) { return this.fail('Não foi possível carregar a biblioteca de conexão.'); }
    const timeout = setTimeout(() => { if (!this.ok) this.fail('Não foi possível chegar ao anfitrião (ele está com a página aberta? redes móveis rígidas podem bloquear P2P).'); }, 25000);
    const peer = new Peer(undefined, PEER_OPTS);
    this.peer = peer; this.kind = 'peer'; this.joinCode = code;
    peer.on('open', () => {
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      this.conn = conn;
      conn.on('open', () => {
        this.tx = { send: s => { try { conn.send(s); } catch (e) { /* fechou */ } } };
        this.send({ t: 'hello', name: this.name });
        this.send({ t: 'join', code, pass: this.joinPass || '' });
      });
      conn.on('data', d => { try { this.onMessage(JSON.parse(d)); } catch (e) { console.error(e); } });
      conn.on('close', () => { clearTimeout(timeout); this.onClosed(); });
      conn.on('error', () => {});
    });
    peer.on('error', err => {
      clearTimeout(timeout);
      this.fail(err.type === 'peer-unavailable' ? 'Sala não encontrada. Confira o código (o anfitrião precisa estar com o jogo aberto).' : 'Erro de conexão: ' + err.type);
    });
  },

  /** conexão encerrada (anfitrião saiu, rede caiu...) */
  onClosed() {
    const wasOk = this.ok;
    this.cleanup();
    if (this.inMatch) { this.inMatch = false; Battle.stop(); Touch.show(false); UI.hideOverlay(); document.getElementById('online-hud').classList.add('hidden'); UI.show('online'); }
    this.render();
    if (this.kickedMsg) { this.err(this.kickedMsg); this.kickedMsg = ''; }
    else if (wasOk) this.err('A conexão com a sala foi encerrada (o anfitrião saiu ou a rede caiu).');
  },

  copyLink() {
    const link = location.origin + location.pathname + '?sala=' + (this.room ? this.room.code : this.code);
    const done = () => UI.banner('LINK COPIADO', 'Envie aos amigos');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, () => prompt('Copie o link:', link));
    else prompt('Copie o link:', link);
  },

  /** servidor dedicado (opcional) por WebSocket */
  connect() {
    const $ = id => document.getElementById(id);
    this.name = this.myName();
    let url = $('on-url').value.trim();
    if (!url) return this.err('Informe o endereço do servidor (ex.: wss://meu-servidor.onrender.com).');
    if (!/^wss?:\/\//.test(url)) url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + url;
    if (location.protocol === 'https:' && url.startsWith('ws://') && !/^ws:\/\/(localhost|127\.)/.test(url)) return this.err('Esta página usa HTTPS: o servidor precisa ser wss:// (seguro).');
    this.err(''); this.cleanup(); this.url = url; this.connecting = true; this.render();
    let ws;
    try { ws = new WebSocket(url); } catch (e) { this.connecting = false; this.render(); return this.err('Endereço inválido.'); }
    this.ws = ws; this.kind = 'ws';
    const timeout = setTimeout(() => { if (!this.ok) { try { ws.close(); } catch (e) { /* ignore */ } this.fail('Tempo esgotado: o servidor não respondeu.'); } }, 20000);
    ws.onopen = () => { this.tx = { send: s => ws.send(s) }; this.send({ t: 'hello', name: this.name }); };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } this.onMessage(m); };
    ws.onclose = () => { clearTimeout(timeout); const was = this.ok; this.connecting = false; this.onClosed(); if (!was && !document.getElementById('on-error').textContent) this.err('Não foi possível conectar ao servidor.'); };
    ws.onerror = () => {};
  },
  disconnect() { this.cleanup(); this.render(); },
  send(o) { if (this.tx) this.tx.send(JSON.stringify(o)); },
  sendDesign() { this.designOk = false; this.designMsg = ''; this.send({ t: 'design', design: Builder.getDesign() }); },

  /* ----------------------------------------------------------------- mensagens */
  onMessage(m) {
    switch (m.t) {
      case 'welcome':
        this.ok = true; this.connecting = false; this.id = m.id; this.name = m.name;
        Meta.name = m.name; if (this.kind === 'ws') Meta.server = this.url; Meta.save();
        this.err(m.version !== VERSION ? 'Aviso: servidor v' + m.version + ' e jogo v' + VERSION + ' (versões diferentes).' : '');
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.send({ t: 'p', c: Date.now() }), 2000);
        this.send({ t: 'p', c: Date.now() });
        if (this.kind === 'ws') this.send({ t: 'rooms' });
        this.render();
        break;
      case 'po': this.pingMs = Date.now() - m.c; document.getElementById('on-status').textContent = '● conectado · ' + this.pingMs + ' ms'; document.getElementById('net-ping').textContent = this.pingMs + ' ms'; break;
      case 'rooms': this.renderRooms(m.list); break;
      case 'error': this.err(m.msg); this.connecting = false; if (m.needPass) document.getElementById('on-pass').focus(); if (this.inMatch) UI.banner('ERRO', m.msg); else this.render(); break;
      case 'joined': this.err(''); this.connecting = false; this.designOk = false; this.designMsg = ''; this.sendDesign(); break;
      case 'room':
        this.room = m.room; this.connecting = false;
        if (this.inMatch && this.cfg) { this.cfg.settings = m.room.settings; Battle.applyRules(m.room.settings); this.renderScore(); document.getElementById('host-btn').classList.toggle('hidden', !this.isHost()); }
        this.render();
        break;
      case 'paused': Battle.hostPaused = !!m.v; this.paused = !!m.v; if (this.inMatch) this.notice(m.v ? '⏸ Partida pausada pelo anfitrião' : ''); break;
      case 'say': UI.banner('📢 ' + (m.from || 'Anfitrião'), m.text); if (this.inMatch) this.addFeed('📢 ' + m.text, 'mine'); break;
      case 'kicked': this.kickedMsg = m.ban ? 'Você foi banido da sala pelo anfitrião.' : 'Você foi expulso da sala pelo anfitrião.'; break;
      case 'left':
        if (m.self) { this.room = null; if (this.kind === 'ws') this.send({ t: 'rooms' }); this.render(); }
        else if (this.inMatch) { const s = Battle.shipById(m.id); if (s && s !== Battle.player) { s.dead = true; Battle.ships = Battle.ships.filter(q => q !== s); } }
        break;
      case 'designOk': this.designOk = true; this.designMsg = ''; this.err(''); if (this.room) this.renderLobby(); break;
      case 'designErr': this.designOk = false; this.designMsg = m.msg; if (this.room) this.renderLobby(); break;
      case 'start': this.beginMatch(m); break;
      case 'snap': if (this.inMatch) { const s = Battle.shipById(m.id); if (s && s.remote) s.applySnap(m); } break;
      case 'shot': if (this.inMatch) Battle.addNetShot(m); break;
      case 'hit': if (this.inMatch) Battle.netHit(m); break;
      case 'died': this.onDied(m); break;
      case 'spawn':
        if (!this.inMatch) break;
        if (m.id === this.id) { Battle.respawnMe(m.x, m.y, m.a); this.noticeT = 0; this.notice(''); }
        else if (Battle.localIds.has(m.id)) Battle.respawnBot(m.id, m.x, m.y, m.a);
        else Battle.remoteSpawn(m.id, m.x, m.y, m.a);
        break;
      case 'score':
        this.scores = m.list; this.teams = m.teams; this.left = m.left;
        if (m.obj) { this.objState = m.obj.mode === 'zone' ? { mode: 'zone', z: m.obj.z.map(a => ({ cap: a[0], owner: a[1], contested: !!a[2] })), sc: m.obj.sc, lim: m.obj.lim } : m.obj; Battle.objState = this.objState; }
        this.renderScore(); break;
      case 'end': this.onEnd(m); break;
    }
  },

  /* -------------------------------------------------------------------- partida */
  beginMatch(m) {
    const me = m.players.find(p => p.id === m.you);
    if (!me) return;
    this.inMatch = true; this.objState = null; this.cfg = { me, players: m.players, spawns: m.spawns, spawn: m.spawns[m.you], settings: m.settings, map: m.map || { seed: 1, env: 'oceano', level: 0 } };
    this.scores = []; this.teams = {}; this.left = m.endsAt ? Math.round((m.endsAt - Date.now()) / 1000) : -1; this.feed = []; this.snapT = 0; this.snapN = 0;
    UI.hideOverlay(); UI.show('battle'); Touch.show(true);
    document.getElementById('online-hud').classList.remove('hidden');
    this.notice(''); document.getElementById('feed').innerHTML = ''; this.paused = false;
    document.getElementById('host-btn').classList.toggle('hidden', !this.isHost());
    Battle.startOnline(this.cfg);
    const md = m.settings.mode, tm = m.settings.minutes ? ' · ' + m.settings.minutes + ' min' : '';
    if (md === 'zone') UI.banner('CONTROLE DE ZONA', 'Segure as zonas · primeiro a ' + m.settings.scoreLimit + ' pontos' + tm);
    else if (md === 'convoy') UI.banner('COMBOIO', (me.team === 'A' ? 'Equipe A: escolte o cargueiro até o destino' : 'Equipe B: afunde o cargueiro (ele renasce)') + tm);
    else UI.banner(md === 'teams' ? 'EQUIPES' : 'TODOS CONTRA TODOS', 'Primeiro a ' + m.settings.killLimit + ' abates' + tm + ' · ' + (BIOMES[m.map.env] || BIOMES.oceano).name);
    this.renderScore();
  },

  /** chamado todo quadro: manda o retrato do navio local ~20 vezes por segundo */
  tick(dt, pl) {
    this.snapT += dt;
    if (this.noticeT > 0) { this.noticeT -= dt; if (this.noticeT > 0) this.notice('Afundado! Reaparecendo em ' + Math.ceil(this.noticeT) + ' s…'); }
    if (this.snapT < 0.05) return;
    this.snapT = 0; this.snapN++;
    if (!pl.sinking && !pl.dead) this.send(this.buildSnap(pl));
    for (const b of Battle.localBots()) if (!b.sinking) { const m = this.buildSnap(b); m.as = b.id; this.send(m); }   // bots que eu hospedo
  },

  /** retrato de um navio que eu controlo (jogador ou bot) */
  buildSnap(pl) {
    const m = { t: 'snap', x: +pl.x.toFixed(1), y: +pl.y.toFixed(1), a: +pl.ang.toFixed(3), vx: +pl.vx.toFixed(1), vy: +pl.vy.toFixed(1),
      fl: +pl.flame.toFixed(2), sh: +pl.shield.toFixed(1), v: pl.vision, sp: pl.sonar, pr: pl.pingR, sg: +pl.sig.toFixed(3),
      dp: +pl.depth.toFixed(2), qt: +pl.quiet.toFixed(2), wt: +pl.wet.toFixed(2) };
    const fi = [];
    pl.order.forEach((k, i) => { const cell = pl.cells.get(k); if (cell && cell.fire > 0) fi.push(i); });
    if (fi.length) m.fi = fi;
    const dr = Battle.drones.filter(d => d.owner === pl && !d.dead).map(d => [Math.round(d.x), Math.round(d.y), +d.ang.toFixed(2), d.kind, +d.hp.toFixed(1), d.vision]);
    if (dr.length) m.dr = dr;
    if (this.snapN % 4 === 1) {
      const c = [];
      for (const k of pl.order) { const cell = pl.cells.get(k); if (!cell) c.push(-1, -1); else c.push(+cell.hp.toFixed(1), cell.top ? +cell.top.hp.toFixed(1) : -1); }
      m.c = c;
    }
    if (this.snapN % 2 === 0) {
      const tp = [];
      for (const k of pl.order) { const cell = pl.cells.get(k); tp.push(cell && cell.top ? +cell.top.ang.toFixed(2) : 0); }
      m.tp = tp;
    }
    return m;
  },

  /** texto do objetivo no HUD (zonas / comboio) */
  objText() {
    const o = this.objState, me = Battle.player ? Battle.player.team : '';
    if (!o) return '';
    if (o.mode === 'zone') { const mine = o.sc[me] || 0, foe = o.sc[me === 'A' ? 'B' : 'A'] || 0; return '🏁 Zonas · sua equipe ' + mine + ' × ' + foe + ' · meta ' + o.lim; }
    return '🚢 Comboio ' + Math.round((o.prog || 0) * 100) + '% · ❤ ' + o.lives + (o.alive ? '' : ' · cargueiro afundado');
  },

  sendShot(s, as) {
    this.send({ t: 'shot', as: as || undefined, lk: s.lock || '', sz: s.size || '', gx: Math.round(s.gx || 0), gy: Math.round(s.gy || 0), kind: s.kind, id: s.id, x: +s.x.toFixed(1), y: +s.y.toFixed(1), vx: +(s.vx || 0).toFixed(1), vy: +(s.vy || 0).toFixed(1),
      life: +s.life.toFixed(2), dmg: s.dmg, pierce: s.pierce || 0, big: !!s.big, splash: s.splash || 0, turn: s.turn || 0, ang: s.ang || 0, speed: s.speed || 0,
      tx: s.tx || 0, ty: s.ty || 0, T: s.T || 0, x0: s.x0 || 0, y0: s.y0 || 0, fuse: s.fuse || 0, dmgSurf: s.dmgSurf || 0, arm: s.arm || 0, tg: s.target ? s.target.id : '' });
  },
  sendDied(by, as) { this.send({ t: 'died', by: by || '', as: as || undefined }); },
  localDead() { const s = (this.cfg && this.cfg.settings.respawn) || 5; this.noticeT = s; this.notice('Afundado! Reaparecendo em ' + s + ' s…'); },
  notice(t) { const e = document.getElementById('on-notice'); e.textContent = t; e.classList.toggle('hidden', !t); },

  nameOf(id) { const p = this.cfg && this.cfg.players.find(q => q.id === id); return p ? p.name : '?'; },
  onDied(m) {
    if (!this.inMatch) return;
    this.scores = m.list; this.teams = m.teams; this.renderScore();
    const victim = Battle.shipById(m.id);
    if (victim && victim.remote && !victim.sinking) victim.sink();
    const txt = m.by ? `${this.nameOf(m.by)} afundou ${this.nameOf(m.id)}` : `${this.nameOf(m.id)} afundou`;
    this.addFeed('☠ ' + txt, m.by === this.id ? 'mine' : m.id === this.id ? 'lost' : '');
  },
  addFeed(text, cls) {
    const el = document.createElement('div');
    el.className = 'feed-row' + (cls ? ' ' + cls : ''); el.textContent = text;
    const f = document.getElementById('feed'); f.appendChild(el);
    setTimeout(() => el.remove(), 7000);
    while (f.children.length > 5) f.firstChild.remove();
  },

  /** painel de controles do anfitrião durante a partida */
  openHostPanel() {
    if (!this.isHost() || !this.cfg || !this.inMatch) return;
    const S = this.cfg.settings, humans = (this.room ? this.room.players : this.cfg.players), me = this.id;
    const opts = (list, cur, fmt) => list.map(v => `<option value="${v}" ${+v === +cur ? 'selected' : ''}>${fmt ? fmt(v) : v}</option>`).join('');
    UI.overlay({
      title: '👑 Painel do anfitrião',
      html: `<div class="hp-row">
          <button class="btn" id="hp-pause">${this.paused ? '▶ Continuar' : '⏸ Pausar'}</button>
          <button class="btn" id="hp-time">＋5 min</button>
          <button class="btn danger" id="hp-end">⏹ Encerrar partida</button></div>
        <h3>Ajustes ao vivo</h3>
        <div class="hp-row">
          <label>Abates p/ vencer <select id="hp-kills">${opts([5, 10, 15, 20, 30, 50], S.killLimit)}</select></label>
          <label>Reaparecer em <select id="hp-resp">${opts([1, 3, 5, 8, 12, 15], S.respawn, v => v + ' s')}</select></label>
          ${S.mode !== 'ffa' ? `<label class="check"><input type="checkbox" id="hp-ff" ${S.ff ? 'checked' : ''}> Fogo amigo</label>` : ''}</div>
        <h3>Anunciar a todos</h3>
        <div class="hp-row"><input type="text" id="hp-say" maxlength="90" placeholder="mensagem"><button class="btn" id="hp-send">Enviar</button></div>
        <h3>Jogadores</h3>
        ${humans.map(p => `<div class="hp-pl"><span>${esc(p.name)}${p.id === me ? ' (você)' : ''}</span>${
          p.bot ? `<button class="x-btn" data-hp-rm="${p.id}">remover</button>`
            : p.id !== me ? `<button class="x-btn" data-hp-kick="${p.id}">expulsar</button><button class="x-btn" data-hp-ban="${p.id}">banir</button>` : ''}</div>`).join('')}`,
      buttons: [{ label: 'Fechar', primary: true, onClick: () => UI.hideOverlay() }],
    });
    const box = document.querySelector('#overlay .card'); box.classList.add('host');
    const $ = id => document.getElementById(id);
    $('hp-pause').onclick = () => { this.send({ t: 'pause', v: !this.paused }); UI.hideOverlay(); };
    $('hp-time').onclick = () => this.send({ t: 'addTime', min: 5 });
    $('hp-end').onclick = () => { if (confirm('Encerrar a partida para todos?')) { UI.hideOverlay(); this.send({ t: 'endNow' }); } };
    const live = () => this.send({ t: 'live', settings: { killLimit: +$('hp-kills').value, respawn: +$('hp-resp').value, ff: $('hp-ff') ? $('hp-ff').checked : false } });
    $('hp-kills').onchange = live; $('hp-resp').onchange = live; if ($('hp-ff')) $('hp-ff').onchange = live;
    $('hp-send').onclick = () => { const t = $('hp-say').value.trim(); if (t) { this.send({ t: 'say', text: t }); $('hp-say').value = ''; } };
    box.querySelectorAll('[data-hp-rm]').forEach(b => b.onclick = () => { this.send({ t: 'removeBot', id: b.dataset.hpRm }); b.parentElement.remove(); });
    box.querySelectorAll('[data-hp-kick]').forEach(b => b.onclick = () => { this.send({ t: 'kick', id: b.dataset.hpKick }); b.parentElement.remove(); });
    box.querySelectorAll('[data-hp-ban]').forEach(b => b.onclick = () => { if (confirm('Banir este jogador?')) { this.send({ t: 'kick', id: b.dataset.hpBan, ban: true }); b.parentElement.remove(); } });
  },

  renderScore() {
    const el = document.getElementById('scoreboard');
    if (!el || !this.cfg) return;
    const mm = this.left >= 0 ? `${Math.floor(this.left / 60)}:${String(this.left % 60).padStart(2, '0')}` : '∞';
    const teams = this.cfg.settings.mode !== 'ffa' ? Object.keys(this.teams).sort().map(t => `<span class="team t${t}">${t}: ${this.teams[t]}</span>`).join(' ') : '';
    const list = this.scores.length ? this.scores : this.cfg.players.map(p => ({ id: p.id, name: p.name, team: p.team, kills: 0, deaths: 0 }));
    el.innerHTML = `<div class="sb-head"><span>⏱ ${mm}</span><span>${this.cfg.settings.mode === 'zone' || this.cfg.settings.mode === 'convoy' ? '' : 'até ' + this.cfg.settings.killLimit}</span>${teams}</div>` +
      list.map(p => `<div class="sb-row ${p.id === this.id ? 'me' : ''}"><span class="n">${this.cfg.settings.mode !== 'ffa' ? `<i class="dot t${p.team}"></i>` : ''}${esc(p.name)}</span><b>${p.kills}</b><small>/${p.deaths}</small></div>`).join('');
  },

  onEnd(m) {
    if (!this.inMatch) return;
    this.inMatch = false; Battle.state = 'over'; this.notice('');
    const mine = m.ranking.findIndex(p => p.id === this.id) + 1;
    const rows = m.ranking.map((p, i) => `<tr class="${p.id === this.id ? 'me' : ''}"><td>${i + 1}º</td><td>${esc(p.name)}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`).join('');
    const teams = Object.keys(m.teams || {}).length ? '<p>' + Object.keys(m.teams).sort().map(t => `Equipe ${t}: <b>${m.teams[t]}</b>`).join(' · ') + '</p>' : '';
    UI.overlay({
      title: m.reason || 'Fim da partida',
      html: `${teams}<table class="rank"><tr><th></th><th>Jogador</th><th>Abates</th><th>Mortes</th></tr>${rows}</table><p class="muted">Você ficou em ${mine}º lugar.</p>`,
      buttons: [{ label: 'Voltar à sala', primary: true, onClick: () => this.backToLobby() }],
    });
  },
  backToLobby() {
    Battle.stop(); Touch.show(false); UI.hideOverlay(); document.getElementById('online-hud').classList.add('hidden');
    this.inMatch = false; this.sendDesign(); UI.show('online'); this.render();
  },
  leaveToMenu() {
    const host = this.kind === 'host';
    if (this.kind === 'ws') this.send({ t: 'leave' }); else this.cleanup();            // sair do P2P = fechar a conexão (anfitrião encerra a sala)
    Battle.stop(); Touch.show(false); UI.hideOverlay(); document.getElementById('online-hud').classList.add('hidden');
    this.inMatch = false; this.room = null; UI.show('online'); this.render();
    if (host) this.err('Você encerrou a sala (era o anfitrião).');
  },
};

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
