// Parse URL query parameters for runtime configuration.
// When served from the signaling server, server/port are auto-detected
// from the page URL — no query params needed.
const p = new URLSearchParams(location.search);

const cfg = {
  server:   p.get('server')   || location.hostname || 'localhost',
  port:     p.get('port')     || location.port     || '8848',
  turn:     p.get('turn')     || null,
  turnUser: p.get('turnUser') || null,
  turnPass: p.get('turnPass') || null,
};

// Derive WebSocket signaling URL
cfg.wsUrl = location.protocol === 'https:'
  ? `wss://${cfg.server}:${cfg.port}`
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
