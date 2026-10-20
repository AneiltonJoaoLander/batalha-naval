'use strict';
/* =====================================================================
   ESTALEIRO: editor em grade para montar o navio
   ===================================================================== */
const Builder = (() => {
  const CELL = 34, MARGIN = 26;
  let canvas, ctx, design, tool = '#', symmetry = true, freeMode = false;
  let hover = null, painting = false, undoStack = [], lastKey = '', time = 0;
  let onChange = () => {};

  /* ------------------------------------------------------- regras de grade */
  const inRange = (x, y) => x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
  const hullAt = (d, x, y) => inRange(x, y) && isHull(d.hull[y][x]);
  const toolDef = key => TOOLS.find(t => t.key === key);

  /** qual aleta colocar em (x,y)? null = posição inválida */
  function finFor(d, part, x, y) {
    if (part === 'v') return hullAt(d, x, y - 1) ? 'v' : null;
    const l = hullAt(d, x - 1, y), r = hullAt(d, x + 1, y);
    if (l && r) return x < (GRID_W - 1) / 2 ? '<' : '>';
    if (r) return '<';
    if (l) return '>';
    return null;
  }

  /** retorna null se pode colocar; senão o motivo */
  function problem(d, t, x, y) {
    if (!inRange(x, y)) return 'Fora da grade';
    const h = d.hull[y][x];
    if (t.eraser) return h || d.top[y][x] || d.crew[y][x] ? null : 'Nada para apagar';
    if (t.layer === 'crew') return isHull(h) ? null : 'A tripulação precisa ficar sobre uma peça de casco';
    if (t.layer === 'hull') return null;
    if (t.layer === 'top') {
      if (!isHull(h)) return 'Precisa ficar sobre uma peça de casco';
      if (isBridge(h)) return 'Não dá para montar nada sobre a ponte';
      return null;
    }
    if (t.layer === 'fin') {
      if (h && !isFin(h)) return 'Aletas ficam em células vazias, encostadas no casco';
      return finFor(d, t.part, x, y) ? null : (t.part === 'v' ? 'Precisa ficar logo atrás de uma peça de casco' : 'Precisa ficar ao lado de uma peça de casco');
    }
    return null;
  }

  function place(d, t, x, y) {
    if (t.eraser) { if (d.top[y][x]) d.top[y][x] = ''; else if (d.crew[y][x]) d.crew[y][x] = ''; else d.hull[y][x] = ''; return; }
    if (t.layer === 'hull') {
      if (isBridge(t.part)) {
        for (let j = 0; j < GRID_H; j++) for (let i = 0; i < GRID_W; i++) if (isBridge(d.hull[j][i])) d.hull[j][i] = '#';
        d.top[y][x] = '';
      }
      d.hull[y][x] = t.part;
    } else if (t.layer === 'top') d.top[y][x] = t.part;
    else if (t.layer === 'crew') d.crew[y][x] = t.crew;
    else d.hull[y][x] = finFor(d, t.part, x, y);
  }

  /** remove aletas sem apoio e peças sem casco */
  function sanitize(d) {
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      const h = d.hull[y][x];
      if (d.top[y][x] && (!isHull(h) || isBridge(h))) d.top[y][x] = '';
      if (d.crew[y][x] && !isHull(h)) d.crew[y][x] = '';
      if (h === '<' && !hullAt(d, x + 1, y)) d.hull[y][x] = '';
      if (h === '>' && !hullAt(d, x - 1, y)) d.hull[y][x] = '';
      if (h === 'v' && !hullAt(d, x, y - 1)) d.hull[y][x] = '';
    }
  }

  function apply(x, y, button) {
    if (button === 2) {                       // botão direito: apaga tudo
      const each = (xx, yy) => { if (inRange(xx, yy)) { design.hull[yy][xx] = ''; design.top[yy][xx] = ''; design.crew[yy][xx] = ''; } };
      each(x, y); if (symmetry) each(GRID_W - 1 - x, y);
    } else {
      const t = toolDef(tool);
      if (!problem(design, t, x, y)) place(design, t, x, y);
      const mx = GRID_W - 1 - x;
      if (symmetry && mx !== x && !isBridge(t.part) && !problem(design, t, mx, y)) place(design, t, mx, y);
    }
    sanitize(design);
  }

  /* --------------------------------------------------------------- análise */
  function analyze(d) {
    const cells = designCells(d);
    const stats = shipStats(cells);
    const errors = [], warnings = [];
    let bridges = 0, hulls = 0;
    for (const row of d.hull) for (const c of row) { if (isBridge(c)) bridges++; if (isHull(c)) hulls++; }
    if (!hulls) errors.push('Coloque algumas peças de casco na grade.');
    else {
      if (bridges === 0) errors.push('Falta a Ponte de Comando (obrigatória).');
      // conectividade do casco
      let sx = -1, sy = -1;
      outer: for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) if (isHull(d.hull[y][x])) { sx = x; sy = y; break outer; }
      const seen = new Set([sx + ',' + sy]), q = [[sx, sy]];
      while (q.length) {
        const [x, y] = q.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
          if (!seen.has(k) && hullAt(d, nx, ny)) { seen.add(k); q.push([nx, ny]); }
        }
      }
      if (seen.size !== hulls) errors.push('Há peças de casco soltas: todas precisam estar conectadas.');
    }
    const budget = Meta.budget();
    if (!freeMode && stats.cost > budget) errors.push(`Acima do orçamento (${stats.cost}/${budget}). Remova peças ou ganhe moedas em batalha.`);
    if (hulls && !stats.engines) warnings.push('Sem motor: o navio ficará parado, como uma fortaleza flutuante.');
    if (hulls && !stats.weapons) warnings.push('Sem armas: você não conseguirá afundar ninguém.');
    if (hulls && stats.engines && !(stats.lat + stats.rear)) warnings.push('Sem aletas: o navio derrapa nas curvas e vira devagar.');
    return { stats, errors, warnings, budget, ok: errors.length === 0 };
  }

  /* ----------------------------------------------------------------- undo */
  function pushUndo() {
    undoStack.push(JSON.stringify(design));
    if (undoStack.length > 60) undoStack.shift();
  }
  function undo() {
    if (!undoStack.length) return;
    design = JSON.parse(undoStack.pop());
    changed();
  }
  function changed() {
    Meta.design = design; Meta.save();
    render(); onChange(analyze(design));
  }

  /* --------------------------------------------------------------- desenho */
  function cellXY(x, y) { return [x * CELL + CELL / 2, MARGIN + y * CELL + CELL / 2]; }

  function render() {
    if (!canvas) return;
    const W = canvas.width, H = canvas.height;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#12456b'); g.addColorStop(1, '#0c2f4d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // grade
    ctx.strokeStyle = 'rgba(255,255,255,.09)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= GRID_W; x++) { ctx.moveTo(x * CELL + .5, MARGIN); ctx.lineTo(x * CELL + .5, MARGIN + GRID_H * CELL); }
    for (let y = 0; y <= GRID_H; y++) { ctx.moveTo(0, MARGIN + y * CELL + .5); ctx.lineTo(W, MARGIN + y * CELL + .5); }
    ctx.stroke();
    // eixo central
    ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(245,185,66,.35)';
    ctx.beginPath(); ctx.moveTo(W / 2, MARGIN); ctx.lineTo(W / 2, MARGIN + GRID_H * CELL); ctx.stroke();
    ctx.setLineDash([]);
    // rótulos proa/popa
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = 'bold 12px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('▲  PROA (frente)', W / 2, MARGIN / 2);
    ctx.fillText('▼  POPA (trás)', W / 2, MARGIN + GRID_H * CELL + MARGIN / 2 - 0.5);

    // corpos
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      const c = design.hull[y][x]; if (!c) continue;
      const [cx, cy] = cellXY(x, y);
      ctx.save(); ctx.translate(cx, cy); drawBase(ctx, c, CELL, { time }); ctx.restore();
    }
    // peças por cima
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      const c = design.top[y][x]; if (!c) continue;
      const [cx, cy] = cellXY(x, y);
      ctx.save(); ctx.translate(cx, cy); drawTop(ctx, c, CELL, { time }); ctx.restore();
    }
    // tripulação (círculos pequenos; escondidos dos inimigos na batalha)
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      const c = design.crew[y][x]; if (!c) continue;
      const [cx, cy] = cellXY(x, y);
      ctx.save(); ctx.translate(cx, cy); drawCrew(ctx, c, CELL, true); ctx.restore();
    }

    // pré-visualização
    if (hover) {
      const t = toolDef(tool);
      const cells = [[hover.x, hover.y]];
      const mx = GRID_W - 1 - hover.x;
      if (symmetry && mx !== hover.x && !isBridge(t.part)) cells.push([mx, hover.y]);
      for (const [x, y] of cells) {
        if (!inRange(x, y)) continue;
        const why = problem(design, t, x, y);
        const [cx, cy] = cellXY(x, y);
        ctx.save(); ctx.translate(cx, cy);
        if (!why && t.part) {
          ctx.globalAlpha = 0.6;
          if (t.layer === 'top') { drawBase(ctx, design.hull[y][x], CELL, {}); drawTop(ctx, t.part, CELL); }
          else { const code = t.layer === 'fin' ? finFor(design, t.part, x, y) : t.part; drawBase(ctx, code, CELL, {}); }
          ctx.globalAlpha = 1;
        } else if (!why && t.crew) { ctx.globalAlpha = 0.75; drawCrew(ctx, t.crew, CELL, true); ctx.globalAlpha = 1; }
        ctx.lineWidth = 2; ctx.strokeStyle = why ? '#ff5d5d' : (t.eraser ? '#ffb347' : '#3ecf8e');
        ctx.strokeRect(-CELL / 2 + 1, -CELL / 2 + 1, CELL - 2, CELL - 2);
        ctx.restore();
      }
    }
  }

  /* --------------------------------------------------------------- entrada */
  function cellFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) * canvas.width / r.width;
    const py = (e.clientY - r.top) * canvas.height / r.height;
    const x = Math.floor(px / CELL), y = Math.floor((py - MARGIN) / CELL);
    return inRange(x, y) ? { x, y } : null;
  }
  function hint(msg) { const el = document.getElementById('place-hint'); if (el) el.textContent = msg || ''; }

  function bind() {
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => {
      const c = cellFromEvent(e); if (!c) return;
      canvas.setPointerCapture(e.pointerId);
      pushUndo(); painting = e.button === 2 ? 2 : 1; lastKey = '';
      stroke(c);
    });
    canvas.addEventListener('pointermove', e => {
      const c = cellFromEvent(e); hover = c;
      if (c) {
        const t = toolDef(tool), why = problem(design, t, c.x, c.y);
        hint(why || '');
      } else hint('');
      if (painting && c) stroke(c); else render();
    });
    canvas.addEventListener('pointerup', () => { painting = false; });
    canvas.addEventListener('pointercancel', () => { painting = false; });
    canvas.addEventListener('pointerleave', () => { hover = null; hint(''); render(); });
  }
  function stroke(c) {
    const k = c.x + ',' + c.y;
    if (k === lastKey) return;
    lastKey = k;
    apply(c.x, c.y, painting);
    changed();
  }

  /* ----------------------------------------------------------- API pública */
  function mirrorLeftToRight() {
    pushUndo();
    const mid = (GRID_W - 1) / 2;
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      if (x < mid) {
        const mx = GRID_W - 1 - x;
        let h = design.hull[y][x];
        if (isBridge(h)) h = '#';
        design.hull[y][mx] = h === '<' ? '>' : h === '>' ? '<' : h;
        design.top[y][mx] = design.top[y][x];
        design.crew[y][mx] = design.crew[y][x];
      }
    }
    sanitize(design); changed();
  }

  function selectTool(key) {
    tool = key;
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.key === key));
    const t = toolDef(key);
    const chip = document.getElementById('tool-chip');
    if (chip) chip.textContent = '✎ ' + t.name + (t.cost ? ' · 🪙 ' + t.cost : '');
    document.getElementById('tool-info').innerHTML =
      `<strong>${t.name}</strong>${t.cost ? ` <span class="cost">🪙 ${t.cost}</span>` : ''}<p>${t.desc}</p>`;
    render();
  }

  function buildPalette() {
    const root = document.getElementById('palette-groups');
    root.innerHTML = '';
    const groups = [...new Set(TOOLS.map(t => t.group))];
    for (const gname of groups) {
      const sec = document.createElement('div'); sec.className = 'group';
      sec.innerHTML = `<h3>${gname}</h3>`;
      const row = document.createElement('div'); row.className = 'tools';
      for (const t of TOOLS.filter(t => t.group === gname)) {
        const b = document.createElement('button');
        b.className = 'tool'; b.dataset.key = t.key; b.title = t.desc;
        const cv = document.createElement('canvas'); cv.width = cv.height = 44;
        const c2 = cv.getContext('2d');
        c2.translate(22, 22);
        if (t.eraser) {
          c2.fillStyle = '#e8eef5'; c2.font = '26px sans-serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle'; c2.fillText('🧽', 0, 1);
        } else if (t.crew) {
          const cr = CREW[t.crew];
          c2.fillStyle = 'rgba(18,28,40,.9)'; c2.strokeStyle = cr.col; c2.lineWidth = 2.5; c2.beginPath(); c2.arc(0, 0, 16, 0, Math.PI * 2); c2.fill(); c2.stroke();
          c2.fillStyle = '#fff'; c2.font = '20px "Segoe UI Emoji","Segoe UI",sans-serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle'; c2.fillText(cr.icon, 0, 2);
        } else {
          const sz = 34;
          if (t.layer === 'top') drawBase(c2, '#', sz, {});
          if (t.layer === 'fin') { /* fica solta */ }
          if (t.layer === 'top') drawTop(c2, t.part, sz); else drawBase(c2, t.part, sz, { time: 0.5 });
        }
        b.appendChild(cv);
        const sp = document.createElement('span');
        sp.innerHTML = `<b>${t.name}</b><i>${t.cost ? '🪙 ' + t.cost : 'grátis'}</i>`;
        b.appendChild(sp);
        b.addEventListener('click', () => selectTool(t.key));
        row.appendChild(b);
      }
      sec.appendChild(row); root.appendChild(sec);
    }
  }

  function buildPresets() {
    const root = document.getElementById('presets');
    root.innerHTML = '';
    for (const p of PRESETS) {
      const cost = shipStats(designCells(p.design)).cost;
      const b = document.createElement('button');
      b.className = 'btn small'; b.innerHTML = `${p.name} <small>🪙 ${cost}</small>`;
      b.title = p.role + ' (poder ' + p.power + ')';
      b.addEventListener('click', () => { pushUndo(); design = cloneDesign(p.design); changed(); });
      root.appendChild(b);
    }
  }

  function init(cb) {
    onChange = cb;
    canvas = document.getElementById('builder'); ctx = canvas.getContext('2d');
    canvas.width = GRID_W * CELL; canvas.height = GRID_H * CELL + MARGIN * 2;
    design = Meta.design ? cloneDesign(Meta.design) : cloneDesign(PRESETS.find(p => p.id === 'corveta').design);
    sanitize(design);
    buildPalette(); buildPresets(); bind(); selectTool('#');
    document.getElementById('btn-undo').onclick = undo;
    document.getElementById('btn-clear').onclick = () => { pushUndo(); design = emptyDesign(); changed(); };
    document.getElementById('btn-mirror').onclick = mirrorLeftToRight;
    document.getElementById('chk-sym').onchange = e => { symmetry = e.target.checked; render(); };
    document.getElementById('chk-free').onchange = e => { freeMode = e.target.checked; changed(); };
    document.getElementById('btn-export').onclick = () => {
      const code = btoa(unescape(encodeURIComponent(JSON.stringify(design))));      // UTF-8 seguro (peças com letras gregas)
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => alert('Código do navio copiado! Guarde ou envie para um amigo.'), () => prompt('Copie o código:', code));
      else prompt('Copie o código:', code);
    };
    document.getElementById('btn-import').onclick = () => {
      const code = prompt('Cole o código de um navio:');
      if (!code) return;
      try {
        const raw = atob(code.trim());
        let d; try { d = JSON.parse(decodeURIComponent(escape(raw))); } catch (e2) { d = JSON.parse(raw); }       // códigos antigos eram ASCII puro
        if (!d.hull || !d.top || d.hull.length !== GRID_H || d.hull[0].length !== GRID_W) throw new Error();
        pushUndo(); design = normalizeDesign(d); sanitize(design); changed();
      } catch (e) { alert('Código inválido.'); }
    };
    window.addEventListener('keydown', e => {
      if (document.getElementById('screen-yard').classList.contains('hidden')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    });
    (function tick() { time += 0.016; if (!document.getElementById('screen-yard').classList.contains('hidden')) render(); requestAnimationFrame(tick); })();
    changed();
  }

  return {
    init, render, analyze: () => analyze(design),
    getDesign: () => cloneDesign(design),
    isFree: () => freeMode,
    reset: () => {
      undoStack = []; freeMode = false; document.getElementById('chk-free').checked = false;
      design = cloneDesign(PRESETS.find(p => p.id === 'corveta').design);
      buildPresets(); changed();
    },
    refresh: () => { buildPresets(); changed(); },
  };
})();
