'use strict';
/* =====================================================================
   MODO ONLINE (cliente): conexão WebSocket, lobby, retratos do navio,
   tiros pela rede, placar. O servidor está em server/server.js.
   ===================================================================== */
const Online = {
  ws: null, ok: false, connecting: false, id: null, name: '', room: null, url: '',
  pingMs: 0, cfg: null, inMatch: false, designOk: false, designMsg: '',
  snapT: 0, snapN: 0, scores: [], teams: {}, left: -1, feed: [], noticeT: 0, pingTimer: null,

  /* ------------------------------------------------------------ endereço padrão */
  defaultUrl() {
    if (window.BN_CONFIG && BN_CONFIG.serverUrl) return BN_CONFIG.serverUrl;
    if (Meta.server) return Meta.server;
    const h = location.hostname, isLocal = h === 'localhost' || h === '127.0.0.1' || /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(h);
    if (location.protocol === 'file:') return 'ws://localhost:8787';
    if (isLocal) return 'ws://' + h + ':8787';
    if (/github\.io$/.test(h)) return '';                                  // Pages não roda servidor: informe o endereço
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;   // servidor hospeda o jogo
  },

  /* ----------------------------------------------------------------- interface */
  init() {
    const $ = id => document.getElementById(id);
    $('on-name').value = Meta.name || ('Capitão' + (1000 + ((Math.random() * 9000) | 0)));
    $('on-url').value = this.defaultUrl();
    $('on-back').onclick = () => { UI.show('yard'); };
    $('on-connect-btn').onclick = () => this.connect();
    $('on-disconnect').onclick = () => this.disconnect();
    $('on-create').onclick = () => this.send({ t: 'create', settings: this.formSettings('cr') });
    $('on-join').onclick = () => this.send({ t: 'join', code: $('on-code').value });
    $('on-code').onkeydown = e => { if (e.key === 'Enter') $('on-join').click(); };
    $('on-refresh').onclick = () => this.send({ t: 'rooms' });
    $('on-edit-ship').onclick = () => UI.show('yard');
    $('on-send-ship').onclick = () => this.sendDesign();
    $('on-ready').onclick = () => { const me = this.me(); this.send({ t: 'ready', v: !(me && me.ready) }); };
    $('on-start').onclick = () => this.send({ t: 'start' });
    $('on-leave').onclick = () => this.send({ t: 'leave' });
    for (const id of ['lb-mode', 'lb-budget', 'lb-kills', 'lb-min']) $(id).onchange = () => this.send({ t: 'settings', settings: this.formSettings('lb') });
    this.render();
  },
  formSettings(p) {
    const $ = id => document.getElementById(p + '-' + id);
    return { mode: $('mode').value, budget: +$('budget').value, killLimit: +$('kills').value, minutes: +$('min').value };
  },
  me() { return this.room ? this.room.players.find(p => p.id === this.id) : null; },
  isHost() { return !!(this.room && this.room.host === this.id); },
  err(msg) { const e = document.getElementById('on-error'); e.textContent = msg || ''; e.classList.toggle('hidden', !msg); },

  show() {
    UI.show('online');
    document.getElementById('on-url').value = document.getElementById('on-url').value || this.defaultUrl();
    if (this.ok && this.room) this.sendDesign();            // navio pode ter mudado no estaleiro
    else if (this.ok) this.send({ t: 'rooms' });
    this.render();
  },

  render() {
    const $ = id => document.getElementById(id);
    $('on-status').textContent = this.ok ? ('● conectado' + (this.pingMs ? ' · ' + this.pingMs + ' ms' : '')) : this.connecting ? '… conectando' : '○ desconectado';
    $('on-status').className = 'status ' + (this.ok ? 'ok' : '');
    $('on-connect').classList.toggle('hidden', this.ok);
    $('on-conn-info').classList.toggle('hidden', !this.ok);
    $('on-who').textContent = this.name;
    $('on-menu').classList.toggle('hidden', !this.ok || !!this.room);
    $('on-lobby').classList.toggle('hidden', !this.ok || !this.room);
    if (this.room) this.renderLobby();
  },

  renderLobby() {
    const $ = id => document.getElementById(id), r = this.room, host = this.isHost(), me = this.me();
    $('lobby-code').textContent = r.code;
    $('lb-mode').value = r.settings.mode; $('lb-budget').value = r.settings.budget; $('lb-kills').value = r.settings.killLimit; $('lb-min').value = r.settings.minutes;
    for (const id of ['lb-mode', 'lb-budget', 'lb-kills', 'lb-min']) $(id).disabled = !host;
    $('lobby-players').innerHTML = r.players.map(p => `<div class="pl-row ${p.id === this.id ? 'me' : ''}">
        <span class="pl-name">${p.id === r.host ? '👑 ' : ''}${esc(p.name)}</span>
        ${r.settings.mode === 'teams' ? `<span class="team t${p.team}">Equipe ${p.team}</span>` : ''}
        <span class="pl-cost">${p.hasDesign ? '🪙 ' + p.cost : 'sem navio'}</span>
        <span class="pl-ready ${p.ready || p.id === r.host ? 'on' : ''}">${p.id === r.host ? 'anfitrião' : p.ready ? 'pronto' : 'aguardando'}</span></div>`).join('');
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
        <b>${x.code}</b> <span>${esc(x.host)}</span> <small>${x.n}/8 · ${x.settings.mode === 'teams' ? 'equipes' : 'todos contra todos'} · 🪙${x.settings.budget || '∞'} · ${x.settings.killLimit} abates</small></button>`).join('')
      : '<p class="muted">Nenhuma sala aberta. Crie a sua!</p>';
    el.querySelectorAll('.room-row').forEach(b => b.onclick = () => this.send({ t: 'join', code: b.dataset.code }));
  },

  /* ------------------------------------------------------------------ conexão */
  connect() {
    const $ = id => document.getElementById(id);
    const name = $('on-name').value.trim().slice(0, 16) || 'Capitão';
    let url = $('on-url').value.trim();
    if (!url) return this.err('Informe o endereço do servidor (ex.: wss://meu-servidor.onrender.com).');
    if (!/^wss?:\/\//.test(url)) url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + url;
    if (location.protocol === 'https:' && url.startsWith('ws://') && !/^ws:\/\/(localhost|127\.)/.test(url)) return this.err('Esta página usa HTTPS: o servidor precisa ser wss:// (seguro).');
    this.err(''); this.name = name; this.url = url; this.connecting = true; this.render();
    let ws;
    try { ws = new WebSocket(url); } catch (e) { this.connecting = false; this.render(); return this.err('Endereço inválido.'); }
    this.ws = ws;
    const timeout = setTimeout(() => { if (!this.ok) { try { ws.close(); } catch (e) { /* ignore */ } this.err('Tempo esgotado: o servidor não respondeu. (Servidores gratuitos podem demorar ~1 min para acordar; tente de novo.)'); } }, 20000);
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', name })); };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } this.onMessage(m); };
    ws.onclose = () => {
      clearTimeout(timeout);
      const wasOk = this.ok;
      this.ok = false; this.connecting = false; this.room = null; this.id = null; clearInterval(this.pingTimer);
      if (this.inMatch) { this.inMatch = false; Battle.stop(); Touch.show(false); UI.hideOverlay(); document.getElementById('online-hud').classList.add('hidden'); UI.show('online'); }
      this.render();
      if (!wasOk && !document.getElementById('on-error').textContent) this.err('Não foi possível conectar. Confira o endereço e se o servidor está no ar.');
      else if (wasOk) this.err('Conexão perdida.');
    };
    ws.onerror = () => {};
  },
  disconnect() { if (this.ws) try { this.ws.close(); } catch (e) { /* ignore */ } },
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); },
  sendDesign() { this.designOk = false; this.designMsg = ''; this.send({ t: 'design', design: Builder.getDesign() }); },

  /* ----------------------------------------------------------------- mensagens */
  onMessage(m) {
    switch (m.t) {
      case 'welcome':
        this.ok = true; this.connecting = false; this.id = m.id; this.name = m.name;
        Meta.name = m.name; Meta.server = this.url; Meta.save();
        this.err(m.version !== VERSION ? 'Aviso: servidor v' + m.version + ' e jogo v' + VERSION + ' (versões diferentes).' : '');
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.send({ t: 'p', c: Date.now() }), 2000);
        this.send({ t: 'p', c: Date.now() });
        this.send({ t: 'rooms' }); this.render();
        break;
      case 'po': this.pingMs = Date.now() - m.c; document.getElementById('on-status').textContent = '● conectado · ' + this.pingMs + ' ms'; document.getElementById('net-ping').textContent = this.pingMs + ' ms'; break;
      case 'rooms': this.renderRooms(m.list); break;
      case 'error': this.err(m.msg); if (this.inMatch) UI.banner('ERRO', m.msg); break;
      case 'joined': this.err(''); this.designOk = false; this.designMsg = ''; this.sendDesign(); break;
      case 'room': this.room = m.room; this.render(); break;
      case 'left':
        if (m.self) { this.room = null; this.send({ t: 'rooms' }); this.render(); }
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
        if (m.id === this.id) { Battle.respawnMe(m.x, m.y, m.a); this.noticeT = 0; this.notice(''); } else Battle.remoteSpawn(m.id, m.x, m.y, m.a);
        break;
      case 'score': this.scores = m.list; this.teams = m.teams; this.left = m.left; this.renderScore(); break;
      case 'end': this.onEnd(m); break;
    }
  },

  /* -------------------------------------------------------------------- partida */
  beginMatch(m) {
    const me = m.players.find(p => p.id === m.you);
    if (!me) return;
    this.inMatch = true; this.cfg = { me, players: m.players, spawns: m.spawns, spawn: m.spawns[m.you], settings: m.settings };
    this.scores = []; this.teams = {}; this.left = m.endsAt ? Math.round((m.endsAt - Date.now()) / 1000) : -1; this.feed = []; this.snapT = 0; this.snapN = 0;
    UI.hideOverlay(); UI.show('battle'); Touch.show(true);
    document.getElementById('online-hud').classList.remove('hidden');
    this.notice(''); document.getElementById('feed').innerHTML = '';
    Battle.startOnline(this.cfg);
    UI.banner(m.settings.mode === 'teams' ? 'EQUIPES' : 'TODOS CONTRA TODOS', 'Primeiro a ' + m.settings.killLimit + ' abates' + (m.settings.minutes ? ' · ' + m.settings.minutes + ' min' : ''));
    this.renderScore();
  },

  /** chamado todo quadro: manda o retrato do navio local ~20 vezes por segundo */
  tick(dt, pl) {
    this.snapT += dt;
    if (this.noticeT > 0) { this.noticeT -= dt; if (this.noticeT > 0) this.notice('Afundado! Reaparecendo em ' + Math.ceil(this.noticeT) + ' s…'); }
    if (this.snapT < 0.05 || pl.sinking || pl.dead) return;
    this.snapT = 0; this.snapN++;
    const m = { t: 'snap', x: +pl.x.toFixed(1), y: +pl.y.toFixed(1), a: +pl.ang.toFixed(3), vx: +pl.vx.toFixed(1), vy: +pl.vy.toFixed(1),
      fl: +pl.flame.toFixed(2), sh: +pl.shield.toFixed(1), v: pl.vision, sp: pl.sonar, pr: pl.pingR, sg: +pl.sig.toFixed(3) };
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
    this.send(m);
  },

  sendShot(s) {
    this.send({ t: 'shot', kind: s.kind, id: s.id, x: +s.x.toFixed(1), y: +s.y.toFixed(1), vx: +(s.vx || 0).toFixed(1), vy: +(s.vy || 0).toFixed(1),
      life: +s.life.toFixed(2), dmg: s.dmg, pierce: s.pierce || 0, big: !!s.big, splash: s.splash || 0, turn: s.turn || 0, ang: s.ang || 0, speed: s.speed || 0,
      tx: s.tx || 0, ty: s.ty || 0, T: s.T || 0, x0: s.x0 || 0, y0: s.y0 || 0, tg: s.target ? s.target.id : '' });
  },
  sendDied(by) { this.send({ t: 'died', by: by || '' }); },
  localDead() { this.noticeT = 5; this.notice('Afundado! Reaparecendo em 5 s…'); },
  notice(t) { const e = document.getElementById('on-notice'); e.textContent = t; e.classList.toggle('hidden', !t); },

  nameOf(id) { const p = this.cfg && this.cfg.players.find(q => q.id === id); return p ? p.name : '?'; },
  onDied(m) {
    if (!this.inMatch) return;
    this.scores = m.list; this.teams = m.teams; this.renderScore();
    const victim = Battle.shipById(m.id);
    if (victim && victim.remote && !victim.sinking) victim.sink();
    const txt = m.by ? `${this.nameOf(m.by)} afundou ${this.nameOf(m.id)}` : `${this.nameOf(m.id)} afundou`;
    const el = document.createElement('div');
    el.className = 'feed-row' + (m.by === this.id ? ' mine' : m.id === this.id ? ' lost' : '');
    el.textContent = '☠ ' + txt; document.getElementById('feed').appendChild(el);
    setTimeout(() => el.remove(), 7000);
    while (document.getElementById('feed').children.length > 5) document.getElementById('feed').firstChild.remove();
  },

  renderScore() {
    const el = document.getElementById('scoreboard');
    if (!el || !this.cfg) return;
    const mm = this.left >= 0 ? `${Math.floor(this.left / 60)}:${String(this.left % 60).padStart(2, '0')}` : '∞';
    const teams = this.cfg.settings.mode === 'teams' ? Object.keys(this.teams).sort().map(t => `<span class="team t${t}">${t}: ${this.teams[t]}</span>`).join(' ') : '';
    const list = this.scores.length ? this.scores : this.cfg.players.map(p => ({ id: p.id, name: p.name, team: p.team, kills: 0, deaths: 0 }));
    el.innerHTML = `<div class="sb-head"><span>⏱ ${mm}</span><span>até ${this.cfg.settings.killLimit}</span>${teams}</div>` +
      list.map(p => `<div class="sb-row ${p.id === this.id ? 'me' : ''}"><span class="n">${this.cfg.settings.mode === 'teams' ? `<i class="dot t${p.team}"></i>` : ''}${esc(p.name)}</span><b>${p.kills}</b><small>/${p.deaths}</small></div>`).join('');
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
    this.send({ t: 'leave' });
    Battle.stop(); Touch.show(false); UI.hideOverlay(); document.getElementById('online-hud').classList.add('hidden');
    this.inMatch = false; this.room = null; UI.show('online'); this.render();
  },
};

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
