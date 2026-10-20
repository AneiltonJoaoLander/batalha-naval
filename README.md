# ⚓ Batalha Naval — v1.8

Monte seu navio **peça por peça** numa grade (casco, armas, motores, aletas, sensores…) e lute contra ondas de inimigos
ou contra outros jogadores **online**. Funciona no computador e no **celular** (instalável como app).

## Jogar

| Onde | Como |
|---|---|
| **Computador** | Abra `index.html` no navegador (campanha funciona sem servidor). |
| **Celular / qualquer lugar** | Publique no GitHub Pages (veja abaixo) e abra o link no celular. Toque em *Adicionar à tela inicial* para instalar. |
| **Online** | Direto pelo GitHub Pages, entre navegadores (P2P). Veja *Modo online*. |

### Controles
- **Computador:** `W/S` acelera/ré · `A/D` gira · mouse mira · botão esquerdo = canhões, morteiros e cargas de profundidade · `Espaço`/botão direito = torpedos e mísseis · `V` mergulhar/emergir (submarino) · `F` minas · `−`/`+` ou roda do mouse = zoom · `P` pausa · `M` som.
- **Celular:** joystick esquerdo move (o navio aponta para onde você empurra) · joystick direito mira e atira (quanto mais longe, maior o alcance do morteiro) · botão 🚀 = torpedos/mísseis · ⬇ mergulhar e 💣 minas (aparecem só com as peças) · ❚❚ pausa. Gire para **paisagem**.

## O que tem
- **Estaleiro em grade** 13×17: casco (leve, comum, reforçado, reativo, pesado, **furtivo**), pontes, aletas laterais/traseiras, canhões, morteiros, metralhadoras (comum, pesada, giratória, lança-chamas), torpedos, mísseis guiados, motores, escudo, defesa pontual, reparo, **radar, sonares, gerador furtivo, bloqueador, carregador e computador de tiro**.
- **Dano por peça**: cada quadrado tem vida; tiros destroem armas antes do casco, e partes desconectadas da ponte se soltam.
- **Campanha** em ondas com 20 modelos de inimigos (incluindo um chefe) e moedas que aumentam o orçamento.
- **Submarinos (v1.6):** troque a ponte pela **Torre Submarina**. Mergulhe (`V`): você some da vista, só leva torpedos/minas/cargas e só atira torpedos e minas; a bateria acaba e você emerge. Peças: periscópio, lastro, bateria, minas, cargas de profundidade, motor elétrico silencioso, reator nuclear.
- **Combate de perto, danos indiretos, drones e tripulação (v1.8):**
  - **Corpo a corpo:** Espinhos, Serra Giratória, Aríete, Gancho de Abordagem e Bobina de Choque causam dano ao encostar no inimigo (o aríete usa a proa).
  - **Mais cascos e blindagens:** Cerâmico, Titânio, Compartimentado, Flutuante, Corta-fogo e as Placas de convés (Aço e Reativa), que absorvem dano antes do casco.
  - **Alagamento:** cascos rompidos deixam entrar água; acima da capacidade o navio afunda (e fica mais lento). Bomba de Esgoto e Equipe de Avarias ajudam; submarinos vazam mais mergulhados.
  - **Fogo:** peças atingidas podem pegar fogo, que queima e se espalha; Sistema Anti-Incêndio e Bombeiros apagam. Munição em chamas pode explodir.
  - **Drones:** Hangares de Reconhecimento (ampliam a visão, seguem a mira), Ataque (bombardeiam inimigos detectados) e Suicida (`Espaço`/botão direito). Metralhadoras e defesa pontual os derrubam; hangar vazio demora para relançar.
  - **Tripulação:** círculos invisíveis para o inimigo (Artilheiros, Maquinistas, Equipe de Avarias, Bombeiros, Timoneiros, Operadores de Sensores, Fuzileiros). Se a peça sob o grupo for danificada ou destruída, o navio perde aquela função.
- **Bots configuráveis (v1.6):** dificuldade, quantidade, modelos permitidos, *escaramuça* offline e **bots nas salas online** (o anfitrião adiciona; rodam no navegador dele).
- **Zoom (v1.6):** ⚙ Opções (35%–160%) ou roda do mouse / `−` `+` na batalha.
- **Visão e furtividade (v1.5):**
  - Você só enxerga até certa distância (650, +300 por radar, até 2). O resto fica na névoa.
  - **Sonar Passivo** (850) e **Sonar Ativo** (1500, pulsa a cada 4 s mas denuncia você a 2200) mostram contatos na névoa.
  - **Furtividade**: com **60%** do casco em *Casco Furtivo* (ou *Gerador Furtivo*), o navio some do mapa, do sonar, do radar e dos **mísseis/torres automáticas**. Só aparece colado (< 170) ou por alguns segundos depois de **atirar** ou pingar sonar.
- **Online (v1.5):** salas com código/link, todos-contra-todos ou equipes, orçamento por sala, placar, reaparecimento, e **névoa de guerra feita pelo anfitrião** (você só recebe a posição de quem pode ver). **Sem servidor** (P2P).

## Modo online (sem servidor)

O online funciona **só com o GitHub Pages**: a partida roda direto entre os navegadores (**P2P / WebRTC via PeerJS**), no mesmo padrão cliente ↔ servidor ↔ clientes, em que o **navegador do anfitrião é o servidor**.

1. Um jogador abre **🌐 Jogar online → Criar sala** (vira o anfitrião) e recebe um **código de 4 letras**.
2. Os outros abrem o jogo, vão em **Jogar online**, digitam o código — ou abrem o **link de convite** (`…/?sala=CODIGO`, botão *Copiar link* no lobby).
3. Cada um monta o navio no Estaleiro (o orçamento da sala é validado pelo anfitrião), clica **Estou pronto** e o anfitrião **inicia**.
4. O anfitrião pode **adicionar bots** no lobby (modelo, dificuldade e equipe); eles rodam no navegador dele e contam no placar.

### Controles do anfitrião (v1.7)
- **Regras da sala:** jogadores máximos, tempo de reaparecimento, arena (pequena/média/grande), névoa de guerra, fogo amigo, proibir submarinos/furtividade/armas guiadas, **trancar** e **senha**.
- **Jogadores:** expulsar, banir, mover de equipe, balancear equipes; **preencher com bots** ou removê-los.
- **Durante a partida** (botão 👑 ou `Esc` → *Painel do anfitrião*): **pausar/continuar**, **+5 min**, **encerrar**, **anunciar**, ajustar abates/reaparecimento/fogo amigo ao vivo, expulsar/banir e remover bots.

Dicas e limites:
- O anfitrião precisa **manter a página aberta e em primeiro plano** (no celular, não bloquear a tela). O melhor aparelho/conexão deve ser o anfitrião.
- Se o anfitrião sair, a sala acaba.
- O P2P usa servidores STUN públicos do Google/Twilio e o sinalizador gratuito do PeerJS. Redes muito restritivas (alguns 4G/CGNAT ou Wi‑Fi corporativo) podem impedir a conexão; se acontecer, tente outra rede ou use um servidor dedicado (abaixo). Para usar um servidor TURN próprio, ponha `iceServers` em `config.js`.

### Servidor dedicado (opcional)
Para uma sala sempre ligada, o repositório inclui um servidor Node que roda **a mesma lógica** (`gameserver.js`):

```bash
npm install
npm start          # http://localhost:8787  (jogo + servidor)
```

Hospede em Render (`render.yaml`), Railway, Fly.io (`Dockerfile`)… e, em *Jogar online → Avançado*, cole o endereço `wss://…` (ou edite `config.js`).

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
gameserver.js                   lógica do servidor (salas, validação, névoa) — roda no navegador do anfitrião ou no Node
server/server.js                servidor dedicado opcional (Node + ws)
vendor/peerjs.min.js            PeerJS (WebRTC) para o online sem servidor
manifest.json sw.js icons/      PWA
```

## Como funciona o online (resumo)
Cada cliente simula **o próprio navio** e envia retratos ~20×/s ao anfitrião; tiros são retransmitidos e simulados por todos; quem **leva** o tiro aplica o dano (e avisa quem atirou). O anfitrião (`gameserver.js`) valida o projeto com as mesmas regras do jogo (`parts.js`), limita taxa/entradas e filtra os retratos pela **detecção** (visão, sonar, furtividade, revelação ao atirar).
Não há autoridade total (o anfitrião também joga): é pensado para jogar com amigos, não para torneios.
