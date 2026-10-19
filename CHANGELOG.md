# Changelog

## v1.7.0 — controles do anfitrião
**No lobby (regras da sala)**
- **Jogadores máx.** (2–8), **tempo de reaparecimento** (1–15 s), **tamanho da arena** (pequena/média/grande), **névoa de guerra** liga/desliga e **fogo amigo** (equipes).
- **Peças proibidas:** submarinos, peças furtivas e armas guiadas. Navios e bots que violam as regras são recusados/removidos.
- **Trancar a sala** e **senha** (quem entra precisa digitar a senha).
- **Expulsar** e **banir** (por nome) jogadores; **mover jogadores/bots de equipe** (clique na etiqueta da equipe) e **balancear equipes**.
- **Preencher com bots** (modelos que cabem nas regras e no orçamento) e **remover todos os bots**.

**Durante a partida (botão 👑, ou Esc → Painel do anfitrião)**
- **Pausar/continuar** para todos (o tempo da partida não corre durante a pausa).
- **+5 min**, **encerrar a partida** e **anunciar** uma mensagem a todos.
- Ajustar **abates para vencer**, **tempo de reaparecimento** e **fogo amigo** ao vivo.
- **Expulsar/banir** jogadores e **remover bots** sem parar o jogo.

**Correção:** o servidor agora limita e valida todos esses comandos (só o anfitrião pode usá-los).

## v1.6.0
**Submarinos**
- 🚢 **Torre Submarina**: troque a ponte por ela e o navio vira submarino. **V** (ou o botão ⬇) mergulha/emerge.
- Submerso: some da visão normal e do radar (só sonar e colado a 110 detectam), **só leva torpedos, minas e cargas de profundidade** (tiros, morteiros e mísseis passam por cima) e só dispara torpedos e minas. Gasta **bateria** (60 s base, recarrega na superfície), vê menos longe (350) e perde 45% da força dos motores a diesel.
- Peças de submarino: **Periscópio** (visão submersa 650), **Tanque de Lastro** (mergulho mais rápido), **Bateria Extra**, **Lançador de Minas** (tecla **F**; minas invisíveis ao inimigo) e **Cargas de Profundidade** (contra submarinos).
- O sonar passivo ouve menos longe navios **silenciosos ou parados** (motor elétrico).
- 4 modelos novos: **Submarino**, **Submarino Minador**, **Caça-submarinos** e **Submarino Nuclear**. Os bots mergulham e emergem sozinhos.

**Mais peças**
- Motores: **Motor Elétrico** (silencioso, 100% submerso), **Turbina a Gás**, **Hidrojato** (ajuda a virar) e **Reator Nuclear** (bateria infinita).
- Torpedos: **Guiado** (curva até o alvo detectado; o Bloqueador atrapalha), **Pesado**, **Supercavitante** (muito rápido) e **Salva Tripla**.

**Bots configuráveis** (🤖 Bots)
- **Dificuldade** Fácil / Normal / Difícil / Mestre, **quantidade** na campanha, **onda inicial** e **quais modelos** podem aparecer (inclusive *Clone do meu navio*).
- **Escaramuça** offline: monte a batalha escolhendo quantos bots de cada modelo.
- **Bots no online**: o anfitrião adiciona/remove bots na sala (modelo, dificuldade e equipe). Eles rodam no navegador do anfitrião, enxergam pela própria visão (névoa de guerra) e aparecem no placar.
- Cada bot decide com a **própria detecção**: perde o alvo, procura no último ponto conhecido e divide a informação com a equipe.

**Zoom**
- **⚙ Opções**: zoom de 35% a 160% (menor = vê mais da tela). Na batalha: roda do mouse ou teclas **−/+**. Salvo no aparelho; no celular o padrão é 75%.

## v1.5.1
- 🌐 **Online sem servidor:** agora funciona só com o GitHub Pages. O navegador do anfitrião roda a lógica do servidor e os jogadores se conectam por **P2P (WebRTC/PeerJS)** usando um **código de sala** ou **link de convite** (`?sala=CODIGO`).
- A lógica do servidor foi extraída para `gameserver.js` (roda no navegador ou no Node); o servidor dedicado (`server/server.js`) continua disponível como opção avançada.
- Service worker passa a revalidar os arquivos (evita ficar com versão antiga em cache).

## v1.5.0
**Novo**
- 🌐 **Modo online** (cliente ↔ servidor ↔ clientes): salas com código, todos-contra-todos ou equipes, orçamento por sala, limite de abates e tempo, placar, reaparecimento e fim de partida. Servidor em `server/` (Node + `ws`) que também hospeda o jogo.
- 📱 **Celular**: joysticks na tela, botão de torpedo/míssil, layout responsivo, tela cheia/paisagem e **PWA** (instalável, offline na campanha). Pronto para **GitHub Pages**.
- 👁 **Sistema de visão**: névoa de guerra; só se vê até certo alcance (radar aumenta); minimapa mostra só o que foi detectado.
- 📡 **Sonar Passivo** e **Sonar Ativo** (pulso que revela contatos, mas denuncia quem pinga).
- 🥷 **Furtividade**: *Casco Furtivo* e *Gerador Furtivo*. Com 60% de cobertura o navio some do mapa, do sonar e das armas guiadas/torres automáticas; é revelado ao atirar, ao pingar sonar ou quando colado.
- Novas peças: **Radar**, **Bloqueador** (derruba a guiagem de mísseis), **Carregador Automático**, **Computador de Tiro**.
- Novos modelos: **Sentinela** (radar + sonar) e **Fantasma** (furtivo).
- IA que perde o alvo: vai ao último ponto conhecido e procura; inimigos furtivos são expostos de tempos em tempos para não travar a onda.

## v1.0
- Estaleiro em grade, dano por peça, campanha em ondas, 14 modelos, morteiros/mísseis/railgun/escudo/defesa pontual, blindagens, moedas e orçamento.
