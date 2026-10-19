'use strict';
/* =====================================================================
   BATALHA: física, dano por peça, IA, partículas e render
   Mundo em pixels. Ângulo 0 = proa para cima (norte), positivo = horário.
   ===================================================================== */
const CS = 22;                 // tamanho da célula na batalha
const WORLD = 3600, HALF = WORLD / 2;

const rand = (a, b) => a + Math.random() * (b - a);
const dirOf = a => [Math.sin(a), -Math.cos(a)];
function turnToward(cur, target, step) {
  const d = angDiff(target, cur);
  return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
}

/* ------------------------------------------------------------------ SOM */
const SFX = {
  ac: null, buf: null, muted: false, last: {},
  init() {
    if (!this.ac) {
      try {
        this.ac = new (window.AudioContext || window.webkitAudioContext)();
        const n = this.ac.sampleRate;
        this.buf = this.ac.createBuffer(1, n, n);
        const d = this.buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { this.ac = null; }
    }
    if (this.ac && this.ac.state === 'suspended') this.ac.resume();
  },
  noise(dur, freq, vol, type = 'lowpass') {
    const ac = this.ac, t = ac.currentTime;
    const src = ac.createBufferSource(); src.buffer = this.buf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(ac.destination);
    src.start(t, Math.random() * 0.05); src.stop(t + dur);
  },
  tone(f0, f1, dur, vol, type = 'sine') {
    const ac = this.ac, t = ac.currentTime;
    const o = ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur);
  },
  play(name, x, y) {
    if (!this.ac || this.muted) return;
    const now = performance.now(), gap = { cannon: 40, mg: 70, boom: 70, hit: 45, torp: 100 }[name] || 50;
    if (now - (this.last[name] || 0) < gap) return;
    this.last[name] = now;
    let v = 1;
    if (x !== undefined) v = clamp(1 - Math.hypot(x - Battle.cam.x, y - Battle.cam.y) / 1300, 0.04, 1);
    switch (name) {
      case 'cannon': this.noise(0.25, 700, 0.5 * v); this.tone(130, 40, 0.2, 0.5 * v); break;
      case 'mg': this.noise(0.05, 2800, 0.12 * v, 'bandpass'); break;
      case 'boom': this.noise(0.9, 350, 0.9 * v); this.tone(80, 28, 0.6, 0.6 * v); break;
      case 'hit': this.noise(0.07, 1600, 0.25 * v); break;
      case 'torp': this.tone(260, 90, 0.35, 0.3 * v); this.noise(0.3, 500, 0.2 * v); break;
    }
  },
};

/* ----------------------------------------------------------------- NAVIO */
class Ship {
  constructor(design, team, x, y, ang) {
    this.team = team; this.x = x; this.y = y; this.ang = ang;
    this.vx = 0; this.vy = 0; this.angVel = 0; this.flame = 0;
    this.sinking = false; this.sinkT = 0; this.dead = false;
    this.cells = new Map(); this.order = [];
    this.id = ''; this.remote = false; this.seenT = 0; this.lastAttacker = null;
    this.revealT = 0; this.revealR = 0; this.pingT = 0; this.reveal = false; this.ping = false;
    let sx = 0, sy = 0, n = 0, hp = 0;
    const all = [];
    for (let gy = 0; gy < GRID_H; gy++) for (let gx = 0; gx < GRID_W; gx++) {
      const base = design.hull[gy][gx]; if (!base) continue;
      const P = PARTS[base];
      const cell = { gx, gy, base, hp: P.hp, maxHp: P.hp, flash: 0, top: null, dead: false };
      const tc = design.top[gy][gx];
      if (tc && isHull(base) && !isBridge(base)) {
        const TP = PARTS[tc];
        cell.top = { type: tc, hp: TP.hp, maxHp: TP.hp, cd: rand(0, 0.6), ang, recoil: 0, acc: 0, tgt: null, tt: 0 };
      }
      this.cells.set(gx + ',' + gy, cell); this.order.push(gx + ',' + gy);
      all.push({ base, top: cell.top ? tc : null });
      if (isHull(base)) { sx += gx + 0.5; sy += gy + 0.5; n++; hp += P.hp; }
    }
    this.ox = sx / n; this.oy = sy / n;
    this.initialHull = n; this.maxHullHp = hp;
    this.cost = shipStats(all).cost;
    this.input = { throttle: 0, steer: 0, aimX: x, aimY: y, fireMain: false, fireTorp: false, fireMissile: false };
    this.shield = 0; this.shieldHit = 0; this.shieldFlash = 0; this.label = '';
    this.ai = null; this.reloadMul = 1; this.smokeT = 0; this.wakeT = 0;
    this.ca = Math.cos(ang); this.sa = Math.sin(ang);
    this.refresh();
    this.shield = this.shieldMax;
  }

  refresh() {
    this.list = [...this.cells.values()];
    this.stats = shipStats(this.list.map(c => ({ base: c.base, top: c.top ? c.top.type : null })));
    let r = 0, bow = null, hw = 0, hl = 0, maxR = 0, mgR = 0, flame = false;
    for (const c of this.list) {
      const lx = (c.gx + 0.5 - this.ox) * CS, ly = (c.gy + 0.5 - this.oy) * CS;
      r = Math.max(r, Math.hypot(lx, ly) + CS * 0.75);
      hw = Math.max(hw, Math.abs(lx) + CS * 0.7); hl = Math.max(hl, Math.abs(ly) + CS * 0.7);
      if (isHull(c.base) && (!bow || c.gy < bow.gy)) bow = c;
      if (c.top) {
        const P = PARTS[c.top.type];
        if (P.kind === 'cannon' || P.kind === 'mortar') maxR = Math.max(maxR, P.range);
        if (P.kind === 'mg') { mgR = Math.max(mgR, P.range); if (P.bullet === 'flame') flame = true; }
      }
    }
    this.radius = r; this.bow = bow; this.hw = hw; this.hl = hl;
    this.maxRange = maxR; this.mgRange = mgR;
    this.hasTorp = this.stats.torps > 0;
    this.rammer = !maxR && !this.stats.torps && !this.stats.missiles && flame;
    this.shieldMax = this.stats.shield;
    this.shield = Math.min(this.shield, this.shieldMax);
    // sensores e furtividade (os mesmos campos que detects() lê)
    this.vision = this.stats.vision; this.sonar = this.stats.sonarR; this.pingR = this.stats.pingR;
    this.sig = this.stats.sig; this.cover = this.stats.cover;
  }

  get rl() { return this.reloadMul * this.stats.loadMul; }

  /** denuncia a posição: quem estiver a menos de r percebe este navio por t segundos */
  doReveal(r, t) { this.revealT = Math.max(this.revealT, t); this.revealR = Math.max(this.revealR, r); }

  cellWorld(c) {
    const lx = (c.gx + 0.5 - this.ox) * CS, ly = (c.gy + 0.5 - this.oy) * CS;
    return [this.x + lx * this.ca - ly * this.sa, this.y + lx * this.sa + ly * this.ca];
  }
  cellAt(wx, wy) {
    const dx = wx - this.x, dy = wy - this.y;
    if (dx * dx + dy * dy > this.radius * this.radius) return null;
    const lx = dx * this.ca + dy * this.sa, ly = -dx * this.sa + dy * this.ca;
    return this.cells.get(Math.floor(lx / CS + this.ox) + ',' + Math.floor(ly / CS + this.oy)) || null;
  }

  hullHp() { let s = 0; for (const c of this.list) if (isHull(c.base)) s += c.hp; return s; }

  /** blast = dano de explosão (o casco reativo reduz); soak = redução fixa da blindagem */
  hitCell(c, dmg, blast = false, owner = null) {
    if (this.sinking || c.dead) return;
    c.flash = 0.12;
    if (this.remote) return;                      // navios remotos: só o dono aplica o dano
    if (owner) this.lastAttacker = owner;
    if (this.shield > 0) {
      const a = Math.min(this.shield, dmg);
      this.shield -= a; dmg -= a; this.shieldHit = 3; this.shieldFlash = 0.4;
      if (dmg <= 0) return;
    }
    let lost = false;
    if (c.top) {
      const a = Math.min(c.top.hp, dmg); c.top.hp -= a; dmg -= a;
      if (c.top.hp <= 0) { const [wx, wy] = this.cellWorld(c); Battle.explosion(wx, wy, 0.45); c.top = null; lost = true; }
    }
    if (dmg > 0) {
      const P = PARTS[c.base];
      if (blast && P.blast) dmg *= P.blast;
      dmg = Math.max(dmg * 0.2, dmg - (P.soak || 0));
      c.hp -= dmg;
      if (c.hp <= 0) { this.removeCell(c); lost = true; }
    }
    if (this === Battle.player) Battle.shake = Math.min(1, Battle.shake + 0.08);
    if (lost) this.processStructure();
  }

  removeCell(c) {
    if (c.dead) return;
    c.dead = true; this.cells.delete(c.gx + ',' + c.gy);
    const [wx, wy] = this.cellWorld(c);
    if (c.top) Battle.explosion(wx, wy, 0.4);
    Battle.debris(wx, wy, c.base);
  }

  /** remove peças soltas, aletas sem apoio e afunda se a ponte cair */
  processStructure() {
    if (this.sinking) return;
    let bridge = null;
    for (const c of this.cells.values()) if (isBridge(c.base)) bridge = c;
    if (!bridge) { this.refresh(); this.sink(); return; }
    const seen = new Set([bridge.gx + ',' + bridge.gy]), q = [bridge];
    while (q.length) {
      const c = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = (c.gx + dx) + ',' + (c.gy + dy), n = this.cells.get(k);
        if (n && isHull(n.base) && !seen.has(k)) { seen.add(k); q.push(n); }
      }
    }
    for (const c of [...this.cells.values()]) if (isHull(c.base) && !seen.has(c.gx + ',' + c.gy)) this.removeCell(c);
    for (const c of [...this.cells.values()]) {
      if (!isFin(c.base)) continue;
      const a = c.base === '<' ? [1, 0] : c.base === '>' ? [-1, 0] : [0, -1];
      const n = this.cells.get((c.gx + a[0]) + ',' + (c.gy + a[1]));
      if (!n || !isHull(n.base)) this.removeCell(c);
    }
    this.refresh();
    if (seen.size < this.initialHull * 0.3) this.sink();
  }

  sink() {
    if (this.sinking) return;
    this.sinking = true; this.sinkT = 0;
    this.input.fireMain = this.input.fireTorp = false; this.input.throttle = this.input.steer = 0;
    Battle.onSunk(this);
  }

  update(dt) {
    const st = this.stats, inp = this.input;
    if (this.dead) return;
    if (this.sinking) {
      this.sinkT += dt;
      const k = Math.exp(-0.9 * dt);
      this.vx *= k; this.vy *= k; this.angVel *= k;
      this.x += this.vx * dt; this.y += this.vy * dt; this.ang += this.angVel * dt + 0.15 * dt;
      this.ca = Math.cos(this.ang); this.sa = Math.sin(this.ang);
      this.flame = 0;
      if (Math.random() < dt * 7) {
        const c = this.list[(Math.random() * this.list.length) | 0];
        if (c && !c.dead) { const [wx, wy] = this.cellWorld(c); Battle.explosion(wx, wy, rand(0.6, 1.3)); }
      }
      if (this.sinkT > 2.8) { this.dead = true; Battle.splash(this.x, this.y, 2.5); }
      return;
    }

    /* movimento */
    const fx = Math.sin(this.ang), fy = -Math.cos(this.ang), rx = Math.cos(this.ang), ry = Math.sin(this.ang);
    let vf = this.vx * fx + this.vy * fy, vs = this.vx * rx + this.vy * ry;
    const th = clamp(inp.throttle, -1, 1), thrust = th >= 0 ? th : th * 0.4;
    vf += (st.accel * thrust - 0.25 * vf) * dt;
    vs *= Math.exp(-st.grip * dt);
    this.vx = fx * vf + rx * vs; this.vy = fy * vf + ry * vs;
    const eff = Math.min(1, 0.3 + 0.7 * Math.abs(vf) / (0.45 * Math.max(st.maxSpeed, 60)));
    const target = clamp(inp.steer, -1, 1) * st.turn * eff;
    this.angVel += (target - this.angVel) * Math.min(1, dt * 4);
    this.ang += this.angVel * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    const lim = HALF - 40;
    if (this.x < -lim) { this.x = -lim; this.vx = Math.abs(this.vx) * 0.3; }
    if (this.x > lim) { this.x = lim; this.vx = -Math.abs(this.vx) * 0.3; }
    if (this.y < -lim) { this.y = -lim; this.vy = Math.abs(this.vy) * 0.3; }
    if (this.y > lim) { this.y = lim; this.vy = -Math.abs(this.vy) * 0.3; }
    this.ca = Math.cos(this.ang); this.sa = Math.sin(this.ang);
    this.flame += ((th > 0 && st.engines ? th : 0) - this.flame) * Math.min(1, dt * 6);
    this.speed = Math.hypot(this.vx, this.vy);

    if (this.revealT > 0) this.revealT -= dt;
    if (this.pingT > 0) this.pingT -= dt;
    this.reveal = this.revealT > 0; this.ping = this.pingT > 0;
    if (!this.reveal) this.revealR = 0;

    /* escudo */
    if (this.shieldFlash > 0) this.shieldFlash -= dt;
    this.shieldHit -= dt;
    if (this.shieldMax && this.shieldHit <= 0 && this.shield < this.shieldMax)
      this.shield = Math.min(this.shieldMax, this.shield + this.stats.regen * dt);

    /* peças */
    for (const c of this.list) {
      if (c.dead) continue;
      if (c.flash > 0) c.flash -= dt;
      if (c.top) this.updatePart(c, dt);
    }

    this.emitTrail(dt);
  }

  /** esteira de espuma e fumaça das peças avariadas */
  emitTrail(dt) {
    const fx = Math.sin(this.ang), fy = -Math.cos(this.ang), rx = Math.cos(this.ang), ry = Math.sin(this.ang);
    this.wakeT -= dt;
    if (this.wakeT <= 0 && this.speed > 25) {
      this.wakeT = 0.05;
      for (const c of this.list) {
        if (c.dead || !c.top || PARTS[c.top.type].kind !== 'engine' || this.flame < 0.1) continue;
        const [wx, wy] = this.cellWorld(c);
        Battle.addP({ t: 'foam', x: wx - fx * CS * 0.9 + rand(-4, 4), y: wy - fy * CS * 0.9 + rand(-4, 4), vx: -fx * 25 + rand(-12, 12), vy: -fy * 25 + rand(-12, 12), life: 1.0, s: 5, g: 14, layer: 0, a: 0.9 });
      }
      if (this.bow) {
        const [wx, wy] = this.cellWorld(this.bow), k = Math.min(1, this.speed / 150);
        for (const sg of [-1, 1]) Battle.addP({ t: 'foam', x: wx + fx * CS * 0.4, y: wy + fy * CS * 0.4, vx: rx * sg * 30 * k, vy: ry * sg * 30 * k, life: 0.8, s: 3, g: 9, layer: 0, a: 0.8 * k });
      }
    }
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.12;
      const c = this.list[(Math.random() * this.list.length) | 0];
      if (c && !c.dead) {
        const ratio = c.hp / c.maxHp;
        if (ratio < 0.5 && Math.random() < (1 - ratio)) {
          const [wx, wy] = this.cellWorld(c);
          Battle.addP({ t: 'smoke', x: wx, y: wy, vx: rand(-6, 6), vy: rand(-22, -8), life: rand(1, 1.8), s: 5, g: 9, a: 0.7 });
          if (ratio < 0.25) Battle.addP({ t: 'fire', x: wx, y: wy, vx: rand(-8, 8), vy: rand(-14, -4), life: 0.5, s: 6, g: -6 });
        }
      }
    }
  }

  /** navio de outro jogador: só interpola o que o dono envia pela rede */
  updateRemote(dt) {
    if (this.sinking || this.dead) { this.update(dt); return; }
    if (this.seenT > 0) this.seenT -= dt;
    const n = this.net;
    if (n) {
      n.x += n.vx * dt; n.y += n.vy * dt;
      const k = 1 - Math.exp(-14 * dt);
      this.x += (n.x - this.x) * k; this.y += (n.y - this.y) * k;
      this.ang += angDiff(n.a, this.ang) * k;
      this.vx = n.vx; this.vy = n.vy; this.flame += (n.fl - this.flame) * Math.min(1, dt * 8);
    }
    this.ca = Math.cos(this.ang); this.sa = Math.sin(this.ang);
    this.speed = Math.hypot(this.vx, this.vy);
    for (const c of this.list) if (c.flash > 0) c.flash -= dt;
    if (this.shieldFlash > 0) this.shieldFlash -= dt;
    if (this.seenT > 0) this.emitTrail(dt);
  }

  /** aplica um retrato enviado pelo dono (posição, escudo, sensores, vida das peças, torres) */
  applySnap(m) {
    if (!this.net) { this.x = m.x; this.y = m.y; this.ang = m.a; this.net = { x: m.x, y: m.y, a: m.a, vx: 0, vy: 0, fl: 0 }; }
    const n = this.net;
    n.x = m.x; n.y = m.y; n.a = m.a; n.vx = m.vx; n.vy = m.vy; n.fl = m.fl;
    this.seenT = 0.9;
    if (m.c) this.applyCells(m.c);
    this.shield = Math.min(m.sh, this.shieldMax);
    this.vision = m.v; this.sonar = m.sp; this.pingR = m.pr; this.sig = m.sg;
    this.reveal = !!m.rv; this.revealR = m.rv || 0; this.ping = !!m.pg;
    if (m.tp) {
      let i = 0;
      for (const k of this.order) { const c = this.cells.get(k), a = m.tp[i++]; if (c && c.top && typeof a === 'number') c.top.ang = a; }
    }
  }

  applyCells(arr) {
    let changed = false;
    this.order.forEach((k, i) => {
      const c = this.cells.get(k);
      if (!c) return;
      const hp = arr[2 * i], th = arr[2 * i + 1];
      if (hp < 0) { this.removeCell(c); changed = true; return; }
      c.hp = hp;
      if (c.top) {
        if (th < 0) { const [wx, wy] = this.cellWorld(c); Battle.explosion(wx, wy, 0.4); c.top = null; changed = true; } else c.top.hp = th;
      }
    });
    if (changed) this.refresh();
  }

  /** ponto de mira de uma arma; a IA antecipa o movimento do alvo conforme a velocidade do projétil */
  aimPoint(wx, wy, speed) {
    const inp = this.input;
    let ax = inp.aimX, ay = inp.aimY;
    if (inp.tvx !== undefined) {
      const T = Math.hypot(ax - wx, ay - wy) / speed;
      ax += inp.tvx * T * 0.85; ay += inp.tvy * T * 0.85;
    }
    return [ax, ay];
  }

  updatePart(c, dt) {
    const t = c.top, P = PARTS[t.type], inp = this.input;
    if (t.cd > 0) t.cd -= dt;
    if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt * 5);
    const [wx, wy] = this.cellWorld(c);
    switch (P.kind) {
      case 'cannon': {
        const [ax, ay] = this.aimPoint(wx, wy, P.speed);
        const want = Math.atan2(ax - wx, -(ay - wy));
        t.ang = turnToward(t.ang, want, P.turn * this.stats.turnMul * dt);
        if (inp.fireMain && t.cd <= 0 && Math.abs(angDiff(want, t.ang)) < 0.09) {
          t.cd = P.reload * this.rl; t.recoil = 1;
          const [dx, dy] = dirOf(t.ang), px = -dy, py = dx;
          for (let i = 0; i < P.shots; i++) {
            const off = (i - (P.shots - 1) / 2) * CS * 0.28, a = t.ang + rand(-P.spread, P.spread), [bx, by] = dirOf(a);
            const mx = wx + dx * CS * 0.7 + px * off, my = wy + dy * CS * 0.7 + py * off;
            Battle.shoot({ kind: P.pierce ? 'rail' : 'shell', x: mx, y: my, vx: bx * P.speed + this.vx * 0.5, vy: by * P.speed + this.vy * 0.5,
              life: P.range / P.speed, dmg: P.dmg, team: this.team, owner: this.id, pierce: P.pierce || 0, big: P.dmg > 6 });
            Battle.addP({ t: 'flash', x: mx, y: my, life: 0.09, s: 7 + P.dmg, g: 20 });
          }
          SFX.play('cannon', wx, wy); this.doReveal(900, 1.5);
        }
        break;
      }
      case 'mortar': {
        const [ax, ay] = this.aimPoint(wx, wy, P.speed);
        const want = Math.atan2(ax - wx, -(ay - wy)), dist = Math.hypot(ax - wx, ay - wy);
        t.ang = turnToward(t.ang, want, P.turn * this.stats.turnMul * dt);
        if (inp.fireMain && t.cd <= 0 && Math.abs(angDiff(want, t.ang)) < 0.2) {
          if (this.ai && dist > P.range) break;                    // a IA só dispara ao alcance
          t.cd = P.reload * this.rl; t.recoil = 1;
          const d = clamp(dist, P.minRange, P.range);
          const ux = dist > 1 ? (ax - wx) / dist : Math.sin(t.ang), uy = dist > 1 ? (ay - wy) / dist : -Math.cos(t.ang);
          const sc = rand(0, P.scatter * this.stats.scatterMul), sa = rand(0, TAU);
          const tx = wx + ux * d + Math.cos(sa) * sc, ty = wy + uy * d + Math.sin(sa) * sc, T = d / P.speed;
          Battle.shoot({ kind: 'mortar', x: wx, y: wy, x0: wx, y0: wy, tx, ty, T, life: T, dmg: P.dmg, splash: P.splash, team: this.team, owner: this.id });
          for (let i = 0; i < 4; i++)
            Battle.addP({ t: 'smoke', x: wx + ux * CS * 0.5, y: wy + uy * CS * 0.5, vx: ux * rand(10, 50) + rand(-10, 10), vy: uy * rand(10, 50) + rand(-10, 10), life: rand(0.6, 1.1), s: 5, g: 10, a: 0.7 });
          SFX.play('cannon', wx, wy); this.doReveal(900, 1.5);
        }
        break;
      }
      case 'mg': {
        t.tt -= dt;
        if (t.tt <= 0) { t.tt = 0.25; t.tgt = Battle.nearestEnemy(this, wx, wy, P.range); }
        const tg = t.tgt;
        if (tg && !tg.sinking && !tg.dead) {
          const want = Math.atan2(tg.x - wx, -(tg.y - wy));
          t.ang = turnToward(t.ang, want, P.turn * this.stats.turnMul * dt);
          if (t.cd <= 0 && Math.abs(angDiff(want, t.ang)) < 0.12 && Math.hypot(tg.x - wx, tg.y - wy) < P.range + tg.radius * 0.5) {
            t.cd = P.reload * this.rl; t.recoil = 1;
            const a = t.ang + rand(-P.spread, P.spread), [ax, ay] = dirOf(a);
            const mx = wx + ax * CS * 0.55, my = wy + ay * CS * 0.55;
            Battle.shoot({ kind: P.bullet, x: mx, y: my, vx: ax * P.speed + this.vx * 0.5, vy: ay * P.speed + this.vy * 0.5, life: P.range / P.speed, dmg: P.dmg, team: this.team, owner: this.id });
            if (P.bullet === 'flame') Battle.addP({ t: 'fire', x: mx, y: my, vx: ax * 90, vy: ay * 90, life: 0.25, s: 5, g: 14, drag: 1 });
            else SFX.play('mg', wx, wy);
          }
        } else t.ang = turnToward(t.ang, this.ang, P.turn * this.stats.turnMul * dt);
        break;
      }
      case 'torp':
        if (inp.fireTorp && t.cd <= 0) {
          t.cd = P.reload * this.rl;
          const [dx, dy] = dirOf(this.ang);
          Battle.shoot({ kind: 'torp', x: wx + dx * CS * 0.8, y: wy + dy * CS * 0.8, vx: dx * P.speed + this.vx * 0.3, vy: dy * P.speed + this.vy * 0.3, life: P.range / P.speed, dmg: P.dmg, team: this.team, owner: this.id, splash: P.splash });
          SFX.play('torp', wx, wy); this.doReveal(900, 1.5);
        }
        break;
      case 'missile':
        if (inp.fireMissile && t.cd <= 0) {
          const target = this.team === 'p'
            ? (Battle.nearestEnemy(this, inp.aimX, inp.aimY, 450) || Battle.nearestEnemy(this, this.x, this.y, 1600))
            : Battle.player;
          if (!target) break;
          t.cd = P.reload * this.rl; t.recoil = 1;
          const [dx, dy] = dirOf(this.ang);
          Battle.shoot({ kind: 'missile', x: wx + dx * CS * 0.8, y: wy + dy * CS * 0.8, ang: this.ang, speed: P.speed, vx: dx * P.speed, vy: dy * P.speed,
            life: P.range / P.speed, dmg: P.dmg, splash: P.splash, turn: P.turn, team: this.team, owner: this.id, target });
          SFX.play('torp', wx, wy); this.doReveal(900, 1.5);
        }
        break;
      case 'pd': {
        let best = null, bd = P.range;
        for (const sh of Battle.shots) {
          if (sh.team === this.team || sh.dead || !(sh.kind === 'missile' || sh.kind === 'mortar' || sh.kind === 'torp')) continue;
          const d = Math.hypot(sh.x - wx, sh.y - wy);
          if (d < bd) { bd = d; best = sh; }
        }
        if (best) {
          const want = Math.atan2(best.x - wx, -(best.y - wy));
          t.ang = turnToward(t.ang, want, 9 * dt);
          if (t.cd <= 0 && Math.abs(angDiff(want, t.ang)) < 0.2) {
            t.cd = P.reload; t.recoil = 1;
            Battle.addP({ t: 'tracer', x: wx, y: wy, x2: best.x, y2: best.y, life: 0.09 });
            if (Math.random() < 0.8) { best.dead = true; Battle.explosion(best.x, best.y, 0.35); Battle.onShotGone(best); }
          }
        } else t.ang = turnToward(t.ang, this.ang, 6 * dt);
        break;
      }
      case 'sonarA':
        t.acc += dt;
        if (t.acc >= P.every) {
          t.acc = 0; this.pingT = 2; this.doReveal(2200, 1.6);
          Battle.addP({ t: 'ring', x: wx, y: wy, life: 1.2, s: 10, g: P.range / 1.2, layer: 0, cyan: true });
          Battle.onPing(this);
        }
        break;
      case 'jammer':
        for (const sh of Battle.shots)
          if (sh.kind === 'missile' && sh.team !== this.team && !sh.dead && Math.hypot(sh.x - wx, sh.y - wy) < P.range) sh.jam = 1.5;
        break;
      case 'repair': {
        t.acc += dt;
        if (t.acc >= P.every) {
          t.acc = 0;
          let best = null, br = 1;
          for (const o of this.list) {
            if (o.dead || Math.hypot(o.gx - c.gx, o.gy - c.gy) > P.radius) continue;
            const r = o.hp / o.maxHp;
            if (r < br) { br = r; best = o; }
          }
          if (best) {
            best.hp = Math.min(best.maxHp, best.hp + 1);
            const [bx, by] = this.cellWorld(best);
            Battle.addP({ t: 'plus', x: bx, y: by, vy: -26, life: 0.9, s: 6 });
          } else {
            for (const o of this.list) if (!o.dead && o.top && o.top.hp < o.top.maxHp && Math.hypot(o.gx - c.gx, o.gy - c.gy) <= P.radius) { o.top.hp = Math.min(o.top.maxHp, o.top.hp + 1); break; }
          }
        }
        break;
      }
    }
  }

  draw(ctx, time) {
    let alpha = 1, scale = 1;
    if (this.sinking) { const k = this.sinkT / 2.8; alpha = 1 - k * 0.9; scale = 1 - k * 0.2; }
    const ox = this.ox, oy = this.oy;
    if (this.sig < 0.5) alpha *= 0.72;                    // casco furtivo: meio fantasma
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.translate(this.x + 6, this.y + 8); ctx.rotate(this.ang); ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (const c of this.list) ctx.fillRect((c.gx - ox) * CS, (c.gy - oy) * CS, CS, CS);
    ctx.restore();

    ctx.translate(this.x, this.y); ctx.rotate(this.ang); ctx.scale(scale, scale);
    if (this.flame > 0.03) {
      for (const c of this.list) {
        if (!c.top || PARTS[c.top.type].kind !== 'engine') continue;
        ctx.save(); ctx.translate((c.gx + 0.5 - ox) * CS, (c.gy + 0.5 - oy) * CS);
        drawFlame(ctx, c.top.type, CS, this.flame, time); ctx.restore();
      }
    }
    for (const c of this.list) {
      ctx.save(); ctx.translate((c.gx + 0.5 - ox) * CS, (c.gy + 0.5 - oy) * CS);
      drawBase(ctx, c.base, CS, { dmg: 1 - c.hp / c.maxHp, flash: c.flash, seed: c.gx * 31 + c.gy * 17 + 1, time });
      ctx.restore();
    }
    for (const c of this.list) {
      if (!c.top) continue;
      ctx.save(); ctx.translate((c.gx + 0.5 - ox) * CS, (c.gy + 0.5 - oy) * CS);
      drawTop(ctx, c.top.type, CS, { ang: c.top.ang - this.ang, recoil: c.top.recoil, time });
      if (c.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, c.flash * 5)})`; ctx.fillRect(-CS / 2, -CS / 2, CS, CS); }
      ctx.restore();
    }
    ctx.restore();
  }

  weaponStatus() {
    const acc = { cannon: [0, 0], mortar: [0, 0], torp: [0, 0] };
    for (const c of this.list) {
      if (!c.top) continue;
      const P = PARTS[c.top.type], k = P.kind === 'missile' ? 'torp' : P.kind;
      if (acc[k]) { acc[k][0]++; acc[k][1] += clamp(1 - c.top.cd / P.reload, 0, 1); }
    }
    const s = {};
    for (const k in acc) s[k] = acc[k][0] ? acc[k][1] / acc[k][0] : null;
    s.shield = this.shieldMax ? this.shield / this.shieldMax : null;
    return s;
  }

  drawShield(ctx) {
    if (this.sinking || !this.shieldMax || this.shield < 0.5) return;
    const k = this.shield / this.shieldMax, f = Math.max(0, this.shieldFlash) / 0.4;
    ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.ang);
    ctx.beginPath(); ctx.ellipse(0, 0, this.hw * 1.1, this.hl * 1.1, 0, 0, TAU);
    ctx.fillStyle = `rgba(90,200,255,${(0.04 + 0.2 * f).toFixed(3)})`; ctx.fill();
    ctx.strokeStyle = `rgba(130,225,255,${((0.18 + 0.6 * f) * (0.4 + 0.6 * k)).toFixed(3)})`; ctx.lineWidth = 2 + 2 * f; ctx.stroke();
    ctx.restore();
  }
}

/* ============================================================== BATALHA */
const Battle = {
  canvas: null, ctx: null, mini: null, mctx: null, W: 0, H: 0, dpr: 1,
  ships: [], shots: [], parts: [], player: null, cam: { x: 0, y: 0 }, shake: 0, time: 0,
  keys: new Set(), mouse: { x: 0, y: 0, left: false, right: false },
  wave: 1, state: 'idle', running: false, last: 0, clearTimer: 0, overTimer: 0,
  runCoins: 0, kills: 0, design: null, hud: {}, mode: 'campaign', shotSeq: 0, myDesign: null, cfg: null, deadNotice: false, contacts: new Map(), obs: [], aiAware: true, aiLast: { x: 0, y: 0 }, stealthT: 0,

  init() {
    this.canvas = document.getElementById('game'); this.ctx = this.canvas.getContext('2d');
    this.mini = document.getElementById('minimap'); this.mctx = this.mini.getContext('2d');
    for (const id of ['wave', 'enemies', 'coins', 'hp-fill', 'hp-text', 'speed', 'cd-cannon', 'cd-torp', 'cd-mortar', 'row-cannon', 'row-torp', 'row-mortar', 'row-shield', 'shield-fill', 'row-stealth', 'stealth-fill', 'vision'])
      this.hud[id] = document.getElementById('hud-' + id);
    this.fogCv = document.createElement('canvas'); this.fogCtx = this.fogCv.getContext('2d');
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', e => {
      if (!this.running) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Escape' || e.code === 'KeyP') this.togglePause();
      if (e.code === 'KeyM') { SFX.muted = !SFX.muted; }
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.canvas.addEventListener('pointerdown', e => {
      SFX.init();
      if (e.pointerType === 'touch') return;           // no celular quem manda são os joysticks
      if (e.button === 0) this.mouse.left = true; else if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('pointerup', e => { if (e.button === 0) this.mouse.left = false; else if (e.button === 2) this.mouse.right = false; });
    this.canvas.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      const r = this.canvas.getBoundingClientRect(); this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top; this.mouse.moved = true;
    });
  },

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.canvas.width = this.W * this.dpr; this.canvas.height = this.H * this.dpr;
    this.fogCv.width = this.W; this.fogCv.height = this.H;
  },

  /* ----------------------------------------------------- ciclo de vida */
  start(design, wave) {
    SFX.init();
    this.mode = 'campaign'; document.getElementById('screen-battle').classList.remove('online');
    this.design = design; this.wave = wave; this.runCoins = 0; this.kills = 0;
    this.clearTimer = 0; this.overTimer = 0;
    this.ships = []; this.shots = []; this.parts = []; this.time = 0; this.shake = 0;
    this.player = new Ship(design, 'p', 0, 0, 0); this.player.id = 'me';
    this.ships.push(this.player); this.stealthT = 0; this.aiAware = true; this.aiLast = { x: 0, y: 0 };
    this.cam.x = 0; this.cam.y = 0;
    this.keys.clear(); this.mouse.left = this.mouse.right = false;
    this.resize();
    this.spawnWave();
    this.state = 'playing';
    if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame(t => this.loop(t)); }
  },

  stop() { this.running = false; this.state = 'idle'; },

  /* ----------------------------------------------------- modo online */
  startOnline(cfg) {
    SFX.init();
    this.mode = 'online'; document.getElementById('screen-battle').classList.add('online');
    this.cfg = cfg; this.myDesign = cfg.me.design; this.shotSeq = 0; this.deadNotice = false;
    this.wave = 0; this.runCoins = 0; this.kills = 0;
    this.ships = []; this.shots = []; this.parts = []; this.time = 0; this.shake = 0;
    const sp = cfg.spawn;
    this.player = new Ship(cfg.me.design, cfg.me.team, sp.x, sp.y, sp.a); this.player.id = cfg.me.id; this.player.label = cfg.me.name;
    this.ships.push(this.player);
    for (const p of cfg.players) if (p.id !== cfg.me.id) this.addRemote(p, cfg.spawns[p.id]);
    this.cam.x = sp.x; this.cam.y = sp.y;
    this.keys.clear(); this.mouse.left = this.mouse.right = false;
    this.resize();
    this.state = 'playing';
    if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame(t => this.loop(t)); }
  },
  addRemote(p, sp) {
    const s = new Ship(p.design, p.team, sp ? sp.x : 0, sp ? sp.y : 0, sp ? sp.a : 0);
    s.id = p.id; s.label = p.name; s.remote = true; s.seenT = 0; s.net = null;
    this.ships.push(s); return s;
  },
  shipById(id) { return this.ships.find(s => s.id === id); },
  respawnMe(x, y, a) {
    const old = this.player;
    const s = new Ship(this.myDesign, old.team, x, y, a); s.id = old.id; s.label = old.label;
    this.ships = this.ships.filter(q => q !== old); this.ships.push(s); this.player = s;
    this.cam.x = x; this.cam.y = y; this.deadNotice = false;
  },
  remoteSpawn(id, x, y, a) {
    const p = this.cfg.players.find(q => q.id === id);
    if (!p) return;
    this.ships = this.ships.filter(q => q.id !== id);
    this.addRemote(p, { x, y, a });
  },
  addNetShot(m) {
    if (this.mode !== 'online' || !this.player) return;
    const lag = clamp((Online.pingMs || 0) / 2000, 0, 0.3);
    const p = { kind: m.kind, id: m.id, owner: m.owner, team: m.team, x: m.x + m.vx * lag, y: m.y + m.vy * lag, vx: m.vx, vy: m.vy, life: m.life - lag,
      dmg: m.dmg, pierce: m.pierce, big: m.big, splash: m.splash, turn: m.turn, ang: m.ang, speed: m.speed, tx: m.tx, ty: m.ty, T: m.T, x0: m.x0, y0: m.y0, remoteOwned: true };
    if (m.kind === 'missile') p.target = this.shipById(m.tg) || null;
    this.shots.push(p);
    if (this.inVision(p.x, p.y)) this.addP({ t: 'flash', x: p.x, y: p.y, life: 0.09, s: 9, g: 20 });
  },
  netHit(m) {
    const p = this.shots.find(q => q.id === m.id && !q.dead);
    if (p) { p.dead = true; if (this.inVision(p.x, p.y) && p.kind !== 'mortar') this.impact(p.x, p.y); }
  },
  /** chamado a cada quadro no modo online */
  onlineTick(dt) {
    const pl = this.player;
    if (pl.dead && !this.deadNotice) { this.deadNotice = true; Online.localDead(); }
    Online.tick(dt, pl);
  },

  nextWave() {
    this.wave++;
    for (const c of this.player.list) {            // reparo parcial entre as ondas
      c.hp += (c.maxHp - c.hp) * 0.35;
      if (c.top) c.top.hp += (c.top.maxHp - c.top.hp) * 0.35;
    }
    this.shots = []; this.ships = [this.player]; this.spawnWave(); this.stealthT = 0;
    this.state = 'playing'; this.clearTimer = 0;
    UI.hideOverlay();
  },

  togglePause() {
    if (this.mode === 'online') {
      if (this.state !== 'playing') return;
      const ov = document.getElementById('overlay');
      if (!ov.classList.contains('hidden')) { UI.hideOverlay(); return; }
      UI.overlay({ title: 'Partida online', html: '<p>O jogo continua rodando para os outros jogadores.</p>', buttons: [
        { label: 'Continuar', primary: true, onClick: () => UI.hideOverlay() },
        { label: 'Sair da partida', onClick: () => Online.leaveToMenu() },
      ] });
      return;
    }
    if (this.state === 'playing') {
      this.state = 'paused';
      UI.overlay({ title: 'Pausado', html: '<p>Respire, capitão.</p>', buttons: [
        { label: 'Continuar', primary: true, onClick: () => { this.state = 'playing'; UI.hideOverlay(); } },
        { label: 'Voltar ao estaleiro', onClick: () => UI.toYard() },
      ] });
    } else if (this.state === 'paused') { this.state = 'playing'; UI.hideOverlay(); }
  },

  spawnWave() {
    let power = Math.min(40, Math.round(this.wave * 1.5 - 0.5));
    const pool = PRESETS.filter(p => p.minWave <= this.wave), list = [];
    while (power > 0 && list.length < 10) {
      const opts = pool.filter(p => p.power <= power);
      if (!opts.length) break;
      let tot = 0; for (const p of opts) tot += p.power + 1;
      let r = Math.random() * tot, pick = opts[0];
      for (const p of opts) { r -= p.power + 1; if (r <= 0) { pick = p; break; } }
      power -= pick.power; list.push(pick);
    }
    if (!list.length) list.push(PRESETS[0]);
    const base = rand(0, TAU), pl = this.player;
    this.aiLast = { x: pl.x, y: pl.y };
    list.forEach((p, i) => {
      const a = base + i * (TAU / list.length) + rand(-0.3, 0.3), d = rand(750, 1050), lim = HALF - 250;
      const x = clamp(pl.x + Math.sin(a) * d, -lim, lim), y = clamp(pl.y - Math.cos(a) * d, -lim, lim);
      const s = new Ship(p.design, 'e', x, y, Math.atan2(pl.x - x, -(pl.y - y)));
      s.label = p.name; s.id = 'ai' + i;
      s.ai = { t: 0, torpGate: rand(4, 7), missGate: rand(3, 6), orbit: Math.random() < 0.5 ? 1 : -1, err: 0, errAng: 0, aimCell: null,
        inacc: clamp(0.17 - this.wave * 0.008, 0.05, 0.17),
        pref: (s.maxRange ? s.maxRange * 0.62 : s.mgRange ? s.mgRange * 0.6 : 90) + rand(-40, 40) };
      s.reloadMul = clamp(1.5 - this.wave * 0.05, 1, 1.5);
      this.ships.push(s);
    });
    const boss = list.some(p => p.id === 'dreadnought');
    UI.banner('ONDA ' + this.wave, (boss ? 'CHEFE: Superencouraçado! + ' : '') + list.length + (list.length > 1 ? ' navios inimigos' : ' navio inimigo'));
  },

  onSunk(ship) {
    this.explosion(ship.x, ship.y, 2);
    if (this.mode === 'online') { if (ship === this.player) Online.sendDied(ship.lastAttacker); return; }
    if (ship.team === 'e') {
      const gain = Math.round(ship.cost * 0.3);
      this.kills++; this.runCoins += gain; Meta.coins += gain; Meta.save();
      this.addP({ t: 'text', txt: '+' + gain + ' 🪙', x: ship.x, y: ship.y - 30, vy: -35, life: 1.8, s: 18, col: '#ffd166' });
    }
  },

  /* -------------------------------------------------------- utilidades */
  addP(o) {
    if (this.parts.length > 1800) return;
    const p = Object.assign({ vx: 0, vy: 0, g: 0, r: 0, vr: 0, drag: 0, a: 1, layer: 1, s: 4 }, o);
    p.max = p.life; this.parts.push(p);
  },
  shoot(s) {
    if (this.mode === 'online' && s.owner === this.player.id) {      // tiro do jogador local: anuncia aos outros
      s.id = s.owner + ':' + (++this.shotSeq);
      Online.sendShot(s);
    }
    this.shots.push(s);
  },
  /** ganchos do modo online (sobrescritos por Online) */
  onShotGone(p) { if (this.mode === 'online' && p.id) Online.send({ t: 'hit', id: p.id, x: p.x, y: p.y }); },
  onPing(ship) { if (this.mode === 'online' && ship === this.player) Online.send({ t: 'ping' }); },

  /* ------------------------------------------------- visão e detecção */
  /** o time `team` detecta o alvo (visão normal, sonar, revelação)? */
  teamSees(team, tg) {
    for (const o of this.ships) if (o.team === team && !o.sinking && !o.dead && detects(o, tg)) return true;
    return false;
  },
  /** o jogador local (ou um aliado) vê este navio? */
  visibleToMe(s) {
    if (!this.player) return false;
    if (s === this.player || s.team === this.player.team) return true;
    if (this.mode === 'online') return s.seenT > 0;
    return this.teamSees(this.player.team, s);
  },
  /** atualiza quem aparece: 'full' (dentro da visão), 'blip' (só sonar/revelação) */
  computeVisibility() {
    const me = this.player;
    this.obs = this.ships.filter(o => o.team === me.team && !o.sinking && !o.dead);
    if (!this.obs.length) this.obs = [me];                          // jogador afundando: mantém a cena visível
    const contacts = new Map();
    for (const s of this.ships) {
      if (s.team === me.team) { contacts.set(s, 'full'); continue; }
      if (s.dead || !this.visibleToMe(s)) continue;
      let inside = false;
      for (const o of this.obs) if (Math.hypot(s.x - o.x, s.y - o.y) <= o.vision) { inside = true; break; }
      contacts.set(s, inside ? 'full' : 'blip');
    }
    this.contacts = contacts;
  },
  inVision(x, y) {
    for (const o of this.obs) { const dx = x - o.x, dy = y - o.y; if (dx * dx + dy * dy <= o.vision * o.vision) return true; }
    return false;
  },
  nearestEnemy(ship, x, y, range) {
    let best = null, bd = range;
    for (const s of this.ships) {
      if (s.team === ship.team || s.sinking || s.dead) continue;
      if (this.mode === 'online' ? !this.visibleToMe(s) : !this.teamSees(ship.team, s)) continue;   // furtivos não são alvo de torres e mísseis
      const d = Math.hypot(s.x - x, s.y - y) - s.radius * 0.6;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  },
  explosion(x, y, size = 1) {
    this.addP({ t: 'flash', x, y, life: 0.2, s: 22 * size, g: 90 * size });
    for (let i = 0; i < Math.round(8 * size); i++) {
      const a = rand(0, TAU), sp = rand(30, 130) * size;
      this.addP({ t: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.35, 0.8), s: rand(6, 11) * size, g: -8, drag: 2.5 });
    }
    for (let i = 0; i < Math.round(5 * size); i++)
      this.addP({ t: 'smoke', x: x + rand(-8, 8), y: y + rand(-8, 8), vx: rand(-20, 20), vy: rand(-30, -5), life: rand(1.2, 2.4), s: rand(8, 13) * size, g: 12, a: 0.8 });
    for (let i = 0; i < Math.round(8 * size); i++) {
      const a = rand(0, TAU), sp = rand(100, 300);
      this.addP({ t: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.5), drag: 3 });
    }
    this.addP({ t: 'ring', x, y, life: 0.5, s: 6, g: 140 * size, layer: 0 });
    if (this.player) {
      const d = Math.hypot(x - this.player.x, y - this.player.y);
      if (d < 900) this.shake = Math.min(1, this.shake + 0.1 * size * (1 - d / 900));
    }
    SFX.play('boom', x, y);
  },
  splash(x, y, size = 1) {
    this.addP({ t: 'ring', x, y, life: 0.7, s: 4, g: 60 * size, layer: 0 });
    for (let i = 0; i < 6 * size; i++) {
      const a = rand(0, TAU), sp = rand(20, 70);
      this.addP({ t: 'foam', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.5, 1), s: rand(2, 4), g: 3, drag: 2, layer: 0, a: 0.9 });
    }
  },
  debris(x, y, base) {
    const col = { '#': '#9aa7b5', '=': '#56616f', 'B': '#cfd8e2', 'b': '#59687c', 'o': '#c4a574', '@': '#4b5666', '%': '#a06c40', '<': '#f0933a', '>': '#f0933a', 'v': '#2fb5c4' }[base] || '#888';
    for (let i = 0; i < 3; i++) {
      const a = rand(0, TAU), sp = rand(30, 110);
      this.addP({ t: 'debris', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.9, 1.6), s: rand(3, 6), r: rand(0, TAU), vr: rand(-8, 8), drag: 1.8, col });
    }
  },
  impact(x, y) {
    for (let i = 0; i < 4; i++) {
      const a = rand(0, TAU), sp = rand(60, 180);
      this.addP({ t: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.15, 0.35), drag: 3 });
    }
    this.addP({ t: 'flash', x, y, life: 0.08, s: 8, g: 30 });
    SFX.play('hit', x, y);
  },

  /* --------------------------------------------------------- simulação */
  loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.033, (now - this.last) / 1000);
    this.last = now;
    if (this.state === 'playing') this.update(dt);
    else if (this.state === 'over' || this.state === 'cleared') this.updateParticlesOnly(dt);
    this.render();
    requestAnimationFrame(t => this.loop(t));
  },

  playerInput() {
    const p = this.player, i = p.input, k = this.keys;
    if (p.sinking) return;
    i.throttle = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    i.steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    i.aimX = this.cam.x + (this.mouse.x - this.W / 2);
    i.aimY = this.cam.y + (this.mouse.y - this.H / 2);
    i.fireMain = this.mouse.left;
    i.fireTorp = this.mouse.right || k.has('Space');
    i.fireMissile = i.fireTorp;
    if (Touch.enabled && !Touch.root.classList.contains('hidden')) Touch.apply(p, i, this);
  },

  aiThink(s, dt) {
    const a = s.ai, inp = s.input, tg = this.player;
    if (!tg || tg.sinking) {
      inp.throttle = 0.2; inp.steer = Math.sin(this.time * 0.3) * 0.4;
      inp.fireMain = inp.fireTorp = inp.fireMissile = false; return;
    }
    if (!this.aiAware) {                                                 // perdeu o jogador de vista: vai ao último ponto e procura
      const L = this.aiLast, ldx = L.x - s.x, ldy = L.y - s.y;
      if (Math.hypot(ldx, ldy) < 200) {
        const lim = HALF - 300;
        this.aiLast = { x: clamp(L.x + rand(-800, 800), -lim, lim), y: clamp(L.y + rand(-800, 800), -lim, lim) };
      }
      inp.steer = clamp(angDiff(Math.atan2(ldx, -ldy), s.ang) * 2, -1, 1);
      inp.throttle = s.stats.maxSpeed ? 0.75 : 0;
      inp.fireMain = inp.fireTorp = inp.fireMissile = false; return;
    }
    const dx = tg.x - s.x, dy = tg.y - s.y, dist = Math.hypot(dx, dy), toT = Math.atan2(dx, -dy);
    a.t -= dt;
    if (a.t <= 0) {
      a.t = rand(0.7, 1.5); a.err = rand(-1, 1) * dist * a.inacc; a.errAng = rand(0, TAU);
      if (Math.random() < 0.25) a.orbit *= -1;
      a.aimCell = tg.list[(Math.random() * tg.list.length) | 0];   // mira numa peça qualquer, não só no centro
    }
    let ax = tg.x, ay = tg.y;
    if (a.aimCell && !a.aimCell.dead) [ax, ay] = tg.cellWorld(a.aimCell);
    let heading;
    if (s.rammer) heading = dist < 130 ? toT + a.orbit * 1.2 : toT;       // brulote: cola no alvo
    else if (s.hasTorp && dist < 750) heading = dist < 160 ? toT + a.orbit * 1.4 : toT;
    else if (dist > a.pref + 80) heading = toT;
    else if (dist < a.pref - 80) heading = toT + a.orbit * 2.3;
    else heading = toT + a.orbit * Math.PI / 2;
    const diff = angDiff(heading, s.ang);
    inp.steer = clamp(diff * 2.2, -1, 1);
    inp.throttle = s.stats.maxSpeed ? (Math.abs(diff) > 1.4 ? 0.35 : 1) : 0;
    inp.aimX = ax + Math.cos(a.errAng) * a.err;
    inp.aimY = ay + Math.sin(a.errAng) * a.err;
    inp.tvx = tg.vx; inp.tvy = tg.vy;                    // cada arma antecipa conforme a própria velocidade
    inp.fireMain = s.maxRange > 0 && dist < s.maxRange * 0.97;
    // torpedos: só quando alinhado, e com intervalo mínimo para dar chance de desviar
    a.torpGate -= dt; a.missGate -= dt;
    inp.fireTorp = false; inp.fireMissile = false;
    if (s.hasTorp && a.torpGate <= 0 && dist < 700 && Math.abs(angDiff(toT, s.ang)) < 0.12
        && s.list.some(c => c.top && PARTS[c.top.type].kind === 'torp' && c.top.cd <= 0)) {
      inp.fireTorp = true; a.torpGate = rand(4.5, 6.5);
    }
    if (s.stats.missiles && a.missGate <= 0 && dist < 780 && dist > 150
        && s.list.some(c => c.top && PARTS[c.top.type].kind === 'missile' && c.top.cd <= 0)) {
      inp.fireMissile = true; a.missGate = rand(3, 5);
    }
  },

  update(dt) {
    this.time += dt;
    this.playerInput();
    if (this.mode !== 'online') {
      this.aiAware = !this.player.sinking && this.teamSees('e', this.player);
      if (this.aiAware) this.aiLast = { x: this.player.x, y: this.player.y };
      for (const s of this.ships) if (s.ai) this.aiThink(s, dt);
    }
    for (const s of this.ships) { if (s.remote) s.updateRemote(dt); else s.update(dt); }

    /* colisão entre navios (círculos) */
    for (let i = 0; i < this.ships.length; i++) for (let j = i + 1; j < this.ships.length; j++) {
      const a = this.ships[i], b = this.ships[j];
      if (a.sinking || b.sinking || (a.remote && b.remote) || (a.remote && a.seenT <= 0) || (b.remote && b.seenT <= 0)) continue;
      const r = (a.radius + b.radius) * 0.6, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d < r && d > 0.01) {
        const nx = dx / d, ny = dy / d, push = (r - d) / 2;
        const wa = a.remote ? 0 : (b.remote ? 2 : 1), wb = b.remote ? 0 : (a.remote ? 2 : 1);   // o remoto não é empurrado: o dono resolve
        a.x -= nx * push * wa; a.y -= ny * push * wa; b.x += nx * push * wb; b.y += ny * push * wb;
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) {
          if (!a.remote) { a.vx += nx * rv * 0.5 * wa; a.vy += ny * rv * 0.5 * wa; }
          if (!b.remote) { b.vx -= nx * rv * 0.5 * wb; b.vy -= ny * rv * 0.5 * wb; }
        }
      }
    }

    /* projéteis */
    for (const p of this.shots) {
      if (p.dead) continue;
      p.life -= dt;
      if (p.kind === 'mortar') {                          // voa em arco por cima de tudo
        const k = clamp(1 - p.life / p.T, 0, 1);
        p.x = p.x0 + (p.tx - p.x0) * k; p.y = p.y0 + (p.ty - p.y0) * k;
        if (p.life <= 0) { p.dead = true; this.blast(p.tx, p.ty, p.splash, p.dmg, p.team, p.owner); this.splash(p.tx, p.ty, 1.2); }
        continue;
      }
      if (p.kind === 'missile') this.steerMissile(p, dt);
      const steps = Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy) * dt / 8));
      for (let i = 0; i < steps && !p.dead; i++) {
        p.x += p.vx * dt / steps; p.y += p.vy * dt / steps;
        for (const s of this.ships) {
          if (s.team === p.team || s.sinking || (s.remote && s.seenT <= 0)) continue;
          const c = s.cellAt(p.x, p.y);
          if (c && this.impactShot(p, s, c)) {
            p.dead = true;
            if (this.mode === 'online' && p.id && s === this.player) Online.send({ t: 'hit', id: p.id, x: p.x, y: p.y });   // avisa que o tiro acabou
            break;
          }
        }
      }
      if (p.dead) continue;
      if (p.life <= 0) {
        p.dead = true;
        if (p.kind === 'shell') this.splash(p.x, p.y, 1);
        else if (p.kind === 'bullet' || p.kind === 'heavy') this.splash(p.x, p.y, 0.4);
        else if (p.kind === 'missile') this.explosion(p.x, p.y, 0.5);
        continue;
      }
      if (p.kind === 'torp' && Math.random() < dt * 30)
        this.addP({ t: 'foam', x: p.x - p.vx * 0.03, y: p.y - p.vy * 0.03, life: 0.7, s: 2.5, g: 8, layer: 0, a: 0.8 });
      else if (p.kind === 'shell' && Math.random() < dt * 20)
        this.addP({ t: 'smoke', x: p.x, y: p.y, life: 0.25, s: 2, g: 6, a: 0.25 });
      else if (p.kind === 'missile') {
        if (Math.random() < dt * 60) this.addP({ t: 'smoke', x: p.x - p.vx * 0.02, y: p.y - p.vy * 0.02, life: 0.55, s: 3, g: 8, a: 0.45 });
        this.addP({ t: 'fire', x: p.x - p.vx * 0.012, y: p.y - p.vy * 0.012, life: 0.12, s: 3 });
      } else if (p.kind === 'flame' && Math.random() < dt * 45)
        this.addP({ t: 'fire', x: p.x, y: p.y, vx: rand(-15, 15), vy: rand(-15, 15), life: 0.3, s: rand(4, 8), g: 12 });
    }
    this.shots = this.shots.filter(p => !p.dead);

    this.updateParticles(dt);
    this.ships = this.ships.filter(s => s === this.player || !s.dead);

    /* estado da batalha */
    let alive;
    if (this.mode === 'online') {
      alive = this.ships.filter(s => s.team !== this.player.team && !s.dead && s.seenT > 0).length;
      this.onlineTick(dt);
    } else {
      const foes = this.ships.filter(s => s.team === 'e' && !s.sinking);
      alive = foes.length;
      if (alive && !foes.some(f => this.visibleToMe(f)) && !this.player.sinking) {   // ninguém à vista há um tempo: expõe os inimigos
        this.stealthT += dt;
        if (this.stealthT > 25) {
          this.stealthT = 0; for (const f of foes) f.doReveal(6000, 4);
          UI.banner(foes.every(f => f.sig < 0.5) ? 'SINAL FURTIVO' : 'INIMIGOS LOCALIZADOS', 'Expostos por alguns segundos');
        }
      } else this.stealthT = 0;
      if (this.player.dead) {
        this.overTimer += dt;
        if (this.overTimer > 0.8) this.gameOver();
      } else if (alive === 0 && !this.player.sinking) {
        this.clearTimer += dt;
        if (this.clearTimer > 2.2) this.waveCleared();
      }
    }

    /* câmera */
    const pl = this.player;
    const tx = pl.x + (this.mouse.x - this.W / 2) * 0.2, ty = pl.y + (this.mouse.y - this.H / 2) * 0.2;
    const k = Math.min(1, dt * 5);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.updateHud(alive);
  },

  updateParticlesOnly(dt) { this.time += dt; for (const s of this.ships) if (s.sinking) s.update(dt); this.updateParticles(dt); },

  /** efeito de uma bala em uma célula; retorna true se o projétil foi consumido */
  impactShot(p, s, c) {
    if (p.kind === 'torp' || p.kind === 'missile') { this.blast(p.x, p.y, p.splash, p.dmg, p.team, p.owner); return true; }
    if (p.kind === 'rail') {
      const hs = p.hit || (p.hit = new Set());
      if (hs.has(c)) return false;
      hs.add(c); this.impact(p.x, p.y); s.hitCell(c, p.dmg, false, p.owner); p.dmg *= 0.65;
      return --p.pierce < 0;
    }
    if (p.kind === 'flame') {
      this.addP({ t: 'fire', x: p.x, y: p.y, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.35, s: 6, g: 10 });
      s.hitCell(c, p.dmg, false, p.owner); return true;
    }
    this.impact(p.x, p.y); s.hitCell(c, p.dmg, false, p.owner); return true;
  },

  /** explosão em área: dano decai com a distância (casco reativo reduz pela metade) */
  blast(x, y, radius, dmg, team, owner = null) {
    this.explosion(x, y, Math.max(0.6, radius / 25));
    const reach = radius + CS * 0.5;
    for (const s of this.ships) {
      if (s.team === team || s.sinking) continue;
      const hits = [];
      for (const c of s.list) {
        if (c.dead) continue;
        const [wx, wy] = s.cellWorld(c), d = Math.hypot(wx - x, wy - y);
        if (d < reach) hits.push([c, d]);
      }
      for (const [c, d] of hits) s.hitCell(c, dmg * (1 - 0.6 * d / reach), true, owner);
    }
  },

  steerMissile(p, dt) {
    let tg = p.target;
    if (tg && (tg.sinking || tg.dead)) tg = p.target = null;
    if (tg && !p.remoteOwned && !(this.mode === 'online' ? (tg.team === this.player.team || this.visibleToMe(tg)) : this.teamSees(p.team, tg))) tg = p.target = null;
    if (!tg && !p.jam) tg = p.target = this.nearestEnemy({ team: p.team }, p.x, p.y, 900);
    if (p.jam > 0) { p.jam -= dt; p.ang += rand(-1, 1) * 4 * dt; }                 // bloqueado: sai voando sem rumo
    else if (tg) p.ang = turnToward(p.ang, Math.atan2(tg.x - p.x, -(tg.y - p.y)), p.turn * dt);
    const [dx, dy] = dirOf(p.ang);
    p.vx = dx * p.speed; p.vy = dy * p.speed;
  },

  updateParticles(dt) {
    const arr = this.parts;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); continue; }
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.s += p.g * dt; p.r += p.vr * dt;
    }
  },

  waveCleared() {
    this.state = 'cleared';
    const bonus = 25 + this.wave * 10;
    Meta.coins += bonus; this.runCoins += bonus; Meta.best = Math.max(Meta.best, this.wave); Meta.save();
    UI.overlay({
      title: `Onda ${this.wave} concluída! ⚓`,
      html: `<p>Bônus da onda: <b>+${bonus} 🪙</b><br>Total ganho nesta campanha: <b>${this.runCoins} 🪙</b><br>Orçamento do estaleiro: <b>${Meta.budget()}</b></p>
             <p class="muted">Voltar ao estaleiro conserta o navio por completo e deixa você reformá-lo. Seguir em frente repara só 35% do dano.</p>`,
      buttons: [
        { label: `Próxima onda (${this.wave + 1})`, primary: true, onClick: () => this.nextWave() },
        { label: 'Ir ao estaleiro', onClick: () => UI.toYard() },
      ],
    });
  },

  gameOver() {
    this.state = 'over';
    Meta.best = Math.max(Meta.best, this.wave - 1); Meta.save();
    UI.overlay({
      title: 'Seu navio afundou 💀',
      html: `<p>Você chegou à <b>onda ${this.wave}</b> e afundou <b>${this.kills}</b> navio(s).<br>Moedas ganhas: <b>${this.runCoins} 🪙</b> (ficam com você!)</p>
             <p class="muted">Use as moedas para ampliar o orçamento e construir um navio melhor.</p>`,
      buttons: [
        { label: 'Voltar ao estaleiro', primary: true, onClick: () => UI.toYard() },
      ],
    });
  },

  /* ------------------------------------------------------------- HUD */
  updateHud(alive) {
    const h = this.hud, p = this.player;
    h.wave.textContent = this.wave; h.enemies.textContent = alive; h.coins.textContent = this.runCoins;
    const ratio = clamp(p.hullHp() / p.maxHullHp, 0, 1);
    h['hp-fill'].style.width = (ratio * 100).toFixed(0) + '%';
    h['hp-fill'].style.background = ratio > 0.6 ? '#3ecf8e' : ratio > 0.3 ? '#f5b942' : '#ff5d5d';
    h['hp-text'].textContent = Math.round(ratio * 100) + '%';
    h.speed.textContent = Math.round((p.speed || 0) / 5);
    const w = p.weaponStatus();
    for (const k of ['cannon', 'mortar', 'torp']) {
      h['row-' + k].style.display = w[k] === null ? 'none' : '';
      if (w[k] !== null) h['cd-' + k].style.width = (w[k] * 100).toFixed(0) + '%';
    }
    h.vision.textContent = Math.round(p.vision);
    h['row-stealth'].style.display = p.cover > 0 ? '' : 'none';
    if (p.cover > 0) h['stealth-fill'].style.width = ((1 - p.sig) * 100).toFixed(0) + '%';
    h['row-shield'].style.display = w.shield === null ? 'none' : '';
    if (w.shield !== null) h['shield-fill'].style.width = (w.shield * 100).toFixed(0) + '%';
  },

  /* ----------------------------------------------------------- render */
  render() {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.computeVisibility();
    this.drawWater();
    const sx = (Math.random() - 0.5) * this.shake * 14, sy = (Math.random() - 0.5) * this.shake * 14;
    ctx.save();
    ctx.translate(W / 2 - this.cam.x + sx, H / 2 - this.cam.y + sy);

    // limite do mapa
    ctx.fillStyle = 'rgba(6,12,24,.72)';
    ctx.fillRect(-HALF - 4000, -HALF - 4000, WORLD + 8000, 4000);
    ctx.fillRect(-HALF - 4000, HALF, WORLD + 8000, 4000);
    ctx.fillRect(-HALF - 4000, -HALF, 4000, WORLD);
    ctx.fillRect(HALF, -HALF, 4000, WORLD);
    ctx.strokeStyle = '#ff5d4a'; ctx.lineWidth = 5; ctx.setLineDash([26, 16]);
    ctx.strokeRect(-HALF, -HALF, WORLD, WORLD); ctx.setLineDash([]);

    this.drawParticles(0);
    const shown = p => p.team === this.player.team || this.inVision(p.x, p.y);
    for (const p of this.shots) if (p.kind === 'mortar' && (shown(p) || this.inVision(p.tx, p.ty))) this.drawMortarMarker(p);
    for (const p of this.shots) if (p.kind === 'torp' && shown(p)) this.drawShot(p);
    for (const [sh, mode] of this.contacts) if (mode === 'full' && sh !== this.player) sh.draw(ctx, this.time);
    this.player.draw(ctx, this.time);
    for (const [sh, mode] of this.contacts) if (mode === 'full') sh.drawShield(ctx);
    for (const p of this.shots) if (p.kind !== 'torp' && shown(p)) this.drawShot(p);
    this.drawParticles(1);

    // barras de vida e nomes dos inimigos visíveis
    for (const [sh, mode] of this.contacts) {
      if (sh.team === this.player.team && sh !== this.player && this.mode === 'online' && !sh.sinking) {
        ctx.font = '600 11px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(140,255,170,.95)';
        ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3; ctx.strokeText(sh.label, sh.x, sh.y - sh.radius - 8); ctx.fillText(sh.label, sh.x, sh.y - sh.radius - 8);
        continue;
      }
      if (sh.team === this.player.team || mode !== 'full' || sh.sinking) continue;
      const r = clamp(sh.hullHp() / sh.maxHullHp, 0, 1), w = 52, y = sh.y - sh.radius - 16;
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(sh.x - w / 2 - 1, y - 1, w + 2, 7);
      ctx.fillStyle = r > 0.5 ? '#ff7a5c' : '#ff3b3b'; ctx.fillRect(sh.x - w / 2, y, w * r, 5);
      ctx.font = '600 11px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3; ctx.strokeText(sh.label, sh.x, y - 5); ctx.fillText(sh.label, sh.x, y - 5);
    }
    ctx.restore();

    this.drawFog();
    this.drawBlips();
    this.drawIndicators();
    this.drawCrosshair();
    this.drawMinimap();
  },

  drawWater() {
    const ctx = this.ctx, W = this.W, H = this.H, cam = this.cam, t = this.time;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#17608c'); g.addColorStop(1, '#0d3f66');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const sp = 130, x0 = Math.floor((cam.x - W / 2) / sp) - 1, y0 = Math.floor((cam.y - H / 2) / sp) - 1;
    ctx.lineWidth = 2; ctx.lineCap = 'round';
    const hash = (a, b, n) => { const v = Math.sin(a * 127.1 + b * 311.7 + n * 74.7) * 43758.5453; return v - Math.floor(v); };
    for (let j = 0; j < H / sp + 3; j++) for (let i = 0; i < W / sp + 3; i++) {
      const gx = x0 + i, gy = y0 + j, h1 = hash(gx, gy, 0), h2 = hash(gx, gy, 1);
      const px = gx * sp + h1 * sp - cam.x + W / 2, py = gy * sp + h2 * sp - cam.y + H / 2;
      const al = 0.05 + 0.11 * (0.5 + 0.5 * Math.sin(t * 0.9 + h1 * 20));
      ctx.strokeStyle = `rgba(200,235,255,${al.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(px, py, 14 + h2 * 16, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(px + 22, py + 12, 8 + h1 * 8, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    }
  },

  drawShot(p) {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(p.x, p.y);
    switch (p.kind) {
      case 'torp':
        ctx.rotate(Math.atan2(p.vx, -p.vy));
        ctx.fillStyle = '#d0d8e0'; ctx.fillRect(-2.5, -9, 5, 18);
        ctx.fillStyle = '#c0392b'; ctx.fillRect(-2.5, -9, 5, 4);
        break;
      case 'shell':
        ctx.fillStyle = '#ffe9a8'; ctx.shadowColor = '#ffb347'; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(0, 0, p.big ? 4.8 : 3.4, 0, TAU); ctx.fill();
        break;
      case 'rail': {
        ctx.rotate(Math.atan2(p.vx, -p.vy));
        const g = ctx.createLinearGradient(0, 0, 0, 46);
        g.addColorStop(0, '#ffffff'); g.addColorStop(1, 'rgba(127,212,255,0)');
        ctx.fillStyle = g; ctx.fillRect(-1.6, 0, 3.2, 46);
        break;
      }
      case 'heavy':
        ctx.rotate(Math.atan2(p.vx, -p.vy));
        ctx.fillStyle = '#ffd27a'; ctx.fillRect(-1.6, -7, 3.2, 14);
        break;
      case 'missile':
        ctx.rotate(p.ang);
        ctx.fillStyle = '#e6eaee'; ctx.fillRect(-2.5, -8, 5, 14);
        ctx.fillStyle = '#e8503a'; ctx.fillRect(-2.5, -8, 5, 4);
        break;
      case 'mortar': {
        const k = clamp(1 - p.life / p.T, 0, 1), h = 4 * k * (1 - k);
        ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(0, 0, 4 + h, 3 + h * 0.6, 0, 0, TAU); ctx.fill();
        ctx.translate(0, -h * 46);
        ctx.fillStyle = '#d6d9dd'; ctx.strokeStyle = '#2b2f35'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(0, 0, 3.6 + h * 3.2, 0, TAU); ctx.fill(); ctx.stroke();
        break;
      }
      case 'flame': break;                                  // desenhado pelas partículas de fogo
      default:
        ctx.rotate(Math.atan2(p.vx, -p.vy));
        ctx.fillStyle = '#fff3b0'; ctx.fillRect(-1, -5, 2, 10);
    }
    ctx.restore();
  },

  /** círculo no ponto de queda de uma granada de morteiro (vermelho = inimiga) */
  drawMortarMarker(p) {
    const ctx = this.ctx, k = clamp(1 - p.life / p.T, 0, 1), foe = p.team !== this.player.team;
    ctx.lineWidth = 2;
    ctx.strokeStyle = foe ? `rgba(255,90,90,${(0.4 + 0.3 * Math.sin(this.time * 14)).toFixed(3)})` : 'rgba(255,255,255,.22)';
    ctx.fillStyle = foe ? 'rgba(255,60,60,.08)' : 'rgba(255,255,255,.03)';
    ctx.beginPath(); ctx.arc(p.tx, p.ty, p.splash, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(p.tx, p.ty, Math.max(2, p.splash * (1 - k)), 0, TAU); ctx.stroke();
  },

  drawParticles(layer) {
    const ctx = this.ctx;
    for (const p of this.parts) {
      if (p.layer !== layer || !this.inVision(p.x, p.y)) continue;
      const k = p.life / p.max;
      switch (p.t) {
        case 'smoke': ctx.fillStyle = `rgba(45,50,58,${(k * 0.55 * p.a).toFixed(3)})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, TAU); ctx.fill(); break;
        case 'fire':
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = `rgba(255,${(90 + 130 * k) | 0},40,${(k * 0.85).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.s * (0.4 + k * 0.6)), 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'source-over'; break;
        case 'flash':
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = `rgba(255,236,170,${k.toFixed(3)})`; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.s), 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'source-over'; break;
        case 'spark':
          ctx.strokeStyle = `rgba(255,214,120,${k.toFixed(3)})`; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke(); break;
        case 'ring':
          ctx.strokeStyle = p.cyan ? `rgba(120,230,255,${(k * 0.7).toFixed(3)})` : `rgba(255,255,255,${(k * 0.55).toFixed(3)})`; ctx.lineWidth = p.cyan ? 3 : 2;
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, p.s), 0, TAU); ctx.stroke(); break;
        case 'foam': ctx.fillStyle = `rgba(255,255,255,${(k * 0.4 * p.a).toFixed(3)})`; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.s), 0, TAU); ctx.fill(); break;
        case 'debris':
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.min(1, k * 2);
          ctx.fillStyle = p.col; ctx.fillRect(-p.s, -p.s * 0.6, p.s * 2, p.s * 1.2); ctx.restore(); break;
        case 'plus':
          ctx.fillStyle = `rgba(80,230,140,${k.toFixed(3)})`;
          ctx.fillRect(p.x - 1.5, p.y - p.s, 3, p.s * 2); ctx.fillRect(p.x - p.s, p.y - 1.5, p.s * 2, 3); break;
        case 'tracer':
          ctx.strokeStyle = `rgba(160,245,255,${k.toFixed(3)})`; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x2, p.y2); ctx.stroke(); break;
        case 'text':
          ctx.globalAlpha = Math.min(1, k * 2); ctx.fillStyle = p.col; ctx.font = `bold ${p.s}px "Segoe UI", sans-serif`;
          ctx.textAlign = 'center'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3;
          ctx.strokeText(p.txt, p.x, p.y); ctx.fillText(p.txt, p.x, p.y); ctx.globalAlpha = 1; break;
      }
    }
  },

  drawIndicators() {
    const ctx = this.ctx, W = this.W, H = this.H, m = 26;
    for (const [s, mode] of this.contacts) {
      if (s.team === this.player.team || s.sinking) continue;
      const sx = s.x - this.cam.x + W / 2, sy = s.y - this.cam.y + H / 2;
      if (sx > -s.radius && sx < W + s.radius && sy > -s.radius && sy < H + s.radius) continue;
      const ex = clamp(sx, m, W - m), ey = clamp(sy, m + 50, H - m);
      const a = Math.atan2(sy - H / 2, sx - W / 2);
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(a);
      ctx.fillStyle = mode === 'blip' ? 'rgba(255,170,90,.9)' : 'rgba(255,93,93,.9)'; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 2;
      poly(ctx, [[12, 0], [-8, -9], [-8, 9]]); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  },

  /** escuridão fora do alcance de visão (buracos suaves ao redor de cada observador) */
  drawFog() {
    const f = this.fogCtx, W = this.W, H = this.H;
    f.setTransform(1, 0, 0, 1, 0, 0); f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, W, H); f.fillStyle = 'rgba(3,10,24,0.80)'; f.fillRect(0, 0, W, H);
    f.globalCompositeOperation = 'destination-out';
    for (const o of this.obs) {
      const x = o.x - this.cam.x + W / 2, y = o.y - this.cam.y + H / 2, r = o.vision;
      const g = f.createRadialGradient(x, y, r * 0.55, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = g; f.beginPath(); f.arc(x, y, r, 0, TAU); f.fill();
    }
    f.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(this.fogCv, 0, 0, W, H);
  },

  /** contatos que só o sonar (ou uma revelação) mostra: silhueta vermelha dentro da escuridão */
  drawBlips() {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.save(); ctx.translate(W / 2 - this.cam.x, H / 2 - this.cam.y);
    for (const [s, mode] of this.contacts) {
      if (mode !== 'blip' || s.sinking) continue;
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.ang);
      ctx.fillStyle = `rgba(255,90,90,${(0.45 + 0.2 * Math.sin(this.time * 6)).toFixed(3)})`;
      for (const c of s.list) ctx.fillRect((c.gx - s.ox) * CS, (c.gy - s.oy) * CS, CS, CS);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,120,90,.7)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(s.x, s.y, s.radius + 14, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '600 11px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,200,170,.9)';
      ctx.fillText(s.label || 'contato', s.x, s.y - s.radius - 20);
    }
    ctx.restore();
  },

  drawCrosshair() {
    if (this.state !== 'playing') return;
    const ctx = this.ctx, x = this.mouse.x, y = this.mouse.y, w = this.player.weaponStatus();
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(dx * 7, dy * 7); ctx.lineTo(dx * 19, dy * 19); }
    ctx.stroke();
    if (w.cannon !== null && w.cannon < 1) {
      ctx.strokeStyle = '#f5b942'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 17, -Math.PI / 2, -Math.PI / 2 + TAU * w.cannon); ctx.stroke();
    }
    let splash = 0;
    for (const c of this.player.list) if (c.top && PARTS[c.top.type].kind === 'mortar') splash = Math.max(splash, PARTS[c.top.type].splash);
    if (splash) {
      ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(245,185,66,.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, splash, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  },

  drawMinimap() {
    const c = this.mctx, S = this.mini.width, k = S / WORLD;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(8,24,44,.75)'; c.fillRect(0, 0, S, S);
    c.strokeStyle = 'rgba(255,93,74,.7)'; c.lineWidth = 2; c.strokeRect(1, 1, S - 2, S - 2);
    for (const o of this.obs) {                                       // círculos de visão
      c.fillStyle = 'rgba(120,200,255,.10)'; c.strokeStyle = 'rgba(120,200,255,.35)'; c.lineWidth = 1;
      c.beginPath(); c.arc((o.x + HALF) * k, (o.y + HALF) * k, o.vision * k, 0, TAU); c.fill(); c.stroke();
    }
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 1;
    c.strokeRect((this.cam.x - this.W / 2 + HALF) * k, (this.cam.y - this.H / 2 + HALF) * k, this.W * k, this.H * k);
    for (const [s, mode] of this.contacts) {
      if (s.sinking || s.dead) continue;
      const x = (s.x + HALF) * k, y = (s.y + HALF) * k;
      if (s === this.player) {
        c.save(); c.translate(x, y); c.rotate(s.ang); c.fillStyle = '#fff';
        poly(c, [[0, -6], [4, 5], [-4, 5]]); c.fill(); c.restore();
      } else if (s.team === this.player.team) { c.fillStyle = '#5fe08a'; c.beginPath(); c.arc(x, y, 3.5, 0, TAU); c.fill(); }
      else { c.fillStyle = mode === 'blip' ? '#ffa35a' : '#ff5d5d'; c.beginPath(); c.arc(x, y, 3 + Math.min(3, s.initialHull / 30), 0, TAU); c.fill(); }
    }
  },
};
