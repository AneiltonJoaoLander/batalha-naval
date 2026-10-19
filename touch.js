'use strict';
/* =====================================================================
   CONTROLES DE TOQUE (celular/tablet)
   Esquerda: joystick de movimento (aponta para onde quer ir).
   Direita: joystick de mira (empurrar = mirar e atirar; distância = alcance do morteiro).
   Botão: torpedos e mísseis. ❚❚: pausa.
   ===================================================================== */
const Touch = {
  enabled: false, root: null,
  move: { x: 0, y: 0, m: 0, id: null },
  aim: { x: 0, y: -1, m: 0, id: null, last: { x: 0, y: -1 }, dist: 450, used: false },
  torp: false,

  init() {
    this.enabled = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
    document.body.classList.toggle('touch', this.enabled);
    this.root = document.getElementById('touch');
    if (!this.root) return;
    const R = 56;
    const bindStick = (id, st) => {
      const el = document.getElementById(id), knob = el.querySelector('.knob');
      const set = e => {
        const r = el.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }
        st.x = dx / R; st.y = dy / R; st.m = Math.min(1, d / R);
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      };
      el.addEventListener('pointerdown', e => {
        e.preventDefault(); st.id = e.pointerId;
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ponteiro sintético: segue sem captura */ }
        SFX.init(); set(e);
      });
      el.addEventListener('pointermove', e => { if (e.pointerId === st.id) set(e); });
      const end = e => { if (e.pointerId !== st.id) return; st.id = null; st.m = 0; st.x = st.y = 0; knob.style.transform = ''; };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    };
    bindStick('stick-move', this.move);
    bindStick('stick-aim', this.aim);
    const tb = document.getElementById('tbtn-torp');
    tb.addEventListener('pointerdown', e => { e.preventDefault(); this.torp = true; tb.classList.add('on'); SFX.init(); });
    const off = () => { this.torp = false; tb.classList.remove('on'); };
    tb.addEventListener('pointerup', off); tb.addEventListener('pointercancel', off); tb.addEventListener('pointerleave', off);
    document.getElementById('tbtn-pause').addEventListener('click', () => Battle.togglePause());
    document.addEventListener('gesturestart', e => e.preventDefault());      // sem zoom por pinça
  },

  /** liga/desliga a camada de toque; tenta tela cheia e paisagem */
  show(on) {
    if (!this.enabled || !this.root) return;
    this.root.classList.toggle('hidden', !on);
    this.move.id = this.aim.id = null; this.move.m = this.aim.m = 0; this.torp = false;
    if (on) {
      try {
        const el = document.documentElement;
        const p = el.requestFullscreen ? el.requestFullscreen() : null;
        if (p && p.then) p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
      } catch (e) { /* sem tela cheia: segue normal */ }
    } else {
      try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); } catch (e) { /* ignore */ }
    }
  },

  /** sobrepõe a entrada do teclado/mouse quando há dedos nos joysticks */
  apply(p, i, B) {
    const mv = this.move, am = this.aim;
    if (mv.id !== null) {
      if (mv.m > 0.12) {
        const diff = angDiff(Math.atan2(mv.x, -mv.y), p.ang);
        i.steer = clamp(diff * 2.5, -1, 1);
        i.throttle = mv.m * (Math.abs(diff) > 1.2 ? 0.3 : 1);
      } else { i.steer = 0; i.throttle = 0; }
    }
    if (am.id !== null && am.m > 0.1) { am.last = { x: am.x, y: am.y }; am.dist = 150 + am.m * 750; am.used = true; }
    if (am.used || am.id !== null) {
      const l = am.last, n = Math.hypot(l.x, l.y) || 1;
      i.aimX = p.x + l.x / n * am.dist; i.aimY = p.y + l.y / n * am.dist;
      i.fireMain = am.id !== null && am.m > 0.3;
      B.mouse.x = B.W / 2 + (i.aimX - B.cam.x); B.mouse.y = B.H / 2 + (i.aimY - B.cam.y);
    } else if (this.enabled && !B.mouse.moved) {                           // ainda sem mira: aponta para a proa
      const fx = Math.sin(p.ang), fy = -Math.cos(p.ang);
      i.aimX = p.x + fx * 450; i.aimY = p.y + fy * 450;
      B.mouse.x = B.W / 2 + (i.aimX - B.cam.x); B.mouse.y = B.H / 2 + (i.aimY - B.cam.y);
    }
    if (this.torp) { i.fireTorp = true; i.fireMissile = true; }
  },
};
