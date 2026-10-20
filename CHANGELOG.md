# Changelog

## v1.9.2 — armas nucleares só como balísticos
- **Removidos** os 7 mísseis de cruzeiro especiais da v1.9.1 (nuclear, fragmentação, perfurante, incendiário, EMP, supersônico e anti-radiação) e o **torpedo nuclear**. Projetos salvos que usavam peças removidas as perdem automaticamente (sem quebrar o jogo).
- **Novos mísseis balísticos** (marque no minimapa, lance com B): **Nuclear** (260 de raio, incendeia, atordoa, zera escudos e dá um clarão; recarga de 90 s), **MIRV** (6 ogivas em área), **Incendiário**, **EMP**, **Hipersônico** (chega em ~1 s) e **Perfurante** (dano enorme no ponto).
- Os torpedos novos continuam: mini, acústico, magnético e cacheiro. A regra "Permitir armas nucleares" da sala vale para o balístico nuclear.
- O **Cruzador Tático** agora usa mísseis de cruzeiro comuns e balísticos incendiário e EMP.

## v1.9.1 — mais mísseis, mais torpedos e otimização
**Mísseis de cruzeiro novos**
- **Nuclear:** ogiva de 230 de raio; incendeia tudo, atordoa a tripulação, zera escudos e cega a tela com um clarão. Lento (recarga de 60 s), a defesa pontual pode derrubá-lo.
- **Fragmentação** (5 submunições em área), **Perfurante** (fere as 2 peças seguintes), **Incendiário** (napalm), **EMP** (zera escudo e atordoa 7 s), **Supersônico** (a defesa pontual falha mais) e **Anti-radiação** (caça radar e sonar, mira no equipamento).
**Torpedos novos**
- **Mini-torpedos** (2 por salva), **Acústico** (trava no navio mais barulhento, até submarinos que você não vê), **Magnético** (explode sob o casco com rombo maior), **Cacheiro** (divide em 3 depois de 1 s) e **Nuclear submarino** (240 de raio, atinge submarinos).
- Novos modelos prontos: **Cruzador Tático** e **Submarino Acústico**.
**Online**
- Nova regra da sala: **Permitir armas nucleares** (o servidor recusa projetos e disparos nucleares quando proibido); as ogivas especiais são repassadas e validadas.
**Desempenho**
- Névoa de guerra desenhada em baixa resolução e ampliada (era o maior custo por quadro).
- Navios com casco e sombra em cache (refeitos só quando uma peça muda), ilhas em sprite, fundo do minimapa em cache.
- Colisão tiro × casco por grade numérica (sem montar texto por teste), partículas fora da tela descartadas, HUD atualizado a ~15 Hz e só quando o valor muda.
- Resultado no teste de estresse (11 navios, ilhas, drones): de ~11,3 ms para ~7 ms por quadro.

## v1.9.0 — mísseis, balísticos, drones, ilhas e novos modos
**Armas**
- **Mísseis de cruzeiro antinavio:** leve / médio / pesado × lock **radar**, **térmico**, **GPS** e **teleguiado** (12 modelos). O térmico mira no motor mais potente do alvo; o GPS vai às coordenadas do cursor; o teleguiado segue o cursor.
- **Mísseis balísticos** (pequeno, médio, grande): clique no **minimapa** para marcar a região e lance com **B** (ou o botão 🎯 no celular). Arco longo, imunes a defesa pontual e bloqueador; o inimigo recebe o alerta com contagem regressiva e a área de impacto.
- **Lançador de Flares:** isca os mísseis térmicos. Bloqueador e defesa pontual passam a ser agrupados em *Contramedidas*.
- **Metralhadoras agora atacam drones** (têm prioridade e antecipam o movimento).
- **5 drones novos:** Escolta (metralhadora), Bombardeiro, Torpedeiro, Enxame (3 mini-drones suicidas) e Radar AEW (visão 720).
- **5 placas de convés novas:** Pesada, Cerâmica, Titânio, Corta-fogo e Isolante Térmica.
- 3 modelos novos: **Fragata Lança-mísseis**, **Defesa Aérea** e **Cruzador Balístico**.

**Mapas**
- **Ilhas** invencíveis (poucas, normais ou muitas): navios colidem, tiros diretos e torpedos param, bots desviam; morteiros, balísticos e drones passam por cima.
- **7 ambientes:** mar aberto, arquipélago tropical, ártico, tempestade (chuva e raios), nevoeiro, noite e costa vulcânica, com efeitos na visão. Escolha no 🤖 Bots (campanha/offline) ou nas regras da sala (online); a semente é sorteada pelo anfitrião e todos veem o mesmo mapa.

**Modos de partida** (online e contra bots, com equipes)
- **Controle de Zona:** 3 zonas de captura; cada zona dominada rende 1 ponto por segundo. Primeiro a atingir a meta (ou quem lidera no fim do tempo) vence.
- **Comboio:** a equipe A escolta um cargueiro (só anda com escolta por perto) até o destino; a equipe B ataca. Se o cargueiro afundar, **renasce** no último ponto de controle (vidas configuráveis).
- Contra bots há aliados configuráveis e renascimento automático.

**Outros**
- Colisões levam em conta a massa dos navios (o mais pesado é empurrado menos).
- Código do navio (copiar/colar) agora é seguro para as novas peças (UTF-8).
- Servidor: valida mísseis/balísticos pelo projeto, repassa o alerta balístico a todos e limita drones a 750 de visão.

## v1.8.1 — correção
- **Corrigido:** no modo online sem servidor, o anfitrião não conseguia iniciar a partida quando havia outro jogador humano na sala (a função que esconde a tripulação inimiga não existia no navegador). Partidas só com bots já funcionavam.

## v1.8.0 — combate de perto, alagamento, fogo, drones e tripulação
- **Armas de corpo a corpo:** Espinhos, Serra Giratória, Aríete, Gancho de Abordagem (reduz a velocidade do alvo) e Bobina de Choque (atordoa peças).
- **Cascos e blindagens:** Casco Cerâmico, de Titânio, Compartimentado (vaza menos), Flutuante (aguenta mais água), Corta-fogo, e placas de convés (Aço e Reativa).
- **Alagamento:** o casco rompido deixa entrar água; ao encher o navio afunda, e a água o deixa mais lento. Novas peças: Bomba de Esgoto e Sistema Anti-Incêndio. Submarinos alagados não seguram a profundidade.
- **Fogo:** chance de incêndio ao atingir uma peça; as chamas causam dano, se espalham e podem detonar munição. Cascos corta-fogo resistem.
- **Drones (hangares):** Reconhecimento (visão extra), Ataque (bombas) e Suicida (explode no alvo). Podem ser derrubados por metralhadoras e defesa pontual; os bots também os usam. Novo preset **Porta-drones**, além de Abordador e Titã.
- **Tripulação:** nova camada no estaleiro com círculos invisíveis para o inimigo. Cada grupo dá um bônus (recarga, motores, reparo/vazamentos, incêndio, giro, sensores, abordagem) e o perde se a peça sob ele for danificada ou destruída.
- **Online:** água, fogo e drones são sincronizados; o servidor não envia a tripulação do projeto aos inimigos e valida os novos campos.
- Observação: a v1.7 foi os controles do anfitrião; os drones de reconhecimento também ampliam a névoa de guerra no online.

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
