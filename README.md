[中文](README-zh.md)

# P2P WebRTC Live Streaming Demo

Single-room, 1v1, unidirectional WebRTC P2P live streaming demo.

> A simple P2P screen sharing system built for watching LoveLive with friends.

**Browser:** Chrome is recommended. Edge has known issues with WebSocket from `file://`, and other browsers may not fully support `getDisplayMedia` for screen sharing.

## Local Development

```bash
cd server
npm install
npm start
```

Open the HTML files under `client/` in a browser:

- Broadcaster: `client/broadcaster.html`
- Viewer: `client/viewer.html`

No query parameters needed for local dev — defaults to `localhost:8848`. Chrome allows `getDisplayMedia()` from `file://`.

## Two Access Methods

### Method 1: Remote HTTPS (Recommended)

The server serves static pages and WebSocket signaling — no local files needed. Both broadcaster and viewer just open a URL:

```
https://<server-ip>:8848/                   # Broadcaster
https://<server-ip>:8848/viewer.html        # Viewer
```

`server` and `port` are auto-detected from the page URL. No manual configuration required.

### Method 2: Local Files

HTML files opened from disk via `file://`. Use query parameters to point to a remote server:

```
file:///path/to/client/broadcaster.html?server=<server-ip>
file:///path/to/client/viewer.html?server=<server-ip>
```

**Note:** `getDisplayMedia` requires a secure context (HTTPS, localhost, or `file://`). For local file access, use **Chrome** — Edge restricts WebSocket connections from `file://`.

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

## URL Parameters

Optional overrides via query string:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `server` | auto | Signaling server hostname/IP (auto-detected from page URL) |
| `port` | auto | Signaling server port (auto-detected from page URL) |
| `turn` | — | TURN server IP (TURN disabled if omitted) |
| `turnUser` | — | TURN username |
| `turnPass` | — | TURN password |

### Examples

Using example IP `203.0.113.1` and TURN password `saki`:

```bash
# Remote access (HTTPS — server/port auto-detected)
https://203.0.113.1:8848/?turn=203.0.113.1&turnUser=webrtc&turnPass=saki
https://203.0.113.1:8848/viewer.html?turn=203.0.113.1&turnUser=webrtc&turnPass=saki

# Local files (server parameter required)
file:///.../broadcaster.html?server=203.0.113.1&turn=203.0.113.1&turnUser=webrtc&turnPass=saki
file:///.../viewer.html?server=203.0.113.1&turn=203.0.113.1&turnUser=webrtc&turnPass=saki
```

## Testing

```bash
cd server
npm test
```

## TURN Server Deployment

Symmetric NAT environments (e.g., university campus networks) often block direct P2P connections. A TURN relay is required for reliable media delivery.

### Install Coturn

```bash
apt-get update && apt-get install -y coturn
```

### Configure `/etc/turnserver.conf`

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

When killing old processes, avoid `pkill -f 'node server.js'` — it matches the SSH command line itself. Use `ps aux | grep -E '[n]ode.*server\.js' | awk '{print $2}' | xargs kill` instead.
