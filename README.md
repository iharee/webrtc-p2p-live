[中文](README.zh-CN.md)

# P2P WebRTC Live Streaming

A room-based 1v1 WebRTC P2P real-time streaming system featuring a Node.js signaling server and browser-based broadcaster/viewer implementations.

> Built for watching LoveLive with friends!

**Browser:** [Google Chrome](https://www.google.com/chrome/) is recommended. Other browsers may have unknown issues and have not been thoroughly tested.

Architecture overview:

- Node.js signaling server handles WebSocket room management and signaling relay;
- The broadcaster page captures screen + mic and pushes via WebRTC;
- The viewer page pulls the stream and optionally sends back mic audio;
- Media data flows over a direct P2P connection between the two peers.

> **Android broadcasters:** Chrome on Android does not expose `getDisplayMedia()`, so the web-based broadcaster cannot capture the screen on Android devices. Use [webrtc-p2p-live-android](https://github.com/iharee/webrtc-p2p-live-android) — a native Android app that replaces the browser capture path with `MediaProjection`, using the same signaling protocol and viewer experience.

## Quick Start

```bash
cd server
npm install
npm start
```

Open the HTML files under `client/` in a browser:

- Broadcaster: `client/broadcaster.html`
- Viewer: `client/viewer.html`

No query parameters needed for local dev — defaults to `localhost:8848`, room ID `default`. Chrome allows `getDisplayMedia()` from `file://`.

## Two Access Methods

### Method 1: Remote HTTPS (Recommended)

The server serves static pages and WebSocket signaling — no local files needed. Rooms are identified by URL path:

```
https://<host>/live/<room-name>                   # Broadcaster
https://<host>/live/<room-name>/viewer.html       # Viewer
```

**Multi-room support:** Different room names (e.g. `/live/saki`, `/live/ick`) are fully isolated. A single server can serve multiple broadcaster-viewer pairs simultaneously.

### Method 2: Local Files

HTML files opened from disk via `file://`. Use query parameters to point to a remote server and room:

```
file:///path/to/client/broadcaster.html?server=<server-ip>&room=<room-name>
file:///path/to/client/viewer.html?server=<server-ip>&room=<room-name>
```

**Note:** `getDisplayMedia` requires a secure context (HTTPS, localhost, or `file://`). For local file access, use **Chrome** — other browsers may not support WebSocket from `file://`.

## Token Auth

Room access is gated by a token.

### Broadcaster

- A random token is generated on page load and shown in the input field
- **Editable before streaming** — the broadcaster can change the token to a pre-agreed value (e.g. `ick`)
- **Locked after streaming starts** — the input becomes read-only, the button changes to "Copy" for easy sharing
- If the broadcaster disconnects, the token remains unchanged as long as any viewer or pending viewer is still connected (i.e. the room persists in the server Map)

### Viewer

The token can be provided in two ways. **Using a query parameter is recommended:**

1. **URL query parameter (recommended):**
   ```
   https://<host>/live/<room-name>/viewer.html?token=xxxx
   ```
   Auth is handled automatically — no extra steps needed.

2. **On-page input:** If the URL has no `token` parameter, a token input field appears once the broadcaster starts streaming. The viewer enters the token and clicks confirm.

### Token Behavior

| Scenario | Behavior |
|----------|----------|
| Correct token + slot available | Join the room and start receiving the stream |
| Wrong token | `bad-token` error — can retry |
| Room full | "Room full" message shown |
| Broadcaster not yet streaming | Viewer can wait in the room — auto-authenticated when the broadcaster starts |

**Security note:** For simplicity, there is no login / user system. A token is essentially "possession of the link = access." For stronger access control, use a sufficiently long and unguessable token.

## Quality Control

The viewer page provides a quality selector that signals the broadcaster to adjust encoding parameters via WebSocket. All quality tiers are computed dynamically from the broadcaster's actual screen resolution — no hardcoded bitrates, adaptive across different displays.

| Tier | Behavior |
|------|----------|
| **Auto** | No bitrate cap — fully delegated to browser GCC congestion control (default) |
| **High** | Bitrate = baseline (baseline = width × height × 2 bps) |
| **Standard** | Bitrate = baseline × 0.5 |
| **Custom** | Absolute bitrate in kbps — for scenarios requiring precise control |

**Baseline examples:** 1080p → ~4.1 Mbps, 2K → ~7.4 Mbps, 4K → ~16.6 Mbps.

Quality changes take effect immediately — no WebRTC renegotiation required.

## Bidirectional Voice

Both the broadcaster and the viewer capture mic audio independently via `getUserMedia`. Two separate audio tracks are sent over WebRTC. The viewer can hear the broadcaster and vice versa.

- **System audio (movie/discord audio):** Captured by `getDisplayMedia` with `audio: true`. Fully supported in Chrome; not supported in Safari.
- **Microphone (voice chat):** Captured separately by `getUserMedia`. Silently degrades on permission denial — screen sharing is unaffected.

## URL Parameters

Optional overrides via query string:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `server` | auto | Signaling server hostname/IP (auto-detected from page URL) |
| `port` | auto | Signaling server port (auto-detected from page URL) |
| `room` | URL path | Room ID (extracted from `/live/<room-name>` on remote access) |
| `token` | — | Room access token (viewers should include this; broadcasters ignore it) |

### Examples

Using example IP `203.0.113.1`, room `myroom`, agreed token `saki`:

```
# Broadcaster
https://203.0.113.1:8848/live/myroom/

# Viewer — token passed via query parameter
https://203.0.113.1:8848/live/myroom/viewer.html?token=saki

# Local files (server and room required)
file:///.../broadcaster.html?server=203.0.113.1&room=myroom
file:///.../viewer.html?server=203.0.113.1&room=myroom&token=saki
```

TURN credentials are delivered dynamically by the signaling server after room join — no query parameters needed.

## HTTPS & Certificates

The broadcaster uses `getDisplayMedia` for screen sharing, which requires a secure context in Chrome. The server auto-detects `cert.pem` / `key.pem` and enables HTTPS when present; otherwise it falls back to HTTP (local dev).

### Generate a Self-Signed Certificate

```bash
openssl req -x509 -newkey rsa:2048 \
  -keyout /root/webrtc-server/key.pem \
  -out /root/webrtc-server/cert.pem \
  -days 3650 -nodes \
  -subj '/CN=<server-ip>'
```

### Browser Certificate Warning

Self-signed certificates are not trusted by browsers. On first visit you'll see "Your connection is not private." Click **"Advanced" → "Proceed to (unsafe)"**. This is a one-time step per browser.

The viewer does not require a secure context, but HTTPS helps prevent middleboxes from interfering with the WebSocket connection.

## Testing

```bash
cd server
npm test
```

## TURN Server Deployment

Direct P2P connections fail when both peers are behind restrictive NAT — common in university campus networks, corporate firewalls, and mobile carrier CGNAT. TURN relay guarantees connectivity by routing media through your server.

**TURN credentials are delivered via WebSocket after room join** — never exposed in static files or URLs. Set these environment variables before starting the server:

| Variable | Example | Description |
|----------|---------|-------------|
| `TURN_HOST` | `47.113.225.81` | TURN server IP or hostname |
| `TURN_SECRET` | `your-secret-here` | Shared secret for HMAC credential generation (must match coturn `static-auth-secret`) |
| `TURN_CREDENTIAL_TTL` | `300` | Credential lifetime in seconds (default: 300 = 5 minutes) |

If `TURN_HOST` and `TURN_SECRET` are both set, the signaling server generates temporary HMAC-SHA1 credentials per room and delivers them inside the `joined` WebSocket message. Each credential is valid for `TURN_CREDENTIAL_TTL` seconds.

ICE configuration delivered to authenticated peers:

```json
{
  "iceServers": [
    { "urls": "stun:stun.miwifi.com:3478" },
    { "urls": "stun:stun.qq.com:3478" },
    { "urls": "stun:stun.cloudflare.com:3478" },
    {
      "urls": [
        "turn:<TURN_HOST>:3478?transport=udp",
        "turn:<TURN_HOST>:3478?transport=tcp"
      ],
      "username": "<expiry-timestamp>:<roomId>",
      "credential": "<hmac-sha1-base64>"
    }
  ]
}
```

Once configured, the broadcaster and viewer URLs are the final form — no TURN parameters needed:

```
https://<host>/live/<room-name>                   # Broadcaster
https://<host>/live/<room-name>/viewer.html?token=xxxx  # Viewer
```

### Rationale

Relying on a single public STUN server (e.g. `stun.l.google.com`) is not robust enough in complex real-world network environments:

| Network environment | Google STUN | TURN relay |
|--------|-------------|------------|
| Typical home broadband | Usually reachable | Not needed (light NAT) |
| Restrictive networks (campus/enterprise) | Often blocked or throttled | **Required** |
| Carrier-grade NAT (CGNAT) | May fail intermittently | **Strongly recommended** |
| Corporate firewall | Typically blocked | **Required** |

**Common failure mode:** the Google STUN server is blocked or rate-limited in restrictive network environments. ICE gathers no `srflx` candidates and, without TURN, the connection may silently fail. Multiple STUN sources + a default TURN relay eliminate this single point of failure.

### Install Coturn

```bash
apt-get update && apt-get install -y coturn
```

### Configure `/etc/turnserver.conf`

```conf
listening-port=3478
tls-listening-port=5349
listening-ip=<private-ip>        # NIC address (e.g. 172.17.191.160)
relay-ip=<private-ip>            # Same as listening-ip
external-ip=<public-ip>          # Public IP announced to peers

# TLS certificate for TURNS (required for tls-listening-port to work)
cert=/path/to/cert.pem
pkey=/path/to/key.pem

realm=<public-ip>
server-name=<public-ip>
use-auth-secret
static-auth-secret=<your-secret-here>
total-quota=100
bps-capacity=0
stale-nonce
no-loopback-peers
```

> **Important:** `static-auth-secret` must match the `TURN_SECRET` environment variable on the signaling server. The signaling server generates temporary HMAC-SHA1 credentials using this shared secret — coturn validates them against the same secret.

See [`coturn/turnserver.conf.example`](coturn/turnserver.conf.example) for a full annotated example.

**Important:** `cert=` and `pkey=` are required for `tls-listening-port=5349`. If they are missing, coturn **silently skips** the TLS listener — port 5349 will not listen and `turns:` candidates will never work.

**Cloud VMs:** `listening-ip` (private) and `external-ip` (public) must be set separately.

### TLS Certificates for TURNS

**Self-signed certificates will NOT work for TURNS in browsers.** Chrome, Android WebView, and native WebRTC stacks perform strict TLS validation on TURN connections — the browser's "proceed anyway" exception for the page does NOT extend to the TURN TLS layer.

For production use, put a domain on the server and obtain a real certificate via Let's Encrypt:

```bash
certbot certonly --standalone -d turn.example.com
```

Then reference the issued cert in `turnserver.conf`:

```conf
cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
```

While waiting for a domain, TCP TURN (`turn:...:3478?transport=tcp`) is the most reliable fallback — it works through most firewalls and does not require TLS.

### Start Coturn

```bash
systemctl enable coturn && systemctl start coturn
```

### Firewall Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 3478 | TCP+UDP | STUN/TURN signaling |
| 5349 | TCP+UDP | TURN over TLS |
| 49152-65535 | UDP | TURN relay data channels |

```bash
ufw allow 3478/tcp && ufw allow 3478/udp
ufw allow 5349/tcp && ufw allow 5349/udp
ufw allow 49152:65535/udp
```

**Cloud providers** (Alibaba Cloud, AWS, etc.): open these ports in the **security group** as well. UFW rules alone are not sufficient.

### Verify TURN

Generate a test credential (replace `<secret>` with your `static-auth-secret`):

```bash
SECRET="<secret>"
EXPIRES=$(( $(date +%s) + 300 ))
USERNAME="${EXPIRES}:test"
PASSWORD=$(echo -n "$USERNAME" | openssl dgst -sha1 -hmac "$SECRET" | awk '{print $NF}')
turnutils_uclient -t -u "$USERNAME" -w "$PASSWORD" -p 3478 <public-ip>
```

A `relay` address in the output confirms TURN relay is functioning.

If the output shows only `srflx` or `host` but no `relay`, check firewall rules and the coturn log:

```bash
journalctl -u coturn -f
```

### ICE Troubleshooting Checklist

When a viewer cannot connect:

1. **Open Browser DevTools → Network → WS tab.** Inspect the `joined` message — verify `iceServers` contains TURN URLs, username, and credential
2. **Check `chrome://webrtc-internals`** (Chrome) or `about:webrtc` (Firefox) — look at the selected candidate pair. If it's `host-host` but the peers are on different networks, ICE is not working
3. **No `relay` candidate?** TURN is not configured or not reachable — check server env vars and coturn status
4. **No `srflx` candidate?** STUN is not reachable — multiple STUN servers are delivered via signaling as fallbacks
5. **`turns:` candidate timeouts?** Verify the cert is from a trusted CA (not self-signed)

## Signaling Server Deployment

**Prerequisites:** [Node.js](https://nodejs.org/) (any recent version).

### File Layout

```
/root/webrtc-server/
├── server.js          # Signaling + static file server
├── cert.pem           # HTTPS certificate (optional — HTTP if absent)
├── key.pem            # HTTPS private key (optional)
├── node_modules/
└── client/
    ├── config.js
    ├── signaling.js
    ├── style.css
    ├── broadcaster.html
    ├── broadcaster.js
    ├── viewer.html
    └── viewer.js
```

### systemd Service

Create `/etc/systemd/system/webrtc-server.service`:

```ini
[Unit]
Description=WebRTC Signaling Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /root/webrtc-server/server.js
Restart=always
RestartSec=5
Environment=PORT=8848
Environment=TURN_HOST=47.113.225.81
Environment=TURN_SECRET=your-secret-here
Environment=TURN_CREDENTIAL_TTL=300

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now webrtc-server
```

Common commands:

```bash
systemctl status webrtc-server        # Check status
journalctl -u webrtc-server -f        # Follow logs
systemctl restart webrtc-server       # Restart
```

Tip: when killing old processes, avoid `pkill -f 'node server.js'` — it matches the SSH command line itself. Use `ps aux | grep -E '[n]ode.*server\.js' | awk '{print $2}' | xargs kill` instead.
