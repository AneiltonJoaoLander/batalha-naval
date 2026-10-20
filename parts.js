'use strict';
/* =====================================================================
   PEÇAS, ESTATÍSTICAS E DESENHO
   Um navio é uma grade (GRID_W x GRID_H) com duas camadas:
     hull[y][x] -> corpo: '#' casco, '=' reforçado, 'o' leve, '@' pesado, '%' reativo,
                          'B' ponte, 'b' ponte blindada,
                          '<' '>' aleta lateral, 'v' aleta traseira
     top[y][x]  -> peça montada em cima do casco: armas, motores, reparo
   A proa (frente) do navio aponta para CIMA da grade.
   ===================================================================== */

const VERSION = '1.8.0';
const GRID_W = 13;
const GRID_H = 17;
const BASE_BUDGET = 220;
const TAU = Math.PI * 2;

/* Dificuldades dos bots. null = escala com a onda (comportamento padrão da campanha). */
const BOT_DIFFS = {
  facil:   { name: 'Fácil',   inacc: 0.22,  reload: 1.7,  gate: 1.4, vis: 0.8 },
  normal:  { name: 'Normal',  inacc: null,  reload: null, gate: 1,   vis: 1 },
  dificil: { name: 'Difícil', inacc: 0.06,  reload: 1.0,  gate: 0.8, vis: 1 },
  mestre:  { name: 'Mestre',  inacc: 0.025, reload: 0.85, gate: 0.6, vis: 1.15 },
};

/* Visão: alcance normal, furtividade total a partir de STEALTH_FULL de cobertura,
   e distância em que qualquer navio é percebido a olho nu (REVEAL_NEAR). */
const VISION_BASE = 650;
const STEALTH_FULL = 0.6;
const REVEAL_NEAR = 170;

const HULL_CODES = new Set(['#', '=', 'o', '@', '%', 's', '1', '2', '3', '4', '5', 'B', 'b', 'U']);
const isHull = c => HULL_CODES.has(c);
const isBridge = c => c === 'B' || c === 'b' || c === 'U';
const DEEP = 0.6;                                   // profundidade (0..1) a partir da qual o submarino está submerso
const isFin = c => c === '<' || c === '>' || c === 'v';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** diferença de ângulo a-b normalizada para [-PI, PI] */
const angDiff = (a, b) => ((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI;

/* ------------------------------------------------------------- tripulação */
/** Grupos de pessoas (camada invisível ao inimigo). Dão bônus; se a célula que os abriga quebra, o bônus se perde. */
const CREW = {
  g: { name: 'Artilheiros', cost: 8, icon: '🎯', col: '#f5b942', desc: '+20% de cadência em todas as armas (o 2º grupo rende metade).' },
  m: { name: 'Maquinistas', cost: 8, icon: '⚙', col: '#9aa7b5', desc: '+15% de força nos motores.' },
  r: { name: 'Equipe de Avarias', cost: 8, icon: '🔧', col: '#4cc9ff', desc: 'Remenda furos (menos alagamento) e conserta lentamente as peças do navio.' },
  b: { name: 'Bombeiros', cost: 8, icon: '🧯', col: '#ff6a4d', desc: 'Apagam incêndios 3× mais rápido e seguram a propagação do fogo.' },
  t: { name: 'Timoneiros', cost: 8, icon: '🧭', col: '#7bd86a', desc: '+25% na velocidade de giro do navio.' },
  s: { name: 'Operadores de Sensores', cost: 8, icon: '📡', col: '#a87cff', desc: '+25% de alcance de visão, radar e sonar.' },
  f: { name: 'Fuzileiros', cost: 8, icon: '🗡', col: '#e8c46a', desc: '+40% de dano das armas de corpo a corpo e resistência a choque elétrico.' },
};

/* ---------------------------------------------------------------- peças */
const PARTS = {
  '#': { layer: 'hull', name: 'Casco', cost: 2, hp: 5, mass: 1,
    desc: 'Módulo básico do corpo do navio. Barato e leve. Junte vários para formar o casco.' },
  'o': { layer: 'hull', name: 'Casco Leve', cost: 1, hp: 2.5, mass: 0.5, soak: 0,
    desc: 'Madeira e chapa fina: baratíssimo e levíssimo, mas quebra fácil. Bom para lanchas rápidas.' },
  '=': { layer: 'hull', name: 'Casco Reforçado', cost: 5, hp: 14, mass: 2.2, soak: 0.2,
    desc: 'Placa de aço reforçada: aguenta bem mais tiros e reduz um pouco cada impacto.' },
  '@': { layer: 'hull', name: 'Blindagem Pesada', cost: 9, hp: 28, mass: 4.5, soak: 0.6,
    desc: 'Couraça grossa: quase imune a metralhadoras (reduz 0,6 de cada tiro). Muito pesada!' },
  '%': { layer: 'hull', name: 'Casco Reativo', cost: 7, hp: 12, mass: 2.2, soak: 0.1, blast: 0.5,
    desc: 'Blindagem reativa: recebe só metade do dano de explosões (torpedos, morteiros e mísseis).' },
  's': { layer: 'hull', name: 'Casco Furtivo', cost: 8, hp: 6, mass: 1.1, soak: 0.1, stealth: 1,
    desc: 'Casco absorvedor de radar e ruído. Com cobertura furtiva suficiente (60% do casco) o navio some do mapa, do sonar e dos mísseis.' },
  'B': { layer: 'hull', name: 'Ponte de Comando', cost: 10, hp: 16, mass: 1.5, soak: 0,
    desc: 'Obrigatória (só pode haver uma ponte). Se for destruída, o navio afunda. Proteja-a no meio do casco! Troque por uma Torre Submarina para criar um submarino.' },
  '1': { layer: 'hull', name: 'Casco Cerâmico', cost: 8, hp: 9, mass: 2, soak: 0.9, blast: 1.5,
    desc: 'Placas cerâmicas: quase imunes a metralhadoras (reduz 0,9 de cada tiro), mas racham com explosões (+50% de dano de torpedo, míssil e morteiro).' },
  '2': { layer: 'hull', name: 'Casco de Titânio', cost: 14, hp: 18, mass: 1.5, soak: 0.35,
    desc: 'Resistente e leve: o dobro da vida do casco comum com bem menos peso que a blindagem pesada.' },
  '3': { layer: 'hull', name: 'Casco Compartimentado', cost: 6, hp: 8, mass: 1.4, soak: 0.15, bulkhead: true,
    desc: 'Antepara estanque: quando uma peça ao lado é destruída, entra 60% menos água (alagamento).' },
  '4': { layer: 'hull', name: 'Casco Flutuante', cost: 3, hp: 4, mass: 0.4, float: true,
    desc: 'Núcleo de espuma: levíssimo e aumenta a flutuação, então o navio aguenta mais água antes de afundar.' },
  '5': { layer: 'hull', name: 'Casco Corta-fogo', cost: 7, hp: 8, mass: 1.6, soak: 0.2, fireproof: true,
    desc: 'Revestimento retardante: nunca pega fogo e impede que o fogo passe por ele.' },
  'U': { layer: 'hull', name: 'Torre Submarina', cost: 32, hp: 22, mass: 2.2, soak: 0.3, sub: true,
    desc: 'Troque a ponte por esta torre e o navio vira SUBMARINO: tecla V (ou botão ⬇) mergulha. Submerso ele some da vista, só leva torpedos/minas/cargas e só atira torpedos e minas. Gasta bateria (recarrega na superfície).' },
  'b': { layer: 'hull', name: 'Ponte Blindada', cost: 22, hp: 34, mass: 3, soak: 0.4,
    desc: 'Ponte de Comando com blindagem de combate: muito mais resistente. Conta como a ponte (só uma por navio).' },

  '<': { layer: 'fin', fin: 'lateral', name: 'Aleta Lateral', cost: 4, hp: 3, mass: 0.5,
    desc: 'Fica na lateral do casco (encostada em uma peça). Reduz a derrapagem e ajuda a fazer curvas.' },
  '>': { layer: 'fin', fin: 'lateral', name: 'Aleta Lateral', cost: 4, hp: 3, mass: 0.5, desc: '' },
  'v': { layer: 'fin', fin: 'rear', name: 'Aleta Traseira', cost: 5, hp: 3, mass: 0.6,
    desc: 'Leme na popa (atrás de uma peça de casco). Faz o navio virar bem mais rápido quando está em movimento.' },

  'c': { layer: 'top', kind: 'cannon', name: 'Canhão', cost: 15, hp: 3, mass: 1.5,
    dmg: 3.5, reload: 0.9, speed: 480, range: 560, shots: 1, turn: 2.6, spread: 0.012,
    desc: 'Torre giratória que mira no cursor do mouse. Dano médio, alcance longo. (Botão esquerdo)' },
  'd': { layer: 'top', kind: 'cannon', name: 'Canhão Duplo', cost: 28, hp: 4, mass: 2.4,
    dmg: 3.5, reload: 1.0, speed: 470, range: 560, shots: 2, turn: 2.2, spread: 0.02,
    desc: 'Dois canos na mesma torre: dispara duas balas por salva. (Botão esquerdo)' },
  'C': { layer: 'top', kind: 'cannon', name: 'Canhão Pesado', cost: 34, hp: 5, mass: 3.6,
    dmg: 8, reload: 2.2, speed: 520, range: 720, shots: 1, turn: 1.5, spread: 0.01,
    desc: 'Calibre grosso: dano alto e alcance longo, mas recarrega devagar e gira lentamente. (Botão esquerdo)' },
  'R': { layer: 'top', kind: 'cannon', name: 'Canhão Elétrico', cost: 58, hp: 4, mass: 3, pierce: 3,
    dmg: 14, reload: 4, speed: 1100, range: 1100, shots: 1, turn: 1.8, spread: 0,
    desc: 'Projétil hipersônico que atravessa até 4 peças em linha, perdendo força a cada uma. (Botão esquerdo)' },
  'M': { layer: 'top', kind: 'mortar', name: 'Morteiro', cost: 26, hp: 3, mass: 2,
    dmg: 4.5, reload: 3.2, speed: 260, range: 800, minRange: 140, splash: 46, scatter: 14, turn: 2,
    desc: 'Dispara em arco e cai no ponto do cursor, explodindo em área. Passa por cima de tudo, mas não acerta perto demais. (Botão esquerdo)' },
  'N': { layer: 'top', kind: 'mortar', name: 'Morteiro Pesado', cost: 44, hp: 4, mass: 3.6,
    dmg: 8, reload: 5.5, speed: 240, range: 950, minRange: 180, splash: 62, scatter: 20, turn: 1.5,
    desc: 'Granada enorme com explosão de área grande. Lento, mas devastador contra navios parados. (Botão esquerdo)' },
  'm': { layer: 'top', kind: 'mg', name: 'Metralhadora', cost: 10, hp: 2, mass: 0.8, bullet: 'bullet',
    dmg: 0.8, reload: 0.1, speed: 620, range: 300, shots: 1, turn: 7, spread: 0.07,
    desc: 'Atira sozinha no inimigo mais próximo ao alcance. Pouco dano por tiro, mas muito rápida.' },
  'q': { layer: 'top', kind: 'mg', name: 'Metralhadora Pesada', cost: 18, hp: 3, mass: 1.4, bullet: 'heavy',
    dmg: 1.7, reload: 0.16, speed: 640, range: 340, shots: 1, turn: 5, spread: 0.06,
    desc: 'Calibre .50: mais alcance e o dobro de dano por tiro. Atira sozinha no inimigo mais próximo.' },
  'k': { layer: 'top', kind: 'mg', name: 'Metralhadora Giratória', cost: 28, hp: 3, mass: 2, bullet: 'bullet',
    dmg: 0.75, reload: 0.045, speed: 660, range: 280, shots: 1, turn: 4, spread: 0.11,
    desc: 'Minigun: despeja mais de 20 tiros por segundo. Terrível de perto, imprecisa de longe.' },
  'f': { layer: 'top', kind: 'mg', name: 'Lança-chamas', cost: 20, hp: 2, mass: 1.2, bullet: 'flame',
    dmg: 0.5, reload: 0.05, speed: 320, range: 130, shots: 1, turn: 4, spread: 0.22,
    desc: 'Jato de fogo de alcance curtíssimo. Derrete casco leve em segundos; blindagem pesada ignora quase tudo.' },
  't': { layer: 'top', kind: 'torp', name: 'Torpedo', cost: 18, hp: 2, mass: 1.2,
    dmg: 9, reload: 3.5, speed: 230, range: 700, splash: 36,
    desc: 'Dispara reto para a proa. Lento, mas explode em área com dano enorme. (Espaço ou botão direito)' },
  'a': { layer: 'top', kind: 'torp', name: 'Torpedo Guiado', cost: 30, hp: 2, mass: 1.5,
    dmg: 8, reload: 5, speed: 210, range: 850, splash: 34, turn: 1.5, shots: 1,
    desc: 'Procura o inimigo mais próximo do cursor (precisa estar detectado). Mais lento, mas curva. O Bloqueador e a Defesa Pontual atrapalham. (Espaço ou botão direito)' },
  'i': { layer: 'top', kind: 'torp', name: 'Torpedo Pesado', cost: 34, hp: 3, mass: 2.4,
    dmg: 16, reload: 6.5, speed: 170, range: 650, splash: 50, shots: 1,
    desc: 'Ogiva enorme com explosão grande. Lento e recarrega devagar. (Espaço ou botão direito)' },
  'l': { layer: 'top', kind: 'torp', name: 'Torpedo Supercavitante', cost: 26, hp: 2, mass: 1.2,
    dmg: 6, reload: 3, speed: 430, range: 800, splash: 28, shots: 1,
    desc: 'Velocidade altíssima: difícil de desviar. Dano menor. (Espaço ou botão direito)' },
  'y': { layer: 'top', kind: 'torp', name: 'Salva Tripla', cost: 42, hp: 3, mass: 2,
    dmg: 7, reload: 5.5, speed: 230, range: 700, splash: 32, shots: 3, spread: 0.14,
    desc: 'Dispara 3 torpedos em leque de uma vez. Ótimo contra alvos que desviam. (Espaço ou botão direito)' },
  'u': { layer: 'top', kind: 'missile', name: 'Míssil Guiado', cost: 32, hp: 2, mass: 1.6,
    dmg: 7, reload: 4.5, speed: 250, range: 800, splash: 30, turn: 2.4,
    desc: 'Sai para a proa e persegue o inimigo mais perto do cursor. Pode ser derrubado por defesa pontual. (Espaço ou botão direito)' },

  'e': { layer: 'top', kind: 'engine', name: 'Motor', cost: 12, hp: 3, mass: 1.3, thrust: 55,
    desc: 'Empurra o navio para frente. Coloque na popa, sobre o casco. Quanto mais motores, mais rápido.' },
  'E': { layer: 'top', kind: 'engine', name: 'Motor Turbo', cost: 24, hp: 3, mass: 2, thrust: 115,
    desc: 'Motor potente (o dobro de força). Ideal para navios grandes e pesados.' },
  'V': { layer: 'top', kind: 'engine', name: 'Motor Elétrico', cost: 22, hp: 3, mass: 1.6, thrust: 62, electric: true, silent: true,
    desc: 'Silencioso (o sonar passivo só ouve de perto) e rende 100% mesmo submerso. Os motores a diesel perdem 45% da força submersos.' },
  'T': { layer: 'top', kind: 'engine', name: 'Turbina a Gás', cost: 36, hp: 3, mass: 2.4, thrust: 150,
    desc: 'Muita força para pouco peso. Barulhenta e com chama azul.' },
  'j': { layer: 'top', kind: 'engine', name: 'Hidrojato', cost: 20, hp: 3, mass: 1.5, thrust: 85, turnBonus: 0.12,
    desc: 'Jato de água: força média e ainda ajuda o navio a virar mais rápido.' },
  'K': { layer: 'top', kind: 'engine', name: 'Reator Nuclear', cost: 95, hp: 6, mass: 6, thrust: 380, electric: true, nuclear: true,
    desc: 'Potência enorme, rende 100% submerso e dá bateria infinita ao submarino. Pesado e caríssimo.' },
  'W': { layer: 'top', kind: 'engine', name: 'Motor Pesado', cost: 48, hp: 5, mass: 3.2, thrust: 230,
    desc: 'Dois bocais, força enorme: para encouraçados e blindados que precisam sair do lugar.' },
  'p': { layer: 'top', kind: 'thruster', name: 'Propulsor Lateral', cost: 9, hp: 2, mass: 0.7, turnBonus: 0.3,
    desc: 'Pequeno jato de manobra: aumenta a velocidade de giro do navio, mesmo em baixa velocidade.' },
  'G': { layer: 'top', kind: 'shield', name: 'Gerador de Escudo', cost: 34, hp: 3, mass: 2.2, cap: 22, regen: 2.5,
    desc: 'Campo de energia: absorve 22 pontos de dano de qualquer tipo e recarrega depois de 3 s sem apanhar. Vários somam.' },
  'D': { layer: 'top', kind: 'pd', name: 'Defesa Pontual', cost: 26, hp: 2, mass: 1.2, range: 190, reload: 0.5,
    desc: 'Torre automática que derruba mísseis, torpedos e granadas de morteiro que se aproximam.' },
  'w': { layer: 'top', kind: 'periscope', name: 'Periscópio', cost: 18, hp: 2, mass: 0.6, vision: 650,
    desc: 'Submerso você enxerga só 350. Com um periscópio a visão submersa volta a 650.' },
  'n': { layer: 'top', kind: 'ballast', name: 'Tanque de Lastro', cost: 20, hp: 3, mass: 1.5,
    desc: 'Mergulha e emerge 50% mais rápido (até 2 tanques).' },
  'z': { layer: 'top', kind: 'battery', name: 'Bateria Extra', cost: 22, hp: 3, mass: 2,
    desc: '+35 s de mergulho cada (até 3). A bateria base dura 60 s e recarrega na superfície.' },
  'h': { layer: 'top', kind: 'mine', name: 'Lançador de Minas', cost: 26, hp: 2, mass: 1.4,
    dmg: 14, reload: 5, splash: 52, arm: 3, life: 45,
    desc: 'Solta uma mina atrás do navio (tecla F ou botão 💣). Fica parada, invisível ao inimigo, e explode em quem encostar. Pega até submarinos.' },
  'g': { layer: 'top', kind: 'depth', name: 'Cargas de Profundidade', cost: 28, hp: 2, mass: 1.4,
    dmg: 14, dmgSurf: 4, reload: 3.5, speed: 200, range: 380, minRange: 40, splash: 64,
    desc: 'Lança cargas no ponto do cursor que explodem no fundo: devastadoras contra submarinos submersos, fracas contra navios. (Botão esquerdo)' },
  '&': { layer: 'top', kind: 'plate', name: 'Placa de Aço', cost: 8, hp: 14, mass: 2.4, soak: 0.3,
    desc: 'Blindagem de convés: absorve os tiros antes do casco (reduz 0,3 de cada um). Ocupa o lugar de uma arma.' },
  '$': { layer: 'top', kind: 'plate', name: 'Placa Reativa', cost: 12, hp: 10, mass: 1.8, soak: 0.2, blast: 0.4,
    desc: 'Absorve explosões: recebe só 40% do dano de torpedos, mísseis, morteiros e minas.' },
  '+': { layer: 'top', kind: 'melee', mkind: 'spike', name: 'Espinhos', cost: 6, hp: 6, mass: 1, dmg: 2.5, tick: 0.3,
    desc: 'Corpo a corpo: fere qualquer inimigo que encoste (e quem você abalroar). Barato.' },
  '^': { layer: 'top', kind: 'melee', mkind: 'saw', name: 'Serra Giratória', cost: 22, hp: 5, mass: 1.5, dmg: 1.6, tick: 0.15,
    desc: 'Disco de corte: cerca de 10 de dano por segundo em quem estiver encostado.' },
  '!': { layer: 'top', kind: 'melee', mkind: 'ram', name: 'Aríete', cost: 18, hp: 14, mass: 3.5, soak: 0.5, dmg: 0.12, tick: 1.5,
    desc: 'Esporão de proa: no choque o dano cresce com a velocidade (até 20). Ponha na proa e acelere contra o inimigo!' },
  '~': { layer: 'top', kind: 'melee', mkind: 'hook', name: 'Gancho de Abordagem', cost: 14, hp: 5, mass: 1.2, dmg: 0.6, tick: 0.5,
    desc: 'Prende o inimigo: depois do contato ele fica 50% mais lento por 4 s e é puxado para você.' },
  '?': { layer: 'top', kind: 'melee', mkind: 'shock', name: 'Bobina de Choque', cost: 20, hp: 4, mass: 1.2, dmg: 0.8, tick: 0.5,
    desc: 'Descarga elétrica: dano baixo, mas atordoa por 4 s a tripulação inimiga (ela perde as funções) e drena o escudo.' },
  '0': { layer: 'top', kind: 'pump', name: 'Bomba de Esgoto', cost: 14, hp: 3, mass: 1.5, rate: 1.4,
    desc: 'Bombeia para fora a água que entra no navio (1,4 por segundo cada). Essencial contra alagamento.' },
  '*': { layer: 'top', kind: 'sprinkler', name: 'Sistema Anti-Incêndio', cost: 16, hp: 3, mass: 1.2, range: 3,
    desc: 'Apaga automaticamente os incêndios das peças em até 3 células.' },
  'I': { layer: 'top', kind: 'hangar', drone: 'recon', name: 'Drone de Reconhecimento', cost: 30, hp: 4, mass: 2.4, relaunch: 15, speed: 200, dhp: 5, fuel: 70, vision: 420,
    desc: 'Hangar de drone: voa até o cursor (no máximo 800 do navio) e amplia a sua visão (o drone enxerga 420). Metralhadoras inimigas o derrubam.' },
  'O': { layer: 'top', kind: 'hangar', drone: 'attack', name: 'Drone de Ataque', cost: 38, hp: 4, mass: 2.6, relaunch: 18, speed: 230, dhp: 6, fuel: 28, vision: 220, bomb: { dmg: 3, splash: 26, every: 1.4 },
    desc: 'Voa até inimigos detectados e joga bombas. Volta ao hangar quando o combustível acaba; se for abatido, demora para relançar.' },
  'P': { layer: 'top', kind: 'hangar', drone: 'kamikaze', name: 'Drone Suicida', cost: 26, hp: 3, mass: 2, relaunch: 12, speed: 290, dhp: 3, fuel: 14, vision: 200, boom: { dmg: 9, splash: 34 },
    desc: 'Lançado com Espaço/botão direito: mergulha no inimigo detectado mais próximo e explode.' },
  'A': { layer: 'top', kind: 'radar', name: 'Radar', cost: 22, hp: 2, mass: 1, bonus: 300,
    desc: 'Aumenta o alcance de visão normal em 300 (até 2 radares). Não enxerga navios furtivos.' },
  'S': { layer: 'top', kind: 'sonar', name: 'Sonar Passivo', cost: 28, hp: 2, mass: 1.2, range: 850,
    desc: 'Escuta o mar: detecta navios em até 850 mesmo no escuro, sem se denunciar. Não pega navios furtivos.' },
  'Y': { layer: 'top', kind: 'sonarA', name: 'Sonar Ativo', cost: 42, hp: 3, mass: 1.8, range: 1500, every: 4,
    desc: 'Pulso a cada 4 s: mostra todos em até 1500 por 2 s, mas revela a sua posição a quem estiver a 2200. Não pega navios furtivos.' },
  'Q': { layer: 'top', kind: 'stealthgen', name: 'Gerador Furtivo', cost: 40, hp: 3, mass: 2, cover: 8,
    desc: 'Equivale a 8 peças de casco furtivo na cobertura do navio. Combine com blindagem comum e ainda assim suma do radar.' },
  'J': { layer: 'top', kind: 'jammer', name: 'Bloqueador', cost: 30, hp: 2, mass: 1.2, range: 260,
    desc: 'Guerra eletrônica: mísseis que chegam a 260 perdem a guiagem e saem voando sem rumo.' },
  'Z': { layer: 'top', kind: 'loader', name: 'Carregador Automático', cost: 24, hp: 3, mass: 1.8,
    desc: 'Todas as armas recarregam 15% mais rápido (até 2 carregadores).' },
  'X': { layer: 'top', kind: 'fcs', name: 'Computador de Tiro', cost: 22, hp: 2, mass: 1,
    desc: 'Torres giram 25% mais rápido e morteiros espalham 30% menos (até 2 computadores).' },
  'r': { layer: 'top', kind: 'repair', name: 'Reparo', cost: 15, hp: 2, mass: 1, every: 1.4, radius: 3.2,
    desc: 'Equipe de reparos: recupera lentamente a vida das peças próximas durante a batalha.' },
};

/** ferramentas da paleta do estaleiro */
const TOOLS = [
  { key: 'o', part: 'o', group: 'Casco' },
  { key: '#', part: '#', group: 'Casco' },
  { key: '=', part: '=', group: 'Casco' },
  { key: '%', part: '%', group: 'Casco' },
  { key: '@', part: '@', group: 'Casco' },
  { key: '1', part: '1', group: 'Casco' },
  { key: '2', part: '2', group: 'Casco' },
  { key: '3', part: '3', group: 'Casco' },
  { key: '4', part: '4', group: 'Casco' },
  { key: '5', part: '5', group: 'Casco' },
  { key: 's', part: 's', group: 'Casco' },
  { key: '&', part: '&', group: 'Blindagem de convés' },
  { key: '$', part: '$', group: 'Blindagem de convés' },
  { key: 'B', part: 'B', group: 'Ponte' },
  { key: 'b', part: 'b', group: 'Ponte' },
  { key: 'U', part: 'U', group: 'Ponte' },
  { key: 'L', part: '<', group: 'Aletas' },
  { key: 'v', part: 'v', group: 'Aletas' },
  { key: 'c', part: 'c', group: 'Canhões' },
  { key: 'd', part: 'd', group: 'Canhões' },
  { key: 'C', part: 'C', group: 'Canhões' },
  { key: 'R', part: 'R', group: 'Canhões' },
  { key: 'M', part: 'M', group: 'Morteiros' },
  { key: 'N', part: 'N', group: 'Morteiros' },
  { key: 'm', part: 'm', group: 'Metralhadoras' },
  { key: 'q', part: 'q', group: 'Metralhadoras' },
  { key: 'k', part: 'k', group: 'Metralhadoras' },
  { key: 'f', part: 'f', group: 'Metralhadoras' },
  { key: '+', part: '+', group: 'Corpo a corpo' },
  { key: '^', part: '^', group: 'Corpo a corpo' },
  { key: '!', part: '!', group: 'Corpo a corpo' },
  { key: '~', part: '~', group: 'Corpo a corpo' },
  { key: '?', part: '?', group: 'Corpo a corpo' },
  { key: 't', part: 't', group: 'Torpedos e mísseis' },
  { key: 'a', part: 'a', group: 'Torpedos e mísseis' },
  { key: 'i', part: 'i', group: 'Torpedos e mísseis' },
  { key: 'l', part: 'l', group: 'Torpedos e mísseis' },
  { key: 'y', part: 'y', group: 'Torpedos e mísseis' },
  { key: 'u', part: 'u', group: 'Torpedos e mísseis' },
  { key: 'I', part: 'I', group: 'Drones' },
  { key: 'O', part: 'O', group: 'Drones' },
  { key: 'P', part: 'P', group: 'Drones' },
  { key: 'e', part: 'e', group: 'Propulsão' },
  { key: 'E', part: 'E', group: 'Propulsão' },
  { key: 'W', part: 'W', group: 'Propulsão' },
  { key: 'T', part: 'T', group: 'Propulsão' },
  { key: 'j', part: 'j', group: 'Propulsão' },
  { key: 'V', part: 'V', group: 'Propulsão' },
  { key: 'K', part: 'K', group: 'Propulsão' },
  { key: 'p', part: 'p', group: 'Propulsão' },
  { key: 'w', part: 'w', group: 'Submarino' },
  { key: 'n', part: 'n', group: 'Submarino' },
  { key: 'z', part: 'z', group: 'Submarino' },
  { key: 'h', part: 'h', group: 'Submarino' },
  { key: 'g', part: 'g', group: 'Submarino' },
  { key: '0', part: '0', group: 'Controle de avarias' },
  { key: '*', part: '*', group: 'Controle de avarias' },
  { key: 'r', part: 'r', group: 'Controle de avarias' },
  { key: 'A', part: 'A', group: 'Sensores e furtividade' },
  { key: 'S', part: 'S', group: 'Sensores e furtividade' },
  { key: 'Y', part: 'Y', group: 'Sensores e furtividade' },
  { key: 'Q', part: 'Q', group: 'Sensores e furtividade' },
  { key: 'G', part: 'G', group: 'Apoio' },
  { key: 'D', part: 'D', group: 'Apoio' },
  { key: 'J', part: 'J', group: 'Apoio' },
  { key: 'Z', part: 'Z', group: 'Apoio' },
  { key: 'X', part: 'X', group: 'Apoio' },
  { key: 'K:g', crew: 'g', group: 'Tripulação (invisível ao inimigo)' },
  { key: 'K:m', crew: 'm', group: 'Tripulação (invisível ao inimigo)' },
  { key: 'K:r', crew: 'r', group: 'Tripulação (invisível ao inimigo)' },
  { key: 'K:b', crew: 'b', group: 'Tripulação (invisível ao inimigo)' },
  { key: 'K:t', crew: 't', group: 'Tripulação (invisível ao inimigo)' },
  { key: 'K:s', crew: 's', group: 'Tripulação (invisível ao inimigo)' },
  { key: 'K:f', crew: 'f', group: 'Tripulação (invisível ao inimigo)' },
  { key: 'x', part: null, group: 'Ferramentas', eraser: true, name: 'Borracha', cost: 0,
    desc: 'Apaga a peça de cima; depois a tripulação; depois o casco. Botão direito apaga tudo na célula.' },
];
for (const t of TOOLS) {
  if (t.crew) { const c = CREW[t.crew]; t.name = c.name; t.cost = c.cost; t.desc = c.desc + ' Fica escondida dos inimigos.'; t.layer = 'crew'; }
  if (t.part) { const p = PARTS[t.part]; t.name = p.name; t.cost = p.cost; t.desc = p.desc; t.layer = p.layer; }
}

/* ------------------------------------------------------------ estatísticas */
/** cells: [{base, top}] com as peças VIVAS do navio */
function shipStats(cells) {
  const s = { mass: 0, hp: 0, cost: 0, thrust: 0, lat: 0, rear: 0, count: 0,
    cannons: 0, mortars: 0, mgs: 0, torps: 0, missiles: 0, engines: 0, repairs: 0,
    shields: 0, shield: 0, regen: 0, pd: 0, thrusters: 0, dps: 0,
    radars: 0, sonars: 0, sonarR: 0, pings: 0, pingR: 0, jammers: 0, loaders: 0, fcs: 0, stealthW: 0, hullCount: 0,
    sub: false, periscopes: 0, ballast: 0, batteries: 0, mines: 0, depths: 0, thrustSub: 0, silentThrust: 0, nuclear: false, turnBonus: 0,
    melee: 0, meleeKinds: {}, pumps: 0, sprinklers: 0, hangars: 0, droneKinds: {}, floats: 0, bulkheads: 0, crew: {}, crewCount: 0 };
  for (const c of cells) {
    const b = PARTS[c.base];
    s.mass += b.mass; s.hp += b.hp; s.cost += b.cost; s.count++;
    if (b.fin === 'lateral') s.lat++; else if (b.fin === 'rear') s.rear++;
    if (isHull(c.base)) { s.hullCount++; s.stealthW += b.stealth || 0; }
    if (b.sub) s.sub = true;
    if (b.float) s.floats++;
    if (b.bulkhead) s.bulkheads++;
    if (c.crew && CREW[c.crew]) { s.cost += CREW[c.crew].cost; s.crew[c.crew] = (s.crew[c.crew] || 0) + 1; s.crewCount++; }
    if (!c.top) continue;
    const t = PARTS[c.top];
    s.mass += t.mass; s.hp += t.hp; s.cost += t.cost;
    switch (t.kind) {
      case 'cannon': s.cannons++; s.dps += t.dmg * t.shots / t.reload; break;
      case 'mortar': s.mortars++; s.dps += t.dmg / t.reload * 0.6; break;
      case 'mg': s.mgs++; s.dps += t.dmg / t.reload * 0.6; break;
      case 'torp': s.torps++; s.dps += t.dmg / t.reload * 0.8; break;
      case 'missile': s.missiles++; s.dps += t.dmg / t.reload * 0.8; break;
      case 'shield': s.shields++; s.shield += t.cap; s.regen += t.regen; break;
      case 'pd': s.pd++; break;
      case 'thruster': s.thrusters++; break;
      case 'radar': s.radars++; break;
      case 'sonar': s.sonars++; s.sonarR = Math.max(s.sonarR, t.range); break;
      case 'sonarA': s.pings++; s.pingR = Math.max(s.pingR, t.range); break;
      case 'stealthgen': s.stealthW += t.cover; break;
      case 'jammer': s.jammers++; break;
      case 'loader': s.loaders++; break;
      case 'fcs': s.fcs++; break;
      case 'engine':
        s.engines++; s.thrust += t.thrust; s.thrustSub += t.thrust * (t.electric ? 1 : 0.55);
        if (t.silent) s.silentThrust += t.thrust;
        if (t.nuclear) s.nuclear = true;
        s.turnBonus += t.turnBonus || 0;
        break;
      case 'periscope': s.periscopes++; break;
      case 'ballast': s.ballast++; break;
      case 'battery': s.batteries++; break;
      case 'mine': s.mines++; s.dps += t.dmg / t.reload * 0.4; break;
      case 'depth': s.depths++; s.dps += t.dmg / t.reload * 0.3; break;
      case 'melee': s.melee++; s.meleeKinds[t.mkind] = (s.meleeKinds[t.mkind] || 0) + 1; s.dps += { spike: 4, saw: 9, ram: 5, hook: 1.5, shock: 2 }[t.mkind] || 0; break;
      case 'pump': s.pumps++; break;
      case 'sprinkler': s.sprinklers++; break;
      case 'hangar': s.hangars++; s.droneKinds[t.drone] = (s.droneKinds[t.drone] || 0) + 1; s.dps += t.drone === 'attack' ? 4 : t.drone === 'kamikaze' ? 3 : 0; break;
      case 'repair': s.repairs++; break;
    }
  }
  const m = Math.max(s.mass, 1);
  s.weapons = s.cannons + s.mortars + s.mgs + s.torps + s.missiles + s.mines + s.depths + s.melee + (s.droneKinds.attack || 0) + (s.droneKinds.kamikaze || 0);
  s.maxSpeed = Math.min(300, s.thrust / m * 45);          // px/s
  s.accel = s.maxSpeed * 0.25;                             // arrasto longitudinal = 0.25/s
  s.turn = (0.55 + 0.28 * s.lat + 0.5 * s.rear + 0.3 * s.thrusters + s.turnBonus) * clamp(Math.sqrt(25 / m), 0.45, 1.4); // rad/s
  s.grip = 0.6 + 0.9 * s.lat + 0.4 * s.rear;               // resistência à derrapagem
  // visão, sensores e furtividade
  s.vision = VISION_BASE + 300 * Math.min(2, s.radars);
  s.cover = s.hullCount ? Math.min(1, s.stealthW / s.hullCount) : 0;
  s.sig = clamp(1 - s.cover / STEALTH_FULL, 0, 1);         // 1 = totalmente visível, 0 = furtivo
  s.loadMul = Math.pow(0.85, Math.min(2, s.loaders));
  s.turnMul = 1 + 0.25 * Math.min(2, s.fcs);
  s.scatterMul = 1 - 0.3 * Math.min(2, s.fcs);
  // submarino: velocidade submersa, bateria, mergulho e ruído
  s.maxSpeedSub = Math.min(300, s.thrustSub / m * 45);
  s.accelSub = s.maxSpeedSub * 0.25;
  s.battery = s.sub ? 60 + 35 * Math.min(3, s.batteries) : 0;
  s.diveMul = 1 + 0.5 * Math.min(2, s.ballast);
  s.quiet = s.thrust ? 1 - 0.5 * (s.silentThrust / s.thrust) : 1;   // 1 = barulhento; o sonar passivo ouve menos longe quanto menor
  return s;
}

/* --------------------------------------------------------------- detecção */
/** o observa t? Ambos: {x, y, vision, sonar, ping, pingR, sig, reveal, revealR}.
    Compartilhada entre o cliente e o servidor (o servidor só envia quem você pode ver). */
function detects(o, t) {
  const d = Math.hypot(t.x - o.x, t.y - o.y);
  if (d < (t.sub ? 110 : REVEAL_NEAR)) return true;       // a olho nu, colado (submerso: bem mais perto)
  if (t.reveal && d < t.revealR) return true;             // acabou de atirar ou emitir pulso
  const sig = t.sig;
  if (!t.sub && d < o.vision * sig) return true;          // visão normal (submarino submerso não aparece)
  const q = t.quiet === undefined ? 1 : t.quiet;          // navio silencioso/parado é mais difícil de ouvir
  if (o.sonar && d < o.sonar * sig * q) return true;      // sonar passivo
  if (o.ping && d < o.pingR * sig) return true;           // pulso do sonar ativo
  return false;
}

/* ------------------------------------------------------------- projetos */
const emptyGrid = () => Array.from({ length: GRID_H }, () => Array(GRID_W).fill(''));
function emptyDesign() { return { hull: emptyGrid(), top: emptyGrid(), crew: emptyGrid() }; }
function cloneDesign(d) { return { hull: d.hull.map(r => r.slice()), top: d.top.map(r => r.slice()), crew: (d.crew || emptyGrid()).map(r => r.slice()) }; }
/** garante que projetos antigos (sem tripulação) tenham a camada */
function normalizeDesign(d) {
  if (!d.crew || d.crew.length !== GRID_H) d.crew = emptyGrid();
  return d;
}
/** versão sem a tripulação (o inimigo não pode ver onde ela fica) */
function stripCrew(d) { return { hull: d.hull, top: d.top }; }

/** monta um projeto a partir de linhas de texto, centralizado na grade */
function makeDesign(hullRows, topRows, crewRows) {
  const d = emptyDesign();
  const w = hullRows[0].length, h = hullRows.length;
  const ox = Math.floor((GRID_W - w) / 2), oy = Math.floor((GRID_H - h) / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = hullRows[y][x], b = topRows[y][x];
    if (a !== ' ') d.hull[oy + y][ox + x] = a;
    if (b !== ' ') d.top[oy + y][ox + x] = b;
    if (crewRows && crewRows[y][x] !== ' ') d.crew[oy + y][ox + x] = crewRows[y][x];
  }
  return d;
}

/** valida um projeto (usado pelo servidor). budget <= 0 ignora o custo. */
function validateDesign(d, budget, rules) {
  try {
    if (!d || !Array.isArray(d.hull) || !Array.isArray(d.top) || d.hull.length !== GRID_H || d.top.length !== GRID_H) return { ok: false, error: 'Grade inválida.' };
    let bridges = 0, hulls = 0;
    const at = (x, y) => (x >= 0 && y >= 0 && x < GRID_W && y < GRID_H) ? d.hull[y][x] : '';
    for (let y = 0; y < GRID_H; y++) {
      if (!Array.isArray(d.hull[y]) || d.hull[y].length !== GRID_W || !Array.isArray(d.top[y]) || d.top[y].length !== GRID_W) return { ok: false, error: 'Grade inválida.' };
      for (let x = 0; x < GRID_W; x++) {
        const h = d.hull[y][x], t = d.top[y][x];
        if (typeof h !== 'string' || typeof t !== 'string') return { ok: false, error: 'Grade inválida.' };
        if (h && (!PARTS[h] || PARTS[h].layer === 'top')) return { ok: false, error: 'Peça desconhecida no casco.' };
        if (t && (!PARTS[t] || PARTS[t].layer !== 'top')) return { ok: false, error: 'Peça desconhecida.' };
        if (t && (!isHull(h) || isBridge(h))) return { ok: false, error: 'Peça sem casco por baixo.' };
        if (isBridge(h)) bridges++;
        if (isHull(h)) hulls++;
        if (h === '<' && !isHull(at(x + 1, y))) return { ok: false, error: 'Aleta solta.' };
        if (h === '>' && !isHull(at(x - 1, y))) return { ok: false, error: 'Aleta solta.' };
        if (h === 'v' && !isHull(at(x, y - 1))) return { ok: false, error: 'Aleta solta.' };
      }
    }
    if (d.crew !== undefined) {
      if (!Array.isArray(d.crew) || d.crew.length !== GRID_H) return { ok: false, error: 'Tripulação inválida.' };
      for (let y = 0; y < GRID_H; y++) {
        if (!Array.isArray(d.crew[y]) || d.crew[y].length !== GRID_W) return { ok: false, error: 'Tripulação inválida.' };
        for (let x = 0; x < GRID_W; x++) {
          const c = d.crew[y][x];
          if (c && (typeof c !== 'string' || !CREW[c] || !isHull(d.hull[y][x]))) return { ok: false, error: 'Tripulação em posição inválida.' };
        }
      }
    }
    if (bridges !== 1) return { ok: false, error: 'O navio precisa de exatamente uma ponte.' };
    let sx = -1, sy = -1;
    outer: for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) if (isHull(d.hull[y][x])) { sx = x; sy = y; break outer; }
    const seen = new Set([sx + ',' + sy]), q = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = (x + dx) + ',' + (y + dy);
        if (!seen.has(k) && isHull(at(x + dx, y + dy))) { seen.add(k); q.push([x + dx, y + dy]); }
      }
    }
    if (seen.size !== hulls) return { ok: false, error: 'Casco desconectado.' };
    if (rules) {                                           // regras da sala (anfitrião): peças proibidas
      let sub = false, stealth = false, guided = false;
      for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
        const h = d.hull[y][x], t = d.top[y][x];
        if (h === 'U') sub = true;
        if (h === 's' || t === 'Q') stealth = true;
        if (t === 'u' || t === 'a') guided = true;
      }
      if (rules.allowSub === false && sub) return { ok: false, error: 'Submarinos não são permitidos nesta sala.' };
      if (rules.allowStealth === false && stealth) return { ok: false, error: 'Peças furtivas não são permitidas nesta sala.' };
      if (rules.allowGuided === false && guided) return { ok: false, error: 'Armas guiadas (míssil/torpedo guiado) não são permitidas nesta sala.' };
    }
    const stats = shipStats(designCells(d));
    if (budget > 0 && stats.cost > budget) return { ok: false, error: 'Navio acima do orçamento da sala (' + stats.cost + '/' + budget + ').', stats };
    return { ok: true, stats };
  } catch (e) { return { ok: false, error: 'Projeto inválido.' }; }
}

function designCells(d) {
  const out = [];
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
    if (d.hull[y][x]) out.push({ base: d.hull[y][x], top: d.top[y][x] || null, crew: (d.crew && d.crew[y][x]) || null });
  }
  return out;
}

/** power = peso do navio ao montar ondas de inimigos */
const PRESETS = [
  { id: 'lancha', name: 'Lancha', power: 1, minWave: 1, role: 'Rápida e barata: canhão leve e metralhadora.', design: makeDesign([
    '  #  ',
    ' ### ',
    '<#B#>',
    ' ### ',
    ' ### ',
    ' ### ',
    '  v  ',
  ], [
    '     ',
    '  m  ',
    '     ',
    '  c  ',
    '     ',
    ' e e ',
    '     ',
  ]) },
  { id: 'corveta', name: 'Corveta', power: 2, minWave: 1, role: 'Equilibrada: torpedo, canhão e reparo.', design: makeDesign([
    '   #   ',
    '  ###  ',
    '  #B#  ',
    '<#####>',
    ' ##### ',
    ' ##### ',
    '  ###  ',
    '  v v  ',
  ], [
    '   t   ',
    '  m m  ',
    '       ',
    '   c   ',
    '  r    ',
    ' e   e ',
    '   e   ',
    '       ',
  ]) },
  { id: 'fragata', name: 'Fragata', power: 4, minWave: 3, role: 'Média: torpedo, canhão duplo e turbo.', design: makeDesign([
    '   #   ',
    '  ###  ',
    '  ###  ',
    ' ##B## ',
    '<#####>',
    ' ##### ',
    ' ##### ',
    '<#####>',
    ' ##### ',
    '  ###  ',
    '  v v  ',
  ], [
    '   t   ',
    '   d   ',
    '       ',
    '       ',
    '  m m  ',
    '   r   ',
    '   c   ',
    '  m m  ',
    ' e   e ',
    '   E   ',
    '       ',
  ]) },
  { id: 'encouracado', name: 'Encouraçado', power: 8, minWave: 6, role: 'Pesado: blindado, muitos canhões e torpedo.', design: makeDesign([
    '    #    ',
    '   ###   ',
    '  #####  ',
    ' ####### ',
    '<=======>',
    ' ###B### ',
    ' ####### ',
    ' ####### ',
    '<#######>',
    ' ####### ',
    ' ####### ',
    '<=#####=>',
    ' ####### ',
    '  #####  ',
    '  v v v  ',
  ], [
    '    t    ',
    '   mdm   ',
    '    d    ',
    '  m   m  ',
    '         ',
    '         ',
    '   r r   ',
    '  m   m  ',
    '         ',
    '    d    ',
    '   c c   ',
    '         ',
    '  e e e  ',
    '  E   E  ',
    '         ',
  ]) },
  { id: 'gatling', name: 'Lancha Giratória', power: 1.5, minWave: 2, role: 'Casco leve com minigun: derrete quem chegar perto.', design: makeDesign([
    '  o  ',
    ' ooo ',
    '<oBo>',
    ' ooo ',
    ' ooo ',
    '  v  ',
  ], [
    '  k  ',
    '     ',
    '     ',
    '     ',
    ' e e ',
    '     ',
  ]) },
  { id: 'torpedeira', name: 'Torpedeira', power: 2, minWave: 2, role: 'Velocíssima, dois torpedos e quase sem proteção.', design: makeDesign([
    '  o  ',
    ' ooo ',
    ' oBo ',
    '<ooo>',
    ' ooo ',
    ' ooo ',
    '  o  ',
    '  v  ',
  ], [
    '  t  ',
    ' t t ',
    '     ',
    '  m  ',
    '     ',
    ' e e ',
    '  e  ',
    '     ',
  ]) },
  { id: 'brulote', name: 'Brulote', power: 2, minWave: 3, role: 'Proa blindada com lança-chamas: parte para cima de você.', design: makeDesign([
    '  =  ',
    ' === ',
    '<=B=>',
    ' === ',
    ' ### ',
    '  v  ',
  ], [
    '  f  ',
    ' f f ',
    '     ',
    '     ',
    ' eEe ',
    '     ',
  ]) },
  { id: 'canhoneira', name: 'Canhoneira', power: 3, minWave: 2, role: 'Canhão pesado na proa e metralhadoras laterais.', design: makeDesign([
    '   =   ',
    '  ###  ',
    ' ##### ',
    ' ##B## ',
    '<#####>',
    ' ##### ',
    ' ##### ',
    '  ###  ',
    '  v v  ',
  ], [
    '   C   ',
    '       ',
    ' m   m ',
    '       ',
    '       ',
    '   c   ',
    ' e   e ',
    '   e   ',
    '       ',
  ]) },
  { id: 'catamara', name: 'Catamarã', power: 3, minWave: 3, role: 'Dois cascos ligados por uma viga: ágil e com morteiro.', design: makeDesign([
    '  #   #  ',
    ' ##   ## ',
    ' ##   ## ',
    ' ####### ',
    ' ##=B=## ',
    ' ####### ',
    ' ##   ## ',
    '<##   ##>',
    ' vv   vv ',
  ], [
    '  c   c  ',
    ' m     m ',
    '         ',
    '    M    ',
    '         ',
    '    r    ',
    ' e     e ',
    ' e     e ',
    '         ',
  ]) },
  { id: 'barcaca', name: 'Barcaça de Morteiros', power: 3, minWave: 4, role: 'Lenta e larga: bombardeia de longe e chove granada.', design: makeDesign([
    ' ##### ',
    '<#####>',
    ' ##B## ',
    ' ##### ',
    ' ##### ',
    ' ##### ',
    '  vvv  ',
  ], [
    ' M   M ',
    '       ',
    '       ',
    '   N   ',
    '  m m  ',
    ' e e e ',
    '       ',
  ]) },
  { id: 'destroier', name: 'Destróier', power: 5, minWave: 5, role: 'Rápido, com torpedos, defesa pontual e canhões.', design: makeDesign([
    '   o   ',
    '  ooo  ',
    '  ###  ',
    '  ###  ',
    ' ##B## ',
    '<#####>',
    ' ##### ',
    ' ##### ',
    '<#####>',
    ' ##### ',
    '  ###  ',
    '  ###  ',
    '  v v  ',
  ], [
    '   m   ',
    '   c   ',
    '  t t  ',
    '       ',
    '       ',
    '  D m  ',
    '       ',
    '   c   ',
    ' m   m ',
    '       ',
    '  e e  ',
    '  E E  ',
    '       ',
  ]) },
  { id: 'monitor', name: 'Monitor Blindado', power: 6, minWave: 6, role: 'Couraça pesada: imune a metralhadoras, canhões pesados.', design: makeDesign([
    '  @@@  ',
    ' @@@@@ ',
    ' @@b@@ ',
    '<@@@@@>',
    ' @@@@@ ',
    ' @@@@@ ',
    ' ##### ',
    '  ###  ',
    '  v v  ',
  ], [
    '  C C  ',
    '       ',
    '       ',
    '   N   ',
    '  d d  ',
    ' q   q ',
    '  W W  ',
    '       ',
    '       ',
  ]) },
  { id: 'cruzador', name: 'Cruzador de Mísseis', power: 7, minWave: 7, role: 'Mísseis guiados, escudo e defesa pontual.', design: makeDesign([
    '    #    ',
    '   ###   ',
    '  #####  ',
    '  #####  ',
    ' ###B### ',
    '<#######>',
    ' ####### ',
    ' ####### ',
    '<#######>',
    ' ####### ',
    '  #####  ',
    '  #####  ',
    '  v v v  ',
  ], [
    '    D    ',
    '   u u   ',
    '    G    ',
    '  u   u  ',
    '         ',
    '  D   D  ',
    '   u u   ',
    '         ',
    '  m   m  ',
    '    r    ',
    '  e e e  ',
    '  E   E  ',
    '         ',
  ]) },
  { id: 'dreadnought', name: 'Superencouraçado', power: 14, minWave: 10, role: 'Chefe: couraça, railgun, morteiros, escudos e mísseis.', design: makeDesign([
    '     @     ',
    '    @@@    ',
    '   @@@@@   ',
    '  @@@@@@@  ',
    ' %%%%%%%%% ',
    '<@@@@@@@@@>',
    ' @@@@b@@@@ ',
    ' ######### ',
    ' ######### ',
    '<#########>',
    ' ######### ',
    ' ######### ',
    '<%#######%>',
    ' ######### ',
    '  #######  ',
    '  v v v v  ',
  ], [
    '     R     ',
    '    C C    ',
    '     G     ',
    '   N   N   ',
    '  C     C  ',
    '           ',
    '           ',
    '  D     D  ',
    '   u   u   ',
    '  d     d  ',
    '    M M    ',
    '   r   r   ',
    '  k     k  ',
    '  W  W  W  ',
    '    E E    ',
    '           ',
  ]) },

  { id: 'sentinela', name: 'Sentinela', power: 5, minWave: 6, role: 'Radar e sonar: enxerga longe e dá os alvos para o resto.', design: makeDesign([
    '   o   ',
    '  ooo  ',
    ' ##### ',
    ' ##B## ',
    '<#####>',
    ' ##### ',
    ' ##### ',
    '  ###  ',
    '  v v  ',
  ], [
    '   A   ',
    '  S Y  ',
    ' c   c ',
    '       ',
    '   A   ',
    '  Z X  ',
    ' e   e ',
    '   e   ',
    '       ',
  ]) },
  { id: 'fantasma', name: 'Fantasma', power: 4, minWave: 8, role: 'Casco furtivo: some do mapa, do sonar e dos mísseis.', design: makeDesign([
    '  s  ',
    ' sss ',
    ' sBs ',
    '<sss>',
    ' sss ',
    ' sss ',
    '  s  ',
    '  v  ',
  ], [
    '  t  ',
    ' t t ',
    '     ',
    '  u  ',
    '  Q  ',
    ' e e ',
    '  e  ',
    '     ',
  ]) },

  { id: 'submarino', name: 'Submarino', power: 3, minWave: 4, role: 'Mergulha (tecla V): some da vista, ataca com torpedos.', design: makeDesign([
    '  #  ',
    ' ### ',
    ' ### ',
    ' #U# ',
    '<###>',
    ' ### ',
    ' ### ',
    '  #  ',
    '  v  ',
  ], [
    '  t  ',
    ' t t ',
    '  w  ',
    '     ',
    '  z  ',
    ' V V ',
    '  n  ',
    '  V  ',
    '     ',
  ]) },
  { id: 'minador', name: 'Submarino Minador', power: 4, minWave: 6, role: 'Torpedo guiado, minas e periscópio.', design: makeDesign([
    '  #  ',
    ' ### ',
    ' #U# ',
    '<###>',
    ' ### ',
    ' ### ',
    ' ### ',
    '  #  ',
    '  v  ',
  ], [
    '  t  ',
    '  a  ',
    '     ',
    '  w  ',
    '  h  ',
    ' z z ',
    ' V V ',
    '  V  ',
    '     ',
  ]) },
  { id: 'cacasub', name: 'Caça-submarinos', power: 4, minWave: 5, role: 'Escolta com sonar ativo e cargas de profundidade.', design: makeDesign([
    '   #   ',
    '  ###  ',
    '  ###  ',
    ' ##B## ',
    '<#####>',
    ' ##### ',
    ' ##### ',
    '  ###  ',
    '  ###  ',
    '  v v  ',
  ], [
    '   m   ',
    '   c   ',
    '       ',
    '       ',
    '  Y S  ',
    '  g g  ',
    '   g   ',
    '       ',
    '  eEe  ',
    '       ',
  ]) },
  { id: 'nuclear', name: 'Submarino Nuclear', power: 8, minWave: 9, role: 'Reator, torpedos guiados e pesados, sonar e bateria infinita.', design: makeDesign([
    '   #   ',
    '  ###  ',
    '  ###  ',
    '  ###  ',
    ' ##U## ',
    '<#####>',
    ' ##### ',
    ' ##### ',
    ' ##### ',
    '  ###  ',
    '  ###  ',
    '   #   ',
    '   v   ',
  ], [
    '   a   ',
    '  a a  ',
    '   w   ',
    '  i i  ',
    '       ',
    '  S Y  ',
    '  z z  ',
    '   z   ',
    '  n n  ',
    '   K   ',
    '   V   ',
    '   V   ',
    '       ',
  ]) },

  { id: 'abordador', name: 'Abordador', power: 3, minWave: 3, role: 'Aríete, serras, espinhos e ganchos: parte para o corpo a corpo.', design: makeDesign([
    '   2   ',
    '  ###  ',
    ' ##B## ',
    '<#####>',
    ' ##### ',
    ' ##### ',
    '  ###  ',
    '  v v  ',
  ], [
    '   !   ',
    '  ^ ^  ',
    '       ',
    ' +   + ',
    ' ~   ~ ',
    '  e e  ',
    '   E   ',
    '       ',
  ]) },
  { id: 'portadrones', name: 'Porta-drones', power: 7, minWave: 8, role: 'Lança drones de reconhecimento, ataque e suicidas.', design: makeDesign([
    '    #    ',
    '   ###   ',
    '  #####  ',
    '  #####  ',
    ' ###B### ',
    '<#######>',
    ' ####### ',
    ' ####### ',
    '<#######>',
    ' ####### ',
    '  #####  ',
    '  #####  ',
    '  v v v  ',
  ], [
    '    D    ',
    '   I O   ',
    '  O   P  ',
    '    *    ',
    '         ',
    '  D   D  ',
    '    0    ',
    '  m   m  ',
    '    r    ',
    '  e e e  ',
    '  E   E  ',
    '    0    ',
    '         ',
  ]) },
  { id: 'titan', name: 'Titã', power: 9, minWave: 11, role: 'Casco de titânio, antepara e corta-fogo: difícil de afundar.', design: makeDesign([
    '    2    ',
    '   222   ',
    '  22B22  ',
    ' 2222222 ',
    '<2222222>',
    ' 2255522 ',
    ' 2255522 ',
    '<3333333>',
    ' 3333333 ',
    '  44444  ',
    '  v v v  ',
  ], [
    '    !    ',
    '   ^&^   ',
    '         ',
    '  C   C  ',
    ' +     + ',
    '   & &   ',
    '   &0&   ',
    ' m  *  m ',
    ' e  W  e ',
    '  j   j  ',
    '         ',
  ]) },
];

PRESETS.sort((a, b) => a.power - b.power);

/** coloca grupos de tripulação em células protegidas (perto do centro) dos modelos prontos */
function autoCrew(d, types) {
  const cells = []; let sx = 0, sy = 0;
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) if (isHull(d.hull[y][x])) { cells.push({ x, y }); sx += x; sy += y; }
  const cx = sx / cells.length, cy = sy / cells.length;
  const hasHull = (x, y) => y >= 0 && y < GRID_H && x >= 0 && x < GRID_W && isHull(d.hull[y][x]);
  const inner = cells.filter(c => [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => hasHull(c.x + dx, c.y + dy)));
  const pool = (inner.length >= types.length * 2 ? inner : cells).slice()
    .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy) || a.y - b.y || a.x - b.x);
  const used = [];
  for (const t of types) {
    const pick = pool.find(c => !used.includes(c) && !isBridge(d.hull[c.y][c.x]) && used.every(u => Math.abs(u.x - c.x) + Math.abs(u.y - c.y) >= 3))
      || pool.find(c => !used.includes(c) && !isBridge(d.hull[c.y][c.x]));
    if (!pick) break;
    d.crew[pick.y][pick.x] = t; used.push(pick);
  }
}
const PRESET_CREW = {
  corveta: ['r'], canhoneira: ['g', 'r'], catamara: ['t', 'r'], barcaca: ['g', 'r'], fragata: ['g', 'r'], destroier: ['g', 'r', 't'],
  sentinela: ['s', 's', 'r'], monitor: ['r', 'b', 'm', 'g'], cruzador: ['g', 'r', 'b', 's'], encouracado: ['g', 'r', 'b', 'm'],
  dreadnought: ['g', 'g', 'r', 'r', 'b', 'm', 't', 's'], cacasub: ['r', 's'], nuclear: ['r', 'b', 'm', 's'],
  abordador: ['f', 'f', 'r'], portadrones: ['s', 'r', 'b'], titan: ['r', 'b', 'm', 'f'],
};
for (const p of PRESETS) if (PRESET_CREW[p.id]) autoCrew(p.design, PRESET_CREW[p.id]);


/* --------------------------------------------------------------- progresso */
const Meta = {
  coins: 0, best: 0, design: null, name: '', server: '', zoom: 0,
  bots: { diff: 'normal', mult: 1, allowed: null, startWave: 1, skirmish: {} },
  budget() { return BASE_BUDGET + this.coins; },
  load() {
    try {
      const j = JSON.parse(localStorage.getItem('batalhaNaval.v1') || '{}');
      this.coins = j.coins | 0; this.best = j.best | 0;
      this.name = typeof j.name === 'string' ? j.name : ''; this.server = typeof j.server === 'string' ? j.server : '';
      this.zoom = +j.zoom > 0 ? Math.min(1.6, Math.max(0.35, +j.zoom)) : 0;
      if (j.bots && typeof j.bots === 'object') {
        const b = j.bots;
        if (BOT_DIFFS[b.diff]) this.bots.diff = b.diff;
        if (+b.mult >= 0.25 && +b.mult <= 4) this.bots.mult = +b.mult;
        if (Array.isArray(b.allowed)) this.bots.allowed = b.allowed.filter(x => typeof x === 'string').slice(0, 60);
        if (+b.startWave >= 1 && +b.startWave <= 30) this.bots.startWave = +b.startWave | 0;
        if (b.skirmish && typeof b.skirmish === 'object') this.bots.skirmish = b.skirmish;
      }
      if (j.design && j.design.hull && j.design.top) this.design = normalizeDesign(j.design);
    } catch (e) { /* sem storage: segue sem salvar */ }
  },
  reset() {
    this.coins = 0; this.best = 0; this.design = null;
    this.save();                                  // mantém só o nome e o servidor online
  },
  save() {
    try {
      localStorage.setItem('batalhaNaval.v1', JSON.stringify({ coins: this.coins, best: this.best, design: this.design, name: this.name, server: this.server, zoom: this.zoom, bots: this.bots }));
    } catch (e) { /* ignore */ }
  },
};

/* ================================================================ DESENHO */
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}
function poly(ctx, pts) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
function rivets(ctx, d, r, col) {
  ctx.fillStyle = col;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) { ctx.beginPath(); ctx.arc(sx * d, sy * d, r, 0, TAU); ctx.fill(); }
}
function cracks(ctx, cs, dmg, seed) {
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const h = cs / 2;
  if (dmg > 0.55) { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(-h, -h, cs, cs); }
  ctx.strokeStyle = 'rgba(15,15,15,0.75)'; ctx.lineWidth = 1.2;
  const n = dmg > 0.55 ? 5 : 2;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    const x = (rnd() - 0.5) * cs, y = (rnd() - 0.5) * cs;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * cs * 0.8, y + (rnd() - 0.5) * cs * 0.8);
    ctx.stroke();
  }
  if (dmg > 0.8) { ctx.fillStyle = 'rgba(255,110,30,0.35)'; ctx.fillRect(-h * 0.5, -h * 0.5, h, h); }
}

/** desenha o corpo de uma célula centrada em (0,0). o: {dmg, flash, seed, time} */
function drawBase(ctx, code, cs, o = {}) {
  const h = cs / 2;
  switch (code) {
    case '#':
      ctx.fillStyle = '#4f5b6a'; ctx.fillRect(-h, -h, cs, cs);
      ctx.fillStyle = '#a7b3c0'; ctx.fillRect(-h + 1.5, -h + 1.5, cs - 3, cs - 3);
      ctx.fillStyle = '#b9c4d0'; ctx.fillRect(-h + 4, -h + 4, cs - 8, cs - 8);
      rivets(ctx, h - 3, Math.max(1, cs * 0.05), '#6f7d8d');
      break;
    case '=':
      ctx.fillStyle = '#242b34'; ctx.fillRect(-h, -h, cs, cs);
      ctx.fillStyle = '#5b6676'; ctx.fillRect(-h + 1.5, -h + 1.5, cs - 3, cs - 3);
      ctx.strokeStyle = 'rgba(20,26,34,.55)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-h + 2, -h + 2); ctx.lineTo(h - 2, h - 2);
      ctx.moveTo(h - 2, -h + 2); ctx.lineTo(-h + 2, h - 2); ctx.stroke();
      ctx.fillStyle = '#8392a5'; ctx.fillRect(-cs * 0.13, -cs * 0.13, cs * 0.26, cs * 0.26);
      rivets(ctx, h - 3, Math.max(1, cs * 0.05), '#2e3640');
      break;
    case 'o':
      ctx.fillStyle = '#6b5636'; ctx.fillRect(-h, -h, cs, cs);
      ctx.fillStyle = '#c4a574'; ctx.fillRect(-h + 1.5, -h + 1.5, cs - 3, cs - 3);
      ctx.strokeStyle = 'rgba(80,58,30,.55)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 4; i++) { const y = -h + i * cs / 4; ctx.moveTo(-h + 1.5, y); ctx.lineTo(h - 1.5, y); }
      ctx.stroke();
      break;
    case '1':
      ctx.fillStyle = '#6d6a63'; ctx.fillRect(-h, -h, cs, cs);
      ctx.fillStyle = '#e9e4d8'; ctx.fillRect(-h + 1.5, -h + 1.5, cs - 3, cs - 3);
      ctx.strokeStyle = 'rgba(120,110,95,.6)'; ctx.lineWidth = 1;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) ctx.strokeRect(-h + 3 + i * (cs - 6) / 2, -h + 3 + j * (cs - 6) / 2, (cs - 6) / 2, (cs - 6) / 2);
      break;
    case '2': {
      ctx.fillStyle = '#1b2733'; ctx.fillRect(-h, -h, cs, cs);
      const g2 = ctx.createLinearGradient(-h, -h, h, h); g2.addColorStop(0, '#c5d6e8'); g2.addColorStop(0.5, '#8aa3bb'); g2.addColorStop(1, '#b7cadc');
      ctx.fillStyle = g2; ctx.fillRect(-h + 1.5, -h + 1.5, cs - 3, cs - 3);
      ctx.strokeStyle = 'rgba(40,60,80,.35)'; ctx.lineWidth = 1;
      for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-h + 2, -h + i * cs / 5); ctx.lineTo(h - 2, -h + i * cs / 5); ctx.stroke(); }
      break;
    }
    case '3':
      ctx.fillStyle = '#2a2f36'; ctx.fillRect(-h, -h, cs, cs);
      ctx.fillStyle = '#7d8793'; ctx.fillRect(-h + 1.5, -h + 1.5, cs - 3, cs - 3);
      ctx.fillStyle = '#e3b93c';
      for (let i = 0; i < 4; i++) { ctx.fillRect(-h + 2 + i * (cs - 4) / 4, -h + 2, (cs - 4) / 8, 3); ctx.fillRect(-h + 2 + i * (cs - 4) / 4, h - 5, (cs - 4) / 8, 3); }
      ctx.fillStyle = '#323943'; ctx.fillRect(-1.5, -h + 6, 3, cs - 12); ctx.fillRect(-h + 6, -1.5, cs - 12, 3);
      break;
    case '4':
      ctx.fillStyle = '#8c3b18'; ctx.fillRect(-h, -h, cs, cs);
      ctx.fillStyle = '#f2a04a'; ctx.fillRect(-h + 1.5, -h + 1.5, cs - 3, cs - 3);
      ctx.strokeStyle = '#fff2dc'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, cs * 0.26, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#d9541e'; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.arc(0, 0, cs * 0.26, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      break;
    case '5':
      ctx.fillStyle = '#3a1713'; ctx.fillRect(-h, -h, cs, cs);
      ctx.fillStyle = '#7a3a30'; ctx.fillRect(-h + 1.5, -h + 1.5, cs - 3, cs - 3);
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      for (const [px, py] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) { ctx.beginPath(); ctx.arc(px * cs, py * cs, 1.8, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#ffb347'; poly(ctx, [[0, -cs * 0.2], [cs * 0.12, 0], [0, cs * 0.18], [-cs * 0.12, 0]]); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, cs * 0.24, 0, TAU); ctx.moveTo(-cs * 0.17, cs * 0.17); ctx.lineTo(cs * 0.17, -cs * 0.17); ctx.stroke();
      break;
    case 's':
      ctx.fillStyle = '#121418'; ctx.fillRect(-h, -h, cs, cs);
      ctx.fillStyle = '#2b2f37'; ctx.fillRect(-h + 1.5, -h + 1.5, cs - 3, cs - 3);
      poly(ctx, [[-h + 1.5, -h + 1.5], [h - 1.5, -h + 1.5], [0, 0]]); ctx.fillStyle = '#3a3f4b'; ctx.fill();
      poly(ctx, [[-h + 1.5, h - 1.5], [h - 1.5, h - 1.5], [0, 0]]); ctx.fillStyle = '#1b1e24'; ctx.fill();
      ctx.strokeStyle = 'rgba(150,120,255,.5)'; ctx.lineWidth = 1; ctx.strokeRect(-h + 3.5, -h + 3.5, cs - 7, cs - 7);
      break;
    case '@':
      ctx.fillStyle = '#12161c'; ctx.fillRect(-h, -h, cs, cs);
      ctx.fillStyle = '#39424f'; ctx.fillRect(-h + 2, -h + 2, cs - 4, cs - 4);
      ctx.fillStyle = '#4b5666'; ctx.fillRect(-h + 4, -h + 4, cs - 8, cs - 8);
      ctx.fillStyle = '#242d38'; ctx.fillRect(-cs * 0.3, -1, cs * 0.6, 2); ctx.fillRect(-1, -cs * 0.3, 2, cs * 0.6);
      rivets(ctx, h - 4, Math.max(1.4, cs * 0.075), '#171c23');
      break;
    case '%':
      ctx.fillStyle = '#3a2b1f'; ctx.fillRect(-h, -h, cs, cs);
      ctx.fillStyle = '#a06c40'; ctx.fillRect(-h + 1.5, -h + 1.5, cs - 3, cs - 3);
      ctx.fillStyle = '#c08a55';
      for (const sx of [-h + 2.5, 1]) for (const sy of [-h + 2.5, 1]) ctx.fillRect(sx, sy, h - 3.5, h - 3.5);
      break;
    case 'U': {
      ctx.fillStyle = '#0b1b26'; ctx.fillRect(-h, -h, cs, cs);
      ctx.fillStyle = '#31505f'; ctx.fillRect(-h + 1.5, -h + 1.5, cs - 3, cs - 3);
      ctx.fillStyle = '#486d80'; ctx.beginPath(); ctx.ellipse(0, 0, cs * 0.34, cs * 0.4, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#1a2f3b'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#9fb8c4'; ctx.beginPath(); ctx.arc(0, cs * 0.06, cs * 0.12, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#d6e2e8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -cs * 0.05); ctx.lineTo(0, -cs * 0.3); ctx.stroke();
      ctx.fillStyle = '#d6e2e8'; ctx.fillRect(-2, -cs * 0.34, 4, 3);
      break;
    }
    case 'B': case 'b': {
      const arm = code === 'b';
      ctx.fillStyle = arm ? '#161e29' : '#33475d'; ctx.fillRect(-h, -h, cs, cs);
      ctx.fillStyle = arm ? '#5b6a7e' : '#dde5ee'; ctx.fillRect(-h + 1.5, -h + 1.5, cs - 3, cs - 3);
      ctx.fillStyle = arm ? '#e3b93c' : '#27496d'; ctx.fillRect(-h + 3, -h + 3, cs - 6, cs * (arm ? 0.12 : 0.24));
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      if (!arm) for (let i = 0; i < 3; i++) ctx.fillRect(-h + 4.5 + i * (cs - 9) / 3, -h + 4.5, (cs - 9) / 3 - 2, cs * 0.1);
      else rivets(ctx, h - 4, Math.max(1.2, cs * 0.06), '#232c38');
      const a = (o.time || 0) * 2.2, cy = cs * 0.16, r = cs * 0.3;
      ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
      ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(0, cy, cs * 0.07, 0, TAU); ctx.fill();
      break;
    }
    case '<': case '>': {
      const s = code === '<' ? 1 : -1;
      poly(ctx, [[s * h, -0.75 * h], [s * h, 0.85 * h], [-s * 0.95 * h, 0.95 * h]]);
      ctx.fillStyle = '#f0933a'; ctx.fill();
      ctx.strokeStyle = '#a85a1c'; ctx.lineWidth = 1.5; ctx.stroke();
      poly(ctx, [[s * h * 0.8, -0.35 * h], [s * h * 0.8, 0.6 * h], [-s * 0.4 * h, 0.7 * h]]);
      ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fill();
      break;
    }
    case 'v':
      poly(ctx, [[-0.65 * h, -h], [0.65 * h, -h], [0.4 * h, 0.95 * h], [-0.4 * h, 0.95 * h]]);
      ctx.fillStyle = '#2fb5c4'; ctx.fill();
      ctx.strokeStyle = '#1b7580'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(-1, -h + 2, 2, cs * 0.7);
      break;
  }
  if (o.dmg > 0.25) cracks(ctx, cs, o.dmg, o.seed || 1);
  if (o.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.7, o.flash * 5)})`; ctx.fillRect(-h, -h, cs, cs); }
}

/** chama de motor (desenhada ANTES do casco, para ficar por baixo dele) */
function drawFlame(ctx, code, cs, f, time) {
  if (f < 0.03 || code === 'V') return;                   // motor elétrico: sem chama
  const turbo = code === 'E' || code === 'W' || code === 'T', twin = code === 'W', nuke = code === 'K', jet = code === 'j';
  const len = cs * (0.35 + f * (turbo ? 1.5 : nuke ? 1.8 : 1.0)) * (jet ? 0.7 : 1) + Math.sin(time * 40 + cs) * cs * 0.07 * f;
  const y0 = cs * 0.42, w = cs * (twin ? 0.14 : (turbo || nuke) ? 0.26 : 0.2);
  for (const ox of (twin ? [-cs * 0.2, cs * 0.2] : [0])) {
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    if (nuke) { g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, '#8dffb0'); g.addColorStop(1, 'rgba(40,255,140,0)'); }
    else if (turbo || jet) { g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#7fd4ff'); g.addColorStop(1, 'rgba(40,120,255,0)'); }
    else { g.addColorStop(0, '#fff3b0'); g.addColorStop(0.4, '#ff8a1f'); g.addColorStop(1, 'rgba(255,60,0,0)'); }
    poly(ctx, [[ox - w, y0], [ox + w, y0], [ox, y0 + len]]);
    ctx.fillStyle = g; ctx.fill();
  }
}

/** peça montada por cima do casco. o: {ang, recoil} (ang relativo ao navio) */
function drawTop(ctx, code, cs, o = {}) {
  const ang = o.ang || 0;
  switch (code) {
    case 'c': case 'd': {
      const dbl = code === 'd', bw = cs * 0.13;
      ctx.save(); ctx.rotate(ang);
      const rec = (o.recoil || 0) * cs * 0.14;
      for (const ox of (dbl ? [-cs * 0.14, cs * 0.14] : [0])) {
        ctx.fillStyle = '#1f252d'; ctx.fillRect(ox - bw / 2, -cs * 0.68 + rec, bw, cs * 0.68);
        ctx.fillStyle = '#515f70'; ctx.fillRect(ox - bw / 2 - 0.8, -cs * 0.68 + rec, bw + 1.6, cs * 0.1);
      }
      ctx.fillStyle = '#3f4a58'; ctx.strokeStyle = '#1b2027'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, cs * (dbl ? 0.4 : 0.34), 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#62748a'; ctx.beginPath(); ctx.arc(-cs * 0.06, -cs * 0.06, cs * 0.12, 0, TAU); ctx.fill();
      ctx.restore();
      break;
    }
    case 'm':
      ctx.save(); ctx.rotate(ang);
      ctx.fillStyle = '#1f252d'; ctx.fillRect(-cs * 0.04, -cs * 0.58 + (o.recoil || 0) * 2, cs * 0.08, cs * 0.58);
      ctx.fillStyle = '#2c3541'; ctx.strokeStyle = '#15191f'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, cs * 0.22, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e9c46a'; ctx.beginPath(); ctx.arc(0, 0, cs * 0.07, 0, TAU); ctx.fill();
      ctx.restore();
      break;
    case 't':
      ctx.fillStyle = '#2c3541'; ctx.fillRect(-cs * 0.4, -cs * 0.1, cs * 0.8, cs * 0.2);
      for (const sx of [-0.21, 0.21]) {
        ctx.fillStyle = '#566474'; ctx.fillRect(sx * cs - cs * 0.1, -cs * 0.42, cs * 0.2, cs * 0.84);
        ctx.fillStyle = '#c0392b'; ctx.fillRect(sx * cs - cs * 0.1, -cs * 0.42, cs * 0.2, cs * 0.13);
        ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(sx * cs - cs * 0.07, -cs * 0.25, cs * 0.04, cs * 0.55);
      }
      break;
    case 'e': case 'E': {
      const big = code === 'E', w = cs * (big ? 0.38 : 0.32);
      ctx.fillStyle = big ? '#2d3a52' : '#38414c'; ctx.strokeStyle = '#161b21'; ctx.lineWidth = 1.2;
      ctx.fillRect(-w, -cs * 0.36, w * 2, cs * 0.52); ctx.strokeRect(-w, -cs * 0.36, w * 2, cs * 0.52);
      ctx.fillStyle = big ? '#4f78c4' : '#232a33';
      for (let i = 0; i < 3; i++) ctx.fillRect(-w + 2, -cs * 0.3 + i * cs * 0.1, w * 2 - 4, cs * 0.05);
      poly(ctx, [[-cs * 0.2, cs * 0.16], [cs * 0.2, cs * 0.16], [cs * 0.28, cs * 0.42], [-cs * 0.28, cs * 0.42]]);
      ctx.fillStyle = '#171c22'; ctx.fill();
      break;
    }
    case 'M': case 'N': {
      const big = code === 'N', r = cs * (big ? 0.44 : 0.36), bw = cs * (big ? 0.34 : 0.26);
      const rec = (o.recoil || 0) * cs * 0.1;
      ctx.save(); ctx.rotate(ang);
      ctx.fillStyle = '#2b3a2e'; ctx.strokeStyle = '#141c16'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#4a6650';
      ctx.fillRect(-bw / 2, -cs * 0.5 + rec, bw, cs * 0.5); ctx.strokeRect(-bw / 2, -cs * 0.5 + rec, bw, cs * 0.5);
      ctx.fillStyle = '#0c120e'; ctx.beginPath(); ctx.ellipse(0, -cs * 0.5 + rec, bw * 0.38, bw * 0.2, 0, 0, TAU); ctx.fill();
      ctx.restore();
      break;
    }
    case 'C': {
      const rec = (o.recoil || 0) * cs * 0.14;
      ctx.save(); ctx.rotate(ang);
      ctx.fillStyle = '#1b2027'; ctx.fillRect(-cs * 0.1, -cs * 0.84 + rec, cs * 0.2, cs * 0.84);
      ctx.fillStyle = '#566478';
      ctx.fillRect(-cs * 0.14, -cs * 0.84 + rec, cs * 0.28, cs * 0.14); ctx.fillRect(-cs * 0.13, -cs * 0.5 + rec, cs * 0.26, cs * 0.08);
      rr(ctx, -cs * 0.42, -cs * 0.36, cs * 0.84, cs * 0.72, cs * 0.18);
      ctx.fillStyle = '#343e4b'; ctx.fill(); ctx.strokeStyle = '#14181d'; ctx.lineWidth = 1.8; ctx.stroke();
      ctx.fillStyle = '#62748a'; ctx.beginPath(); ctx.arc(-cs * 0.08, -cs * 0.08, cs * 0.13, 0, TAU); ctx.fill();
      ctx.restore();
      break;
    }
    case 'R': {
      const rec = (o.recoil || 0) * cs * 0.12;
      ctx.save(); ctx.rotate(ang);
      ctx.fillStyle = '#1b2433'; ctx.fillRect(-cs * 0.11, -cs * 0.95 + rec, cs * 0.22, cs * 0.95);
      ctx.fillStyle = '#7fd4ff';
      for (const sx of [-1, 1]) ctx.fillRect(sx * cs * 0.13 - 1.5, -cs * 0.95 + rec, 3, cs * 0.95);
      rr(ctx, -cs * 0.4, -cs * 0.34, cs * 0.8, cs * 0.68, cs * 0.2);
      ctx.fillStyle = '#2b3a52'; ctx.fill(); ctx.strokeStyle = '#101722'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = 'rgba(127,212,255,.95)'; ctx.beginPath(); ctx.arc(0, 0, cs * 0.11, 0, TAU); ctx.fill();
      ctx.restore();
      break;
    }
    case 'q':
      ctx.save(); ctx.rotate(ang);
      ctx.fillStyle = '#1f252d'; ctx.fillRect(-cs * 0.055, -cs * 0.64 + (o.recoil || 0) * 2, cs * 0.11, cs * 0.64);
      ctx.fillStyle = '#6a5d2e'; ctx.fillRect(cs * 0.14, -cs * 0.02, cs * 0.16, cs * 0.24);
      ctx.fillStyle = '#2c3541'; ctx.strokeStyle = '#15191f'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(0, 0, cs * 0.27, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d6573e'; ctx.beginPath(); ctx.arc(0, 0, cs * 0.08, 0, TAU); ctx.fill();
      ctx.restore();
      break;
    case 'k':
      ctx.save(); ctx.rotate(ang);
      ctx.fillStyle = '#222a33';
      for (const off of [-0.09, 0, 0.09]) ctx.fillRect(off * cs - cs * 0.03, -cs * 0.66 + (o.recoil || 0) * 2, cs * 0.06, cs * 0.66);
      ctx.fillStyle = '#7a6a2a'; ctx.beginPath(); ctx.arc(0, cs * 0.12, cs * 0.13, 0, TAU); ctx.fill();
      ctx.fillStyle = '#394350'; ctx.strokeStyle = '#14181d'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(0, 0, cs * 0.26, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#8fa4b8'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, cs * 0.15, 0, TAU); ctx.stroke();
      ctx.restore();
      break;
    case 'f':
      ctx.save(); ctx.rotate(ang);
      ctx.fillStyle = '#555f6b'; ctx.fillRect(-cs * 0.05, -cs * 0.5, cs * 0.1, cs * 0.4);
      ctx.fillStyle = '#ff7a1f'; ctx.fillRect(-cs * 0.08, -cs * 0.54, cs * 0.16, cs * 0.08);
      ctx.fillStyle = '#a63a2c'; ctx.strokeStyle = '#4a1610'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, cs * 0.08, cs * 0.27, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.arc(-cs * 0.08, 0, cs * 0.08, 0, TAU); ctx.fill();
      ctx.restore();
      break;
    case 'u':
      rr(ctx, -cs * 0.4, -cs * 0.4, cs * 0.8, cs * 0.8, cs * 0.08);
      ctx.fillStyle = '#2c3541'; ctx.fill(); ctx.strokeStyle = '#14181d'; ctx.lineWidth = 1.2; ctx.stroke();
      for (const sx of [-0.2, 0.2]) {
        ctx.fillStyle = '#d8dde3'; ctx.fillRect(sx * cs - cs * 0.075, -cs * 0.3, cs * 0.15, cs * 0.6);
        ctx.fillStyle = '#e8503a'; ctx.fillRect(sx * cs - cs * 0.075, -cs * 0.3, cs * 0.15, cs * 0.14);
      }
      break;
    case 'G':
      ctx.fillStyle = '#10304a'; ctx.strokeStyle = '#4cc9ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, cs * 0.37, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#9aeaff'; ctx.beginPath(); ctx.arc(0, 0, cs * 0.15, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(154,234,255,.6)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, cs * 0.26, 0, TAU); ctx.stroke();
      break;
    case 'D':
      ctx.save(); ctx.rotate(ang);
      ctx.fillStyle = '#c9d1da'; ctx.fillRect(-cs * 0.03, -cs * 0.52 + (o.recoil || 0) * 2, cs * 0.06, cs * 0.52);
      ctx.fillStyle = '#59636f'; ctx.strokeStyle = '#242a31'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, cs * 0.25, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#bfefff'; ctx.beginPath(); ctx.arc(0, cs * 0.04, cs * 0.1, 0, TAU); ctx.fill();
      ctx.restore();
      break;
    case 'p':
      rr(ctx, -cs * 0.3, -cs * 0.22, cs * 0.6, cs * 0.44, cs * 0.08);
      ctx.fillStyle = '#3a4b63'; ctx.fill(); ctx.strokeStyle = '#161d29'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#7fd4ff';
      ctx.fillRect(-cs * 0.38, -cs * 0.09, cs * 0.1, cs * 0.18); ctx.fillRect(cs * 0.28, -cs * 0.09, cs * 0.1, cs * 0.18);
      break;
    case 'W': {
      ctx.fillStyle = '#4a3c3c'; ctx.strokeStyle = '#161b21'; ctx.lineWidth = 1.2;
      ctx.fillRect(-cs * 0.42, -cs * 0.38, cs * 0.84, cs * 0.54); ctx.strokeRect(-cs * 0.42, -cs * 0.38, cs * 0.84, cs * 0.54);
      ctx.fillStyle = '#ff9a3c';
      for (let i = 0; i < 3; i++) ctx.fillRect(-cs * 0.34, -cs * 0.3 + i * cs * 0.1, cs * 0.68, cs * 0.05);
      for (const ox of [-cs * 0.2, cs * 0.2]) {
        poly(ctx, [[ox - cs * 0.14, cs * 0.16], [ox + cs * 0.14, cs * 0.16], [ox + cs * 0.18, cs * 0.42], [ox - cs * 0.18, cs * 0.42]]);
        ctx.fillStyle = '#171c22'; ctx.fill();
      }
      break;
    }
    case '&':
      ctx.fillStyle = '#1b2027'; ctx.fillRect(-cs * 0.44, -cs * 0.44, cs * 0.88, cs * 0.88);
      ctx.fillStyle = '#6a7686'; ctx.fillRect(-cs * 0.4, -cs * 0.4, cs * 0.8, cs * 0.8);
      ctx.fillStyle = '#8795a8'; ctx.fillRect(-cs * 0.4, -cs * 0.4, cs * 0.8, cs * 0.14);
      rivets(ctx, cs * 0.3, Math.max(1.2, cs * 0.05), '#2a313b');
      break;
    case '$':
      ctx.fillStyle = '#3a2a1e'; ctx.fillRect(-cs * 0.44, -cs * 0.44, cs * 0.88, cs * 0.88);
      ctx.fillStyle = '#c98a4a';
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) ctx.fillRect(sx > 0 ? cs * 0.02 : -cs * 0.4, sy > 0 ? cs * 0.02 : -cs * 0.4, cs * 0.38, cs * 0.38);
      ctx.strokeStyle = '#e8503a'; ctx.lineWidth = 1.4; ctx.strokeRect(-cs * 0.4, -cs * 0.4, cs * 0.8, cs * 0.8);
      break;
    case '+':
      ctx.fillStyle = '#9aa3ad'; ctx.strokeStyle = '#2b3138'; ctx.lineWidth = 1;
      for (const [px, py, pa] of [[0, -0.28, 0], [0.28, 0, Math.PI / 2], [0, 0.28, Math.PI], [-0.28, 0, -Math.PI / 2], [0.2, -0.2, Math.PI / 4], [-0.2, -0.2, -Math.PI / 4], [0.2, 0.2, 3 * Math.PI / 4], [-0.2, 0.2, -3 * Math.PI / 4]]) {
        ctx.save(); ctx.translate(px * cs, py * cs); ctx.rotate(pa); poly(ctx, [[-cs * 0.07, 0], [cs * 0.07, 0], [0, -cs * 0.2]]); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      ctx.fillStyle = '#4d565f'; ctx.beginPath(); ctx.arc(0, 0, cs * 0.16, 0, TAU); ctx.fill();
      break;
    case '^':
      ctx.save(); ctx.rotate((o.time || 0) * 9);
      ctx.fillStyle = '#c9d1da'; ctx.strokeStyle = '#2b3138'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) { const rr0 = i % 2 ? cs * 0.28 : cs * 0.4, an = i * TAU / 16; ctx.lineTo(Math.cos(an) * rr0, Math.sin(an) * rr0); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#39424c'; ctx.beginPath(); ctx.arc(0, 0, cs * 0.12, 0, TAU); ctx.fill();
      ctx.restore();
      break;
    case '!':
      poly(ctx, [[-cs * 0.3, cs * 0.4], [cs * 0.3, cs * 0.4], [cs * 0.22, -cs * 0.1], [0, -cs * 0.5], [-cs * 0.22, -cs * 0.1]]);
      ctx.fillStyle = '#6b7482'; ctx.fill(); ctx.strokeStyle = '#1e242b'; ctx.lineWidth = 1.6; ctx.stroke();
      poly(ctx, [[0, -cs * 0.5], [cs * 0.22, -cs * 0.1], [0, -cs * 0.05], [-cs * 0.22, -cs * 0.1]]); ctx.fillStyle = '#c0392b'; ctx.fill();
      break;
    case '~':
      ctx.strokeStyle = '#8b939c'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(0, cs * 0.35); ctx.lineTo(0, -cs * 0.1); ctx.stroke();
      ctx.strokeStyle = '#dfe5ea'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, -cs * 0.22, cs * 0.18, Math.PI * 0.9, Math.PI * 2.1); ctx.stroke();
      ctx.fillStyle = '#dfe5ea'; poly(ctx, [[cs * 0.18, -cs * 0.3], [cs * 0.3, -cs * 0.2], [cs * 0.14, -cs * 0.14]]); ctx.fill();
      ctx.fillStyle = '#4d565f'; ctx.beginPath(); ctx.arc(0, cs * 0.32, cs * 0.1, 0, TAU); ctx.fill();
      break;
    case '?': {
      const t = o.time || 0;
      ctx.fillStyle = '#1a2a3a'; ctx.strokeStyle = '#4cc9ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, cs * 0.3, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(190,240,255,.9)'; ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); let px = -cs * 0.2, py = (i - 1) * cs * 0.1; ctx.moveTo(px, py);
        for (let k = 1; k <= 4; k++) { px += cs * 0.1; py = (i - 1) * cs * 0.1 + (k % 2 ? 1 : -1) * cs * 0.05 * Math.sin(t * 20 + i + k); ctx.lineTo(px, py); }
        ctx.stroke();
      }
      break;
    }
    case '0':
      ctx.fillStyle = '#173246'; ctx.strokeStyle = '#4cc9ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, cs * 0.34, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#7fd8ff'; ctx.beginPath(); ctx.moveTo(0, -cs * 0.22); ctx.quadraticCurveTo(cs * 0.2, cs * 0.02, 0, cs * 0.2); ctx.quadraticCurveTo(-cs * 0.2, cs * 0.02, 0, -cs * 0.22); ctx.fill();
      break;
    case '*':
      ctx.fillStyle = '#7a1d1d'; ctx.strokeStyle = '#1a0a0a'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(0, cs * 0.1, cs * 0.26, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d9d9d9'; ctx.fillRect(-cs * 0.05, -cs * 0.3, cs * 0.1, cs * 0.2);
      ctx.strokeStyle = 'rgba(150,220,255,.8)'; ctx.lineWidth = 1.3;
      for (const an of [-0.6, 0, 0.6]) { ctx.beginPath(); ctx.moveTo(0, -cs * 0.3); ctx.lineTo(Math.sin(an) * cs * 0.28, -cs * 0.3 - Math.cos(an) * cs * 0.14); ctx.stroke(); }
      break;
    case 'I': case 'O': case 'P':
      ctx.fillStyle = '#262c33'; ctx.fillRect(-cs * 0.42, -cs * 0.42, cs * 0.84, cs * 0.84);
      ctx.strokeStyle = '#e3c25a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, cs * 0.32, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#e3c25a'; ctx.fillRect(-cs * 0.14, -cs * 0.18, cs * 0.06, cs * 0.36); ctx.fillRect(cs * 0.08, -cs * 0.18, cs * 0.06, cs * 0.36); ctx.fillRect(-cs * 0.12, -cs * 0.03, cs * 0.24, cs * 0.06);
      ctx.fillStyle = o.out ? '#3a3f46' : code === 'I' ? '#4cc9ff' : code === 'O' ? '#e8503a' : '#ffa53c'; ctx.beginPath(); ctx.arc(cs * 0.3, -cs * 0.3, cs * 0.09, 0, TAU); ctx.fill();
      if (o.out) { ctx.strokeStyle = 'rgba(227,194,90,.35)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(0, 0, cs * 0.32, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
      break;
    case 'A': {
      const a = (o.time || 0) * 3;
      ctx.fillStyle = '#4a5360'; ctx.strokeStyle = '#1a1f26'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, cs * 0.34, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.rotate(a);
      ctx.fillStyle = 'rgba(120,255,160,.35)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, cs * 0.3, -0.6, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#8dffb0'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(cs * 0.3, 0); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#cfe3d6'; ctx.beginPath(); ctx.arc(0, 0, cs * 0.06, 0, TAU); ctx.fill();
      break;
    }
    case 'S': case 'Y': {
      const act = code === 'Y', t = o.time || 0;
      ctx.fillStyle = act ? '#0f3a52' : '#143040'; ctx.strokeStyle = act ? '#4cc9ff' : '#3a8fb5'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, 0, cs * (act ? 0.38 : 0.3), 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(160,235,255,.7)'; ctx.lineWidth = 1;
      for (let i = 1; i <= 2; i++) {
        const rr0 = cs * (0.08 + i * 0.07) + (act ? (Math.sin(t * 4 + i) * 0.5 + 0.5) * cs * 0.04 : 0);
        ctx.beginPath(); ctx.arc(0, 0, rr0, -2.2, -0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, rr0, 0.9, 2.2); ctx.stroke();
      }
      ctx.fillStyle = '#bff3ff'; ctx.beginPath(); ctx.arc(0, 0, cs * 0.05, 0, TAU); ctx.fill();
      break;
    }
    case 'Q': {
      const t = o.time || 0;
      poly(ctx, [0, 1, 2, 3, 4, 5].map(i => [Math.cos(i * TAU / 6) * cs * 0.38, Math.sin(i * TAU / 6) * cs * 0.38]));
      ctx.fillStyle = '#1a1424'; ctx.fill(); ctx.strokeStyle = 'rgba(170,120,255,' + (0.6 + 0.3 * Math.sin(t * 3)).toFixed(2) + ')'; ctx.lineWidth = 1.8; ctx.stroke();
      ctx.fillStyle = 'rgba(170,120,255,.8)'; ctx.beginPath(); ctx.arc(0, 0, cs * 0.1, 0, TAU); ctx.fill();
      break;
    }
    case 'J':
      ctx.fillStyle = '#2d3640'; rr(ctx, -cs * 0.3, -cs * 0.12, cs * 0.6, cs * 0.34, cs * 0.06); ctx.fill();
      ctx.strokeStyle = '#e9c46a'; ctx.lineWidth = 1.5;
      for (const sx of [-0.2, 0, 0.2]) { ctx.beginPath(); ctx.moveTo(sx * cs, -cs * 0.12); ctx.lineTo(sx * cs, -cs * 0.4); ctx.stroke(); ctx.beginPath(); ctx.arc(sx * cs, -cs * 0.4, 1.8, 0, TAU); ctx.stroke(); }
      ctx.strokeStyle = '#7bd86a'; ctx.beginPath(); ctx.moveTo(-cs * 0.22, cs * 0.06); ctx.lineTo(-cs * 0.1, 0); ctx.lineTo(0, cs * 0.12); ctx.lineTo(cs * 0.1, 0); ctx.lineTo(cs * 0.22, cs * 0.06); ctx.stroke();
      break;
    case 'Z':
      rr(ctx, -cs * 0.34, -cs * 0.3, cs * 0.68, cs * 0.6, cs * 0.06);
      ctx.fillStyle = '#4b4a3a'; ctx.fill(); ctx.strokeStyle = '#1d1c14'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#e3c25a';
      for (let i = 0; i < 3; i++) ctx.fillRect(-cs * 0.26, -cs * 0.2 + i * cs * 0.15, cs * 0.52, cs * 0.07);
      break;
    case 'X':
      rr(ctx, -cs * 0.3, -cs * 0.3, cs * 0.6, cs * 0.6, cs * 0.06);
      ctx.fillStyle = '#122418'; ctx.fill(); ctx.strokeStyle = '#7bd86a'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, cs * 0.14, 0, TAU); ctx.moveTo(-cs * 0.24, 0); ctx.lineTo(cs * 0.24, 0); ctx.moveTo(0, -cs * 0.24); ctx.lineTo(0, cs * 0.24); ctx.stroke();
      break;
    case 'V': {
      rr(ctx, -cs * 0.34, -cs * 0.34, cs * 0.68, cs * 0.52, cs * 0.08);
      ctx.fillStyle = '#17323d'; ctx.fill(); ctx.strokeStyle = '#4cc9ff'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.strokeStyle = 'rgba(120,230,255,.8)'; ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, -cs * 0.08, cs * (0.06 + i * 0.06), Math.PI * 0.15, Math.PI * 0.85); ctx.stroke(); }
      poly(ctx, [[-cs * 0.16, cs * 0.18], [cs * 0.16, cs * 0.18], [cs * 0.22, cs * 0.4], [-cs * 0.22, cs * 0.4]]); ctx.fillStyle = '#10222b'; ctx.fill();
      break;
    }
    case 'T': case 'j': case 'K': {
      const kind = code;
      const w = cs * (kind === 'K' ? 0.42 : 0.34);
      ctx.fillStyle = kind === 'K' ? '#2b4a38' : kind === 'T' ? '#3b3f52' : '#2f4a5a'; ctx.strokeStyle = '#12171c'; ctx.lineWidth = 1.2;
      ctx.fillRect(-w, -cs * 0.38, w * 2, cs * 0.56); ctx.strokeRect(-w, -cs * 0.38, w * 2, cs * 0.56);
      if (kind === 'K') {
        ctx.fillStyle = '#8dffb0'; ctx.beginPath(); ctx.arc(0, -cs * 0.1, cs * 0.16, 0, TAU); ctx.fill();
        ctx.fillStyle = '#12301f'; ctx.beginPath(); ctx.arc(0, -cs * 0.1, cs * 0.07, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e3d23c'; ctx.fillRect(-w + 3, cs * 0.04, w * 2 - 6, cs * 0.06);
      } else if (kind === 'T') {
        ctx.fillStyle = '#9aa6c4'; ctx.beginPath(); ctx.arc(0, -cs * 0.12, cs * 0.2, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#3b3f52'; ctx.lineWidth = 1.5; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; ctx.beginPath(); ctx.moveTo(0, -cs * 0.12); ctx.lineTo(Math.cos(a) * cs * 0.2, -cs * 0.12 + Math.sin(a) * cs * 0.2); ctx.stroke(); }
      } else {
        ctx.fillStyle = '#7fd4ff'; for (let i = 0; i < 3; i++) ctx.fillRect(-w + 3, -cs * 0.3 + i * cs * 0.1, w * 2 - 6, cs * 0.05);
      }
      poly(ctx, [[-cs * 0.2, cs * 0.18], [cs * 0.2, cs * 0.18], [cs * 0.27, cs * 0.42], [-cs * 0.27, cs * 0.42]]); ctx.fillStyle = '#171c22'; ctx.fill();
      break;
    }
    case 'a': case 'i': case 'l': case 'y': {
      ctx.fillStyle = '#2c3541'; ctx.fillRect(-cs * 0.4, -cs * 0.1, cs * 0.8, cs * 0.2);
      const cfg = { a: [[0], '#4cc9ff', 0.2], i: [[0], '#a62b2b', 0.3], l: [[-0.2, 0.2], '#e9d23c', 0.14], y: [[-0.28, 0, 0.28], '#e8503a', 0.15] }[code];
      for (const sx of cfg[0]) {
        ctx.fillStyle = code === 'i' ? '#6b5555' : '#566474'; ctx.fillRect(sx * cs - cs * cfg[2] / 2, -cs * 0.44, cs * cfg[2], cs * 0.88);
        ctx.fillStyle = cfg[1]; ctx.fillRect(sx * cs - cs * cfg[2] / 2, -cs * 0.44, cs * cfg[2], cs * 0.13);
      }
      if (code === 'a') { ctx.fillStyle = '#bff3ff'; ctx.beginPath(); ctx.arc(0, -cs * 0.05, cs * 0.05, 0, TAU); ctx.fill(); }
      break;
    }
    case 'w':
      ctx.strokeStyle = '#c9d6df'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(0, cs * 0.1); ctx.lineTo(0, -cs * 0.28); ctx.lineTo(cs * 0.14, -cs * 0.28); ctx.stroke();
      ctx.fillStyle = '#2c3a46'; ctx.strokeStyle = '#11181d'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(0, cs * 0.12, cs * 0.2, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#9fe8ff'; ctx.beginPath(); ctx.arc(cs * 0.14, -cs * 0.28, cs * 0.05, 0, TAU); ctx.fill();
      break;
    case 'n':
      rr(ctx, -cs * 0.34, -cs * 0.3, cs * 0.68, cs * 0.6, cs * 0.22);
      ctx.fillStyle = '#3d5568'; ctx.fill(); ctx.strokeStyle = '#142029'; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.strokeStyle = 'rgba(190,230,255,.7)'; ctx.lineWidth = 1.2;
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(-cs * 0.2, i * cs * 0.13); ctx.quadraticCurveTo(-cs * 0.1, i * cs * 0.13 - 3, 0, i * cs * 0.13); ctx.quadraticCurveTo(cs * 0.1, i * cs * 0.13 + 3, cs * 0.2, i * cs * 0.13); ctx.stroke(); }
      break;
    case 'z':
      rr(ctx, -cs * 0.3, -cs * 0.34, cs * 0.6, cs * 0.68, cs * 0.06);
      ctx.fillStyle = '#1d3a28'; ctx.fill(); ctx.strokeStyle = '#7bd86a'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.fillStyle = '#7bd86a'; ctx.fillRect(-cs * 0.12, -cs * 0.42, cs * 0.24, cs * 0.08);
      poly(ctx, [[cs * 0.04, -cs * 0.24], [-cs * 0.12, cs * 0.04], [-cs * 0.01, cs * 0.04], [-cs * 0.05, cs * 0.26], [cs * 0.13, -cs * 0.06], [cs * 0.02, -cs * 0.06]]);
      ctx.fillStyle = '#e9e36a'; ctx.fill();
      break;
    case 'h':
      rr(ctx, -cs * 0.38, -cs * 0.3, cs * 0.76, cs * 0.6, cs * 0.06);
      ctx.fillStyle = '#2a2f36'; ctx.fill(); ctx.strokeStyle = '#0f1216'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#515b66'; ctx.strokeStyle = '#161a1f'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, cs * 0.2, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) { const a = i * TAU / 8; ctx.beginPath(); ctx.moveTo(Math.cos(a) * cs * 0.2, Math.sin(a) * cs * 0.2); ctx.lineTo(Math.cos(a) * cs * 0.3, Math.sin(a) * cs * 0.3); ctx.stroke(); }
      break;
    case 'g':
      ctx.fillStyle = '#2c3541'; ctx.fillRect(-cs * 0.4, -cs * 0.36, cs * 0.8, cs * 0.72);
      for (const sy of [-0.17, 0.17]) {
        ctx.fillStyle = '#4a5a3a'; ctx.strokeStyle = '#141a10'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, sy * cs, cs * 0.14, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#e3d23c'; ctx.fillRect(-cs * 0.14, sy * cs - 1, cs * 0.28, 2);
      }
      ctx.fillStyle = '#c0392b'; ctx.fillRect(-cs * 0.3, -cs * 0.36, cs * 0.6, cs * 0.06);
      break;
    case 'r':
      rr(ctx, -cs * 0.34, -cs * 0.34, cs * 0.68, cs * 0.68, cs * 0.1);
      ctx.fillStyle = '#e9eeea'; ctx.fill(); ctx.strokeStyle = '#7d8f86'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#27a45a';
      ctx.fillRect(-cs * 0.09, -cs * 0.24, cs * 0.18, cs * 0.48);
      ctx.fillRect(-cs * 0.24, -cs * 0.09, cs * 0.48, cs * 0.18);
      break;
  }
}

/* o servidor (Node) reaproveita as regras: peças, estatísticas, detecção e validação */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CREW, normalizeDesign, stripCrew, BOT_DIFFS, VERSION, DEEP, GRID_W, GRID_H, BASE_BUDGET, VISION_BASE, REVEAL_NEAR, PARTS, PRESETS, shipStats, designCells,
    validateDesign, detects, isHull, isBridge, isFin, clamp };
}

/** círculo de tripulação (canto da célula). Só o dono e os aliados veem; para o inimigo é invisível. */
function drawCrew(ctx, code, cs, active) {
  const c = CREW[code];
  if (!c) return;
  ctx.save();
  ctx.globalAlpha = active === false ? 0.4 : 0.92;
  ctx.fillStyle = active === false ? 'rgba(90,25,25,.75)' : 'rgba(18,28,40,.78)';
  ctx.strokeStyle = active === false ? '#8a4a4a' : c.col; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(cs * 0.28, cs * 0.28, cs * 0.2, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = Math.round(cs * 0.24) + 'px "Segoe UI Emoji","Segoe UI",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(c.icon, cs * 0.28, cs * 0.3);
  ctx.restore();
}

