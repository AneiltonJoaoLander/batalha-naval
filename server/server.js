'use strict';
/* =====================================================================
   SERVIDOR DEDICADO (opcional) do Batalha Naval — Node + WebSocket.
   O jogo online padrão NÃO precisa dele (usa P2P pelo GitHub Pages, com o
   anfitrião como servidor). Use este programa se quiser uma sala sempre
   ligada, ou hospedar o jogo + multijogador no mesmo endereço.

   Uso:  npm install && npm start        (porta: variável PORT, padrão 8787)
   ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const G = require('../parts.js');
const { createGameServer } = require('../gameserver.js');

const PORT = +process.env.PORT || 8787;
const ROOT = path.join(__dirname, '..');
const gs = createGameServer();

/* ------------------------------------------------------------ arquivos estáticos */
const STATIC = new Set(['index.html', 'style.css', 'parts.js', 'gameserver.js', 'builder.js', 'touch.js', 'battle.js', 'net.js', 'main.js', 'config.js',
  'manifest.json', 'sw.js', 'vendor/peerjs.min.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png']);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, ''); } catch (e) { p = ''; }
  if (p === 'health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, game: 'batalha-naval', version: G.VERSION, rooms: gs.rooms.size, players: gs.players.size }));
    return;
  }
  if (p === '') p = 'index.html';
  if (!STATIC.has(p)) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Não encontrado'); return; }
  fs.readFile(path.join(ROOT, p), (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Não encontrado'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
});

/* ------------------------------------------------------------------ WebSocket */
const wss = new WebSocketServer({ server, maxPayload: 128 * 1024 });
wss.on('connection', ws => {
  if (gs.players.size >= 400) { ws.close(1013, 'cheio'); return; }
  ws.isAlive = true;
  const p = gs.connect(s => { if (ws.readyState === 1) ws.send(s); });
  ws.on('message', data => gs.message(p, data.toString()));
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => gs.disconnect(p));
  ws.on('error', () => {});
});
setInterval(() => {                                               // derruba conexões mortas
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; try { ws.ping(); } catch (e) { /* ignore */ }
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`Batalha Naval v${G.VERSION} — servidor dedicado na porta ${PORT}`);
  console.log(`  Jogo + multijogador:  http://localhost:${PORT}   |   saúde: /health`);
});
