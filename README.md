# P2P WebRTC 双端直播 Demo

单房间、1v1、单向媒体流的 WebRTC P2P 直播 Demo。

## 本地开发

```bash
cd server
npm install
npm start
```

用浏览器打开：

- Broadcaster: `client/broadcaster.html`
- Viewer: `client/viewer.html`

注意：Chrome 允许 localhost 使用 `getUserMedia()`，无需 HTTPS。

## URL 参数配置

Broadcaster 和 Viewer 页面支持通过 URL 查询参数配置，无需编辑代码：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `server` | `localhost` | 信令服务器地址 |
| `port` | `8080` | 信令服务器端口 |
| `turn` | — | TURN 服务器 IP（不填不启用 TURN） |
| `turnUser` | — | TURN 用户名 |
| `turnPass` | — | TURN 密码 |

### 使用示例

```text
# 本地开发（无参数，默认 localhost:8080）
broadcaster.html

# 远端信令服务器
broadcaster.html?server=182.92.168.150

# 完整 TURN relay（校园网等复杂网络环境需要）
viewer.html?server=182.92.168.150&turn=182.92.168.150&turnUser=webrtc&turnPass=你的密码
```

## 测试

```bash
cd server
npm test
```

## TURN 服务器部署

大学校园网等对称 NAT 环境下 P2P 直连可能失败，必须部署 TURN relay。

### 安装 Coturn

```bash
apt-get update && apt-get install -y coturn
```

### 配置 `/etc/turnserver.conf`

```conf
listening-port=3478
tls-listening-port=5349
listening-ip=<内网IP>       # 本机网卡 IP，如 eth0 地址
relay-ip=<内网IP>           # 同上
external-ip=<公网IP>        # 对外广播的公网 IP
realm=<公网IP>
server-name=<公网IP>
lt-cred-mech
user=webrtc:<你的密码>
total-quota=100
bps-capacity=0
stale-nonce
no-loopback-peers
```

**注意：云服务器需要区分 `listening-ip`（内网）和 `external-ip`（公网）。**

### 启动

```bash
systemctl enable coturn && systemctl start coturn
```

### 防火墙端口

| 端口 | 协议 | 用途 |
|------|------|------|
| 3478 | TCP+UDP | STUN/TURN 信令 |
| 5349 | TCP+UDP | TURN over TLS |
| 49152-65535 | UDP | TURN relay 数据通道 |

```bash
ufw allow 3478/tcp && ufw allow 3478/udp
ufw allow 5349/tcp && ufw allow 5349/udp
ufw allow 49152:65535/udp
```

**常见陷阱：漏开 49152-65535/udp 会导致 ICE 状态 connected 但画面黑屏。**

### 验证 TURN

```bash
turnutils_uclient -t -u webrtc -w <密码> -p 3478 <公网IP>
```

输出中出现 `relay` 地址即表示 TURN 正常工作。

## 公网部署

### 环境

- Ubuntu 22.04
- Node.js LTS
- Coturn
- Caddy

### 端口

| 服务 | 端口 | 协议 |
|------|------|------|
| Web | 80, 443 | TCP |
| TURN/STUN | 3478, 5349 | TCP + UDP |
| TURN Relay | 49152-65535 | UDP |

### 信令服务器 systemd 管理

创建 `/etc/systemd/system/webrtc-server.service`：

```ini
[Unit]
Description=WebRTC Signaling Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /root/webrtc-server/server.js
Restart=always
RestartSec=5
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now webrtc-server
```

常用命令：

```bash
systemctl status webrtc-server        # 查看状态
journalctl -u webrtc-server -f        # 实时日志
systemctl restart webrtc-server       # 重启
```

注意：停止旧 nohup 进程时不要用 `pkill -f 'node server.js'`，这会匹配自身 SSH 命令行导致退出。用 `ps aux | grep -E '[n]ode.*server\.js' | awk '{print $2}' | xargs kill`。

### 步骤

1. 安装 Coturn 并配置 `coturn/turnserver.conf`
2. 安装 Caddy 并配置 `Caddyfile`
3. 更新 `client/broadcaster.js` 和 `client/viewer.js` 中的 `ICE_SERVERS` 填入 TURN 信息
4. `cd server && npm install && npm start`
5. Caddy 会自动处理 HTTPS 证书
