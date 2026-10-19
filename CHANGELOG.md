# Changelog

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
