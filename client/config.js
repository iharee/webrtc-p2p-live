// Parse URL query parameters for runtime configuration
const p = new URLSearchParams(location.search);

const cfg = {
  server:   p.get('server')   || 'localhost',
  port:     p.get('port')     || '8848',
  turn:     p.get('turn')     || null,
  turnUser: p.get('turnUser') || null,
  turnPass: p.get('turnPass') || null,
};

// Derive WebSocket signaling URL
cfg.wsUrl = location.protocol === 'https:'
  ? `wss://${cfg.server}/ws`
  : `ws://${cfg.server}:${cfg.port}`;

// Derive ICE server list; include TURN only if configured
cfg.iceServers = [
  { urls: 'stun:stun.l.google.com:19302' }
];
if (cfg.turn) {
  cfg.iceServers.push({
    urls:       `turn:${cfg.turn}:3478`,
    username:   cfg.turnUser,
    credential: cfg.turnPass,
  });
}

window.CONFIG = cfg;
