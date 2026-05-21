const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
};

const CLIENT_DIR = path.join(__dirname, 'client');

// Use HTTPS if cert/key exist, otherwise plain HTTP (local dev)
let isHttps = false;
let server;
const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  isHttps = true;
  server = require('https').createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, handleRequest);
} else {
  server = require('http').createServer(handleRequest);
}

function handleRequest(req, res) {
  let urlPath = req.url.split('?')[0];

  // / → broadcaster.html
  // /live/*/viewer.html → viewer.html
  // /live/* or any path without extension → broadcaster.html
  // /style.css, /config.js etc → served as-is (root-relative)
  if (urlPath === '/') {
    urlPath = '/broadcaster.html';
  } else if (urlPath.endsWith('/viewer.html')) {
    urlPath = '/viewer.html';
  } else if (!urlPath.includes('.')) {
    urlPath = '/broadcaster.html';
  }

  const filePath = path.join(CLIENT_DIR, urlPath);
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  const ext = path.extname(filePath);
  if (!MIME[ext]) {
    res.writeHead(404);
    return res.end('Not Found');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] });
    res.end(data);
  });
}

const wss = new WebSocket.Server({ server });

const MAX_VIEWERS = 1;
const TOKEN_LENGTH = 12;

const rooms = new Map();  // roomId → { token, broadcaster, viewers Set<ws>, pendingViewers Set<ws> }

function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

const log = (ip, msg) => console.log(`[${new Date().toISOString()}] [${ip}] ${msg}`);

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  log(ip, 'connected');

  ws.roomId = null;
  ws.role = null;

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join':
        handleJoin(ws, msg);
        break;
      case 'auth':
        handleAuth(ws, msg.token);
        break;
      case 'offer':
        if (ws.role === 'broadcaster') {
          const room = rooms.get(ws.roomId);
          if (room) room.viewers.forEach(v => send(v, msg));
        }
        break;
      case 'answer':
        if (ws.role === 'viewer') {
          const room = rooms.get(ws.roomId);
          if (room && room.broadcaster) send(room.broadcaster, msg);
        }
        break;
      case 'quality-change':
        if (ws.role === 'viewer') {
          const room = rooms.get(ws.roomId);
          if (room && room.broadcaster) send(room.broadcaster, msg);
        }
        break;
      case 'ice-candidate':
        {
          const room = rooms.get(ws.roomId);
          if (!room) break;
          if (ws.role === 'broadcaster') {
            room.viewers.forEach(v => send(v, msg));
          } else if (ws.role === 'viewer' && room.broadcaster) {
            send(room.broadcaster, msg);
          }
        }
        break;
      default:
        console.warn('Unknown message type:', msg.type);
    }
  });

  ws.on('close', (code) => {
    log(ip, `disconnected (role=${ws.role}, room=${ws.roomId}, code=${code})`);

    if (!ws.roomId) return;
    const room = rooms.get(ws.roomId);
    if (!room) return;

    if (ws.role === 'broadcaster') {
      room.broadcaster = null;
      room.viewers.forEach(v => send(v, { type: 'peer-left' }));
      room.pendingViewers.forEach(v => send(v, { type: 'peer-left' }));
    } else if (ws.role === 'viewer') {
      room.viewers.delete(ws);
      room.pendingViewers.delete(ws);
      if (room.broadcaster) send(room.broadcaster, { type: 'peer-left' });
    }

    // Clean up room if empty
    if (!room.broadcaster && room.viewers.size === 0 && room.pendingViewers.size === 0) {
      rooms.delete(ws.roomId);
    }
  });
});

function handleJoin(ws, msg) {
  const { role, roomId, token } = msg;
  if (!roomId || !role) {
    send(ws, { type: 'rejected', reason: 'missing-roomId-or-role' });
    return;
  }

  let room = rooms.get(roomId);
  if (!room) {
    room = { token: null, broadcaster: null, viewers: new Set(), pendingViewers: new Set() };
    rooms.set(roomId, room);
  }

  ws.roomId = roomId;
  ws.role = role;

  if (role === 'broadcaster') {
    if (room.broadcaster) {
      send(ws, { type: 'rejected', reason: 'broadcaster-exists' });
      return;
    }
    room.token = token || generateToken();
    room.broadcaster = ws;
    send(ws, { type: 'joined', token: room.token });

    // Process pending viewers — first with matching token wins
    for (const vw of room.pendingViewers) {
      if (room.viewers.size >= MAX_VIEWERS) break;
      const vToken = vw._pendingToken;
      if (vToken && vToken === room.token) {
        room.pendingViewers.delete(vw);
        room.viewers.add(vw);
        send(vw, { type: 'joined' });
        send(ws, { type: 'viewer-joined' });
      }
    }

    // Notify remaining pending viewers that broadcaster is here
    room.pendingViewers.forEach(vw => {
      send(vw, { type: 'broadcaster-joined' });
    });
  } else if (role === 'viewer') {
    ws._pendingToken = token || null;

    if (room.broadcaster && room.token) {
      if (ws._pendingToken === room.token) {
        if (room.viewers.size >= MAX_VIEWERS) {
          send(ws, { type: 'rejected', reason: 'room-full' });
          return;
        }
        room.viewers.add(ws);
        send(ws, { type: 'joined' });
        send(room.broadcaster, { type: 'viewer-joined' });
      } else if (ws._pendingToken && ws._pendingToken !== room.token) {
        send(ws, { type: 'rejected', reason: 'bad-token' });
        return;
      } else {
        room.pendingViewers.add(ws);
        send(ws, { type: 'broadcaster-joined' });
      }
    } else {
      room.pendingViewers.add(ws);
      send(ws, { type: 'joined' });
    }
  }
}

function generateToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

function handleAuth(ws, token) {
  if (ws.role !== 'viewer') return;
  const room = rooms.get(ws.roomId);
  if (!room || !room.token) return;

  if (token === room.token) {
    if (room.viewers.size >= MAX_VIEWERS) {
      send(ws, { type: 'rejected', reason: 'room-full' });
      return;
    }
    room.pendingViewers.delete(ws);
    room.viewers.add(ws);
    send(ws, { type: 'joined' });
    if (room.broadcaster) {
      send(room.broadcaster, { type: 'viewer-joined' });
    }
  } else {
    send(ws, { type: 'rejected', reason: 'bad-token' });
  }
}

server.listen(PORT, () => {
  const proto = isHttps ? 'https' : 'http';
  console.log(`Server running on ${proto}://localhost:${PORT}`);
});
