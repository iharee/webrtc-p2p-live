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
  roomId:   roomId,
  token:    token,
};

// Derive WebSocket signaling URL
cfg.wsUrl = location.protocol === 'https:'
  ? `wss://${cfg.server}:${cfg.port}`
  : `ws://${cfg.server}:${cfg.port}`;

window.CONFIG = cfg;
