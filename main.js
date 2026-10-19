'use strict';
/* =====================================================================
   LIGAÇÃO ENTRE AS TELAS, PAINEL DE ESTATÍSTICAS E OVERLAYS
   ===================================================================== */
const $ = id => document.getElementById(id);

const UI = {
  show(which) {
    $('screen-yard').classList.toggle('hidden', which !== 'yard');
    $('screen-battle').classList.toggle('hidden', which !== 'battle');
    $('screen-online').classList.toggle('hidden', which !== 'online');
  },
  overlay({ title, html, buttons }) {
    $('ov-title').textContent = title;
    $('ov-body').innerHTML = html;
    const box = $('ov-btns'); box.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'btn big' + (b.primary ? ' primary' : '');
      el.textContent = b.label; el.onclick = b.onClick;
      box.appendChild(el);
    }
    $('overlay').classList.remove('hidden');
  },
  hideOverlay() { $('overlay').classList.add('hidden'); const cd = document.querySelector('#overlay .card'); if (cd) cd.classList.remove('host'); },
  banner(title, sub) {
    const b = $('banner');
    b.querySelector('h2').textContent = title; b.querySelector('p').textContent = sub || '';
    b.classList.remove('hidden'); b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(UI._bt); UI._bt = setTimeout(() => b.classList.add('hidden'), 2600);
  },
  toYard() {
    Battle.stop(); UI.hideOverlay(); Touch.show(false); UI.show('yard');
    refreshHeader(); Builder.refresh();
  },
};

function refreshHeader() {
  $('coins').textContent = Meta.coins;
  $('best').textContent = Meta.best;
}

function bar(label, value, text, pct, cls = '') {
  return `<div class="stat"><div class="stat-head"><span>${label}</span><b>${text}</b></div>
    <div class="meter"><i class="${cls}" style="width:${clamp(pct, 0, 1) * 100}%"></i></div></div>`;
}

function renderStats(r) {
  const s = r.stats, over = !Builder.isFree() && s.cost > r.budget;
  $('cost-box').innerHTML = `<div class="cost-box ${over ? 'over' : ''}">
      <span>Custo do navio</span><b>🪙 ${s.cost} / ${Builder.isFree() ? '∞' : r.budget}</b>
      <div class="meter"><i class="${over ? 'bad' : 'amber'}" style="width:${Builder.isFree() ? 0 : clamp(s.cost / r.budget, 0, 1) * 100}%"></i></div>
    </div>`;
  $('stats-body').innerHTML =
    bar('Casco total', s.hp, s.hp.toFixed(0) + ' pts', s.hp / 350, 'good') +
    bar('Peso', s.mass, s.mass.toFixed(0), s.mass / 150) +
    bar('Velocidade', s.maxSpeed, (s.maxSpeed / 5).toFixed(0) + ' nós', s.maxSpeed / 250, 'blue') +
    bar('Manobrabilidade', s.turn, s.turn.toFixed(1) + ' rad/s', s.turn / 2.6, 'blue') +
    bar('Aderência (anti-derrapagem)', s.grip, s.grip.toFixed(1), s.grip / 4.5, 'blue') +
    bar('Poder de fogo', s.dps, s.dps.toFixed(0) + ' dps', s.dps / 45, 'red') +
    (s.shield ? bar('Escudo', s.shield, s.shield.toFixed(0) + ' pts', s.shield / 80, 'blue') : '') +
    `<div class="counts">${[
      ['🎯', s.cannons, 'Canhões'], ['💣', s.mortars, 'Morteiros'], ['🔫', s.mgs, 'Metralhadoras'],
      ['🚀', s.torps, 'Torpedos'], ['🎇', s.missiles, 'Mísseis'], ['⚙', s.engines, 'Motores'],
      ['◣', s.lat, 'Aletas laterais'], ['▼', s.rear, 'Aletas traseiras'], ['✚', s.repairs, 'Reparos'],
      ['🛡', s.shields, 'Escudos'], ['📡', s.pd, 'Defesa pontual'], ['💨', s.thrusters, 'Propulsores laterais'],
    ].filter(c => c[1] > 0).map(c => `<span title="${c[2]}">${c[0]} ${c[1]}</span>`).join('')}</div>`;
  $('messages').innerHTML =
    r.errors.map(m => `<div class="msg err">⛔ ${m}</div>`).join('') +
    r.warnings.map(m => `<div class="msg warn">⚠ ${m}</div>`).join('') +
    (r.ok && !r.warnings.length ? '<div class="msg ok">✔ Navio pronto para a batalha!</div>' : '');
  const btn = $('btn-battle');
  btn.disabled = !r.ok;
  btn.textContent = r.ok ? '⚔ Ir para a batalha' : 'Corrija o navio para batalhar';
}

function startCampaign() {
  const r = Builder.analyze();
  if (!r.ok) return;
  UI.show('battle');
  Touch.show(true);
  Battle.start(Builder.getDesign(), Meta.bots.startWave || 1);
}

/* ---------------------------------------------------------------- janela de Bots */
const DIFF_DESC = {
  facil: 'Erram bastante, recarregam devagar e enxergam menos longe.',
  normal: 'Ficam mais fortes a cada onda (padrão da campanha).',
  dificil: 'Miram bem e recarregam no tempo normal.',
  mestre: 'Quase não erram, recarregam mais rápido e enxergam mais longe.',
};
function openBots() {
  const B = Meta.bots, modal = $('modal-bots');
  const pool = PRESETS.map(p => ({ id: p.id, name: p.name, power: p.power })).concat([{ id: 'meu', name: 'Clone do meu navio', power: 0 }]);
  $('bots-diff').innerHTML = Object.keys(BOT_DIFFS).map(k => `<option value="${k}">${BOT_DIFFS[k].name}</option>`).join('');
  $('bots-diff').value = B.diff; $('bots-mult').value = String(B.mult);
  $('bots-wave').innerHTML = Array.from({ length: 20 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  $('bots-wave').value = String(B.startWave);
  const showDesc = () => { $('bots-diff-desc').textContent = DIFF_DESC[B.diff] || ''; };
  const sum = () => {
    const tot = Object.values(B.skirmish).reduce((a, b) => a + b, 0);
    $('bots-sum').textContent = tot ? `Escaramuça: ${tot} bot(s) · ${BOT_DIFFS[B.diff].name}` : 'Escaramuça: adicione ao menos 1 bot.';
    $('bots-skirm-start').disabled = !tot;
  };
  const buildAllowed = () => {
    $('bots-allowed').innerHTML = pool.map(p => `<label class="chk"><input type="checkbox" data-id="${p.id}" ${!B.allowed || B.allowed.includes(p.id) ? 'checked' : ''}> ${p.name} ${p.power ? `<small>poder ${p.power}</small>` : ''}</label>`).join('');
    $('bots-allowed').querySelectorAll('input').forEach(i => i.onchange = () => {
      const ids = [...$('bots-allowed').querySelectorAll('input:checked')].map(x => x.dataset.id);
      B.allowed = ids.length === pool.length ? null : ids; Meta.save();
    });
  };
  const buildSkirm = () => {
    $('bots-skirm').innerHTML = pool.map(p => `<div class="step"><span>${p.name}</span><button data-id="${p.id}" data-d="-1">−</button><b>${B.skirmish[p.id] || 0}</b><button data-id="${p.id}" data-d="1">+</button></div>`).join('');
    $('bots-skirm').querySelectorAll('button').forEach(b => b.onclick = () => {
      const v = clamp((B.skirmish[b.dataset.id] || 0) + (+b.dataset.d), 0, 6);
      if (v) B.skirmish[b.dataset.id] = v; else delete B.skirmish[b.dataset.id];
      Meta.save(); buildSkirm(); sum();
    });
  };
  $('bots-diff').onchange = () => { B.diff = $('bots-diff').value; Meta.save(); showDesc(); sum(); };
  $('bots-mult').onchange = () => { B.mult = +$('bots-mult').value; Meta.save(); };
  $('bots-wave').onchange = () => { B.startWave = +$('bots-wave').value; Meta.save(); };
  $('bots-all').onclick = () => { B.allowed = null; Meta.save(); buildAllowed(); };
  $('bots-none').onclick = () => { B.allowed = []; Meta.save(); buildAllowed(); };
  $('bots-close').onclick = () => modal.classList.add('hidden');
  $('bots-skirm-start').onclick = () => {
    const r = Builder.analyze();
    if (!r.ok) { alert('Corrija o navio antes de lutar:\n' + r.errors.join('\n')); return; }
    modal.classList.add('hidden'); UI.show('battle'); Touch.show(true);
    Battle.start(Builder.getDesign(), 1, { counts: Object.assign({}, B.skirmish), diff: B.diff, wave: 6 });
  };
  showDesc(); buildAllowed(); buildSkirm(); sum();
  modal.classList.remove('hidden');
}

function openOpts() {
  const modal = $('modal-opts'), rng = $('zoom-range');
  const cur = () => Meta.zoom || (window.innerWidth < 900 ? 0.75 : 1);
  const show = () => { rng.value = Math.round(cur() * 100); $('zoom-val').textContent = Math.round(cur() * 100) + '%'; };
  rng.oninput = () => { Meta.zoom = rng.value / 100; Meta.save(); $('zoom-val').textContent = rng.value + '%'; };
  $('zoom-reset').onclick = () => { Meta.zoom = 0; Meta.save(); show(); };
  $('opts-close').onclick = () => modal.classList.add('hidden');
  show(); modal.classList.remove('hidden');
}

window.addEventListener('DOMContentLoaded', () => {
  Meta.load();
  $('ver').textContent = 'v' + VERSION.replace(/\.0$/, '');
  Touch.init();
  Battle.init();
  Online.init();
  Builder.init(renderStats);
  refreshHeader();
  $('btn-battle').onclick = startCampaign;
  $('btn-online').onclick = () => Online.show();
  $('btn-bots').onclick = openBots;
  $('btn-opts').onclick = openOpts;
  $('btn-reset').onclick = () => {
    const msg = ['Resetar o jogo?', '', 'Isso apaga suas moedas, o recorde de ondas e o navio salvo, e volta ao navio inicial. Não dá para desfazer.'];
    if (!confirm(msg.join('\n'))) return;
    Meta.reset(); Builder.reset(); refreshHeader();
  };
});

/* PWA: instalável no celular e jogável offline (rede primeiro, cache como reserva) */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
