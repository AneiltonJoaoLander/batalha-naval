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
  hideOverlay() { $('overlay').classList.add('hidden'); },
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
  Battle.start(Builder.getDesign(), 1);
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
