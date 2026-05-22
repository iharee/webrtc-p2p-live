// Parse URL query parameters for runtime configuration.
// When served from the signaling server, server/port are auto-detected
// from the page URL — no query params needed.
const p = new URLSearchParams(location.search);

// Extract roomId from path: /live/<roomId> or /live/<roomId>/viewer.html
const parts = location.pathname.replace(/^\/+|\/+$/g, '').split('/');
const roomIdx = parts.indexOf('live');
const roomId = (roomIdx !== -1 && parts[roomIdx + 1]) ? parts[roomIdx + 1] : 'default';

const rawToken = p.get('token');
const token = rawToken && /^[a-z0-9]{1,64}$/i.test(rawToken.trim())
  ? rawToken.trim().toLowerCase()
  : null;
if (rawToken && !token) console.warn('Invalid token in URL — ignored:', rawToken);

const cfg = {
  server:   p.get('server')   || location.hostname || 'localhost',
  port:     p.get('port')     || location.port     || '8848',
  turn:     p.get('turn')     || null,
  turnUser: p.get('turnUser') || null,
  turnPass: p.get('turnPass') || null,
  roomId:   roomId,
  token:    token,
};

// Derive WebSocket signaling URL
cfg.wsUrl = location.protocol === 'https:'
  ? `wss://${cfg.server}:${cfg.port}`
  : `ws://${cfg.server}:${cfg.port}`;

// Derive ICE server list; include TURN only if configured
cfg.iceServers = [
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.qq.com:3478' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// Server-injected TURN servers — replaced at serve time
cfg.iceServers = cfg.iceServers.concat(__TURN_SERVERS__);
if (cfg.turn) {
  cfg.iceServers.push({
    urls: [
      `turn:${cfg.turn}:3478`,                    // UDP (fastest)
      `turn:${cfg.turn}:3478?transport=tcp`,      // TCP fallback
      `turns:${cfg.turn}:5349`,                   // TLS fallback (hardest to block)
    ],
    username:   cfg.turnUser,
    credential: cfg.turnPass,
  });
}

console.log('ICE servers', cfg.iceServers);

window.CONFIG = cfg;
