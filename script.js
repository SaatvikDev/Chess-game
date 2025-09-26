// server.js
// Simple pairing WebSocket server for chess matches.
// Usage: npm install express ws
//        node server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

// serve static files (optional) - if you place index.html in ./public
app.use(express.static(path.join(__dirname, 'public')));

let waiting = []; // queue of sockets waiting for opponent
let matches = new Map(); // socket -> {opponent, color}

function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (e) { }
}

// When a client connects
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (message) => {
    let msg = null;
    try { msg = JSON.parse(message); } catch (e) { return; }

    if (msg.type === 'join') {
      // push to queue and try to match
      ws.preferred = msg.preferred || 'random';
      waiting.push(ws);
      send(ws, { type:'info', text: 'Joined queue. Waiting for opponent...' });
      tryMatch();
    } else if (msg.type === 'move') {
      // relay move to opponent
      const m = matches.get(ws);
      if (m && m.opponent && m.opponent.readyState === WebSocket.OPEN) {
        send(m.opponent, { type:'move', from: msg.from, to: msg.to, promotion: msg.promotion });
      }
    } else if (msg.type === 'leave') {
      ws.close();
    }
  });

  ws.on('close', () => {
    // cleanup: if in waiting remove, if in match notify opponent
    waiting = waiting.filter(s => s !== ws);
    const m = matches.get(ws);
    if (m && m.opponent && m.opponent.readyState === WebSocket.OPEN) {
      send(m.opponent, { type:'info', text: 'Opponent disconnected.' });
      matches.delete(m.opponent);
    }
    matches.delete(ws);
  });
});

function tryMatch() {
  while (waiting.length >= 2) {
    const a = waiting.shift();
    const b = waiting.shift();
    // Decide colors, try to respect preferred
    let colorA = 'white';
    let colorB = 'black';
    if (a.preferred === 'black' && b.preferred !== 'black') { colorA = 'black'; colorB = 'white'; }
    else if (b.preferred === 'black' && a.preferred !== 'black') { colorA = 'white'; colorB = 'black'; }
    else if (a.preferred === 'random' && b.preferred !== 'random') {
      // let b get preferred
      if (b.preferred === 'white') { colorA='black'; colorB='white'; }
    } else if (a.preferred === 'white' && b.preferred !== 'white') { colorA='white'; colorB='black'; }
    else {
      // randomize
      if (Math.random() > 0.5) { colorA = 'white'; colorB = 'black'; } else { colorA='black'; colorB='white'; }
    }
    // store match
    matches.set(a, { opponent: b, color: colorA });
    matches.set(b, { opponent: a, color: colorB });
    // notify both
    send(a, { type:'paired', color: colorA });
    send(b, { type:'paired', color: colorB });
  }
}

// heartbeat to kill dead sockets
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 30000);

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});


