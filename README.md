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
https://<server-ip>:8848/live/<room-name>                   # Broadcaster
https://<server-ip>:8848/live/<room-name>/viewer.html       # Viewer
```

`server` and `port` are auto-detected from the page URL. No manual configuration required.

**Multi-room support:** Different room names (e.g. `/live/alice`, `/live/bob`) are fully isolated. A single server can serve multiple broadcaster-viewer pairs simultaneously.

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
   https://<server-ip>:8848/live/<room-name>/viewer.html?token=xxxx
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
| `turn` | — | TURN server IP (TURN disabled if omitted) |
| `turnUser` | — | TURN username |
| `turnPass` | — | TURN password |

### Examples

Using example IP `203.0.113.1`, room `myroom`, agreed token `saki-lovelive`, TURN password `saki`:

```bash
# Broadcaster — token is edited or copied on the page
https://203.0.113.1:8848/live/myroom/?turn=203.0.113.1&turnUser=webrtc&turnPass=saki

# Viewer — token passed via query parameter
https://203.0.113.1:8848/live/myroom/viewer.html?token=saki-lovelive&turn=203.0.113.1&turnUser=webrtc&turnPass=saki

# Local files (server and room required)
file:///.../broadcaster.html?server=203.0.113.1&room=myroom&turn=203.0.113.1&turnUser=webrtc&turnPass=saki
file:///.../viewer.html?server=203.0.113.1&room=myroom&token=saki-lovelive&turn=203.0.113.1&turnUser=webrtc&turnPass=saki
```

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

Symmetric NAT environments (e.g. university campus networks) often block direct P2P connections. Consider deploying a TURN relay.

### Install Coturn

```bash
apt-get update && apt-get install -y coturn
```

### Configure `/etc/turnserver.conf` (see [example](coturn/turnserver.conf.example))

```conf
listening-port=3478
tls-listening-port=5349
listening-ip=<private-ip>    # NIC address, e.g. eth0
relay-ip=<private-ip>        # Same as above
external-ip=<public-ip>      # Public IP announced to peers
realm=<public-ip>
server-name=<public-ip>
lt-cred-mech
user=webrtc:<your-password>
total-quota=100
bps-capacity=0
stale-nonce
no-loopback-peers
```

**Note for cloud VMs:** `listening-ip` (private) and `external-ip` (public) must be set separately.

### Start

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

**Common pitfall:** omitting `49152-65535/udp` causes ICE to show `connected` but media stays black.

For cloud providers (Alibaba Cloud, AWS, etc.), you must additionally open these ports in the **security group**. UFW rules alone are not sufficient.

### Verify TURN

```bash
turnutils_uclient -t -u webrtc -w <password> -p 3478 <public-ip>
```

A `relay` address in the output confirms TURN is working.

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
