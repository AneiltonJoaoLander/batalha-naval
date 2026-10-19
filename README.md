# ⚓ Batalha Naval — v1.5

Monte seu navio **peça por peça** numa grade (casco, armas, motores, aletas, sensores…) e lute contra ondas de inimigos
ou contra outros jogadores **online**. Funciona no computador e no **celular** (instalável como app).

## Jogar

| Onde | Como |
|---|---|
| **Computador** | Abra `index.html` no navegador (campanha funciona sem servidor). |
| **Celular / qualquer lugar** | Publique no GitHub Pages (veja abaixo) e abra o link no celular. Toque em *Adicionar à tela inicial* para instalar. |
| **Online** | Precisa do servidor (`server/`). Veja *Modo online*. |

### Controles
- **Computador:** `W/S` acelera/ré · `A/D` gira · mouse mira · botão esquerdo = canhões e morteiros · `Espaço`/botão direito = torpedos e mísseis · `P` pausa · `M` som.
- **Celular:** joystick esquerdo move (o navio aponta para onde você empurra) · joystick direito mira e atira (quanto mais longe, maior o alcance do morteiro) · botão 🚀 = torpedos/mísseis · ❚❚ pausa. Gire para **paisagem**.

## O que tem
- **Estaleiro em grade** 13×17: casco (leve, comum, reforçado, reativo, pesado, **furtivo**), pontes, aletas laterais/traseiras, canhões, morteiros, metralhadoras (comum, pesada, giratória, lança-chamas), torpedos, mísseis guiados, motores, escudo, defesa pontual, reparo, **radar, sonares, gerador furtivo, bloqueador, carregador e computador de tiro**.
- **Dano por peça**: cada quadrado tem vida; tiros destroem armas antes do casco, e partes desconectadas da ponte se soltam.
- **Campanha** em ondas com 16 modelos de inimigos (incluindo um chefe) e moedas que aumentam o orçamento.
- **Visão e furtividade (v1.5):**
  - Você só enxerga até certa distância (650, +300 por radar, até 2). O resto fica na névoa.
  - **Sonar Passivo** (850) e **Sonar Ativo** (1500, pulsa a cada 4 s mas denuncia você a 2200) mostram contatos na névoa.
  - **Furtividade**: com **60%** do casco em *Casco Furtivo* (ou *Gerador Furtivo*), o navio some do mapa, do sonar, do radar e dos **mísseis/torres automáticas**. Só aparece colado (< 170) ou por alguns segundos depois de **atirar** ou pingar sonar.
- **Online (v1.5):** salas com código, todos-contra-todos ou equipes, orçamento por sala, placar, reaparecimento, e **névoa de guerra feita no servidor** (você só recebe a posição de quem pode ver).

## Modo online

O servidor é um programa Node (pasta `server/`) que também **hospeda o próprio jogo**: um único endereço serve o site e o multijogador.

```bash
npm install
npm start          # http://localhost:8787
```

Teste em rede local (celular na mesma Wi‑Fi): abra `http://IP-DO-PC:8787` no celular e use *Jogar online*.

### Hospedar na internet (grátis)
O GitHub Pages **não roda servidor**. Hospede o servidor em um destes e use o endereço `wss://…`:

- **Render** (mais simples): *New → Blueprint* apontando para este repositório (usa `render.yaml`). No plano grátis o serviço "dorme" após ~15 min parado; a primeira conexão pode levar ~1 min.
- **Railway / Fly.io / qualquer VPS com Node ≥ 18**: `npm install && npm start` (há um `Dockerfile` pronto). Defina `PORT` se necessário.

Depois, de **dentro do jogo** (*Jogar online*) cole o endereço (ex.: `wss://batalha-naval.onrender.com`) — ele fica salvo. Para pré-configurar para todos, edite `config.js`:

```js
window.BN_CONFIG = { serverUrl: 'wss://batalha-naval.onrender.com' };
```

> Dica: se você abrir o jogo pelo **próprio endereço do servidor** (Render), nada precisa ser configurado.

## GitHub Pages (jogar pelo celular)
Settings → Pages → *Deploy from a branch* → `main` / `(root)`. O jogo é 100% estático (HTML/CSS/JS) e já inclui `manifest.json` + `sw.js` (instalável e offline na campanha).

## Estrutura
```
index.html  style.css          telas e estilo
parts.js                        peças, estatísticas, desenho, detecção, validação (compartilhado com o servidor)
builder.js                      editor de navio em grade
battle.js                       simulação, dano, IA, visão, partículas, render
touch.js                        controles de celular
net.js                          cliente online (lobby, retratos, tiros, placar)
main.js                         telas e inicialização
server/server.js                servidor online (Node + ws)
manifest.json sw.js icons/      PWA
```

## Como funciona o online (resumo)
Cada cliente simula **o próprio navio** e envia retratos ~20×/s; tiros são retransmitidos e simulados por todos; quem **leva** o tiro aplica o dano (e avisa quem atirou). O servidor valida o projeto (mesmas regras do jogo, via `parts.js`), limita taxa/entradas e filtra os retratos pela **detecção** (visão, sonar, furtividade, revelação ao atirar).
Não há autoridade total no servidor: é pensado para jogar com amigos, não para torneios.
