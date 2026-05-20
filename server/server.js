const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let broadcaster = null;
let viewer = null;

function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

wss.on('connection', (ws) => {
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
        if (viewer) send(viewer, msg);
        break;
      case 'answer':
        if (broadcaster) send(broadcaster, msg);
        break;
      case 'ice-candidate':
        if (ws === broadcaster && viewer) {
          send(viewer, msg);
        } else if (ws === viewer && broadcaster) {
          send(broadcaster, msg);
        }
        break;
    }
  });

  ws.on('close', () => {
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

console.log(`Signaling server running on ws://localhost:${PORT}`);
