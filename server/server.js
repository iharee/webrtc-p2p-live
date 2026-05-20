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
  if (urlPath === '/') urlPath = '/broadcaster.html';

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

let broadcaster = null;
let viewer = null;

function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

const log = (ip, msg) => console.log(`[${new Date().toISOString()}] [${ip}] ${msg}`);

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  log(ip, 'connected');

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
        handleJoin(ws, msg.role);
        break;
      case 'offer':
        if (ws === broadcaster && viewer) send(viewer, msg);
        break;
      case 'answer':
        if (ws === viewer && broadcaster) send(broadcaster, msg);
        break;
      case 'ice-candidate':
        if (ws === broadcaster && viewer) {
          send(viewer, msg);
        } else if (ws === viewer && broadcaster) {
          send(broadcaster, msg);
        }
        break;
      default:
        console.warn('Unknown message type:', msg.type);
    }
  });

  ws.on('close', (code, reason) => {
    const role = ws === broadcaster ? 'broadcaster' : ws === viewer ? 'viewer' : 'unknown';
    log(ip, `disconnected (role=${role}, code=${code}, reason=${reason || 'none'})`);
    if (ws === broadcaster) {
      broadcaster = null;
      if (viewer) send(viewer, { type: 'peer-left' });
    } else if (ws === viewer) {
      viewer = null;
      if (broadcaster) send(broadcaster, { type: 'peer-left' });
    }
  });
});

function handleJoin(ws, role) {
  if (role === 'broadcaster') {
    if (broadcaster) {
      send(ws, { type: 'rejected', reason: 'broadcaster-exists' });
      ws.close();
      return;
    }
    broadcaster = ws;
    send(ws, { type: 'joined' });
  } else if (role === 'viewer') {
    if (viewer) {
      send(ws, { type: 'rejected', reason: 'viewer-exists' });
      ws.close();
      return;
    }
    viewer = ws;
    send(ws, { type: 'joined' });
    if (broadcaster) {
      send(broadcaster, { type: 'viewer-joined' });
    }
  }
}

server.listen(PORT, () => {
  const proto = isHttps ? 'https' : 'http';
  console.log(`Server running on ${proto}://localhost:${PORT}`);
});
