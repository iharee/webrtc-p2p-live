[English](README.md)

# P2P WebRTC 双端直播

单房间、1v1 的 WebRTC P2P 屏幕共享与语音聊天系统。

> 是为和朋友一起看 LoveLive 而设计的！

**浏览器：** 推荐 Chrome。其他浏览器可能存在未知问题，未经详细测试与验证。

## 本地开发

```bash
cd server
npm install
npm start
```

浏览器打开 `client/` 下的 HTML 文件：

- Broadcaster: `client/broadcaster.html`
- Viewer: `client/viewer.html`

本地开发无需查询参数，默认连 `localhost:8848`。Chrome 允许 `file://` 路径使用 `getDisplayMedia()`。

## 两种访问方式

### 方式一：远程 HTTPS（推荐）

服务器提供静态页面和 WebSocket 信令，无需准备本地文件。主播和观众都只需打开对应 URL：

```
https://<服务器IP>:8848/                   # 主播端
https://<服务器IP>:8848/viewer.html        # 观众端
```

`server` 和 `port` 参数会自动从页面 URL 提取，无需手动填写。

### 方式二：本地文件

HTML 文件保存在本地，通过 `file://` 协议打开。需通过查询参数指定远程服务器：

```
file:///path/to/client/broadcaster.html?server=<服务器IP>
file:///path/to/client/viewer.html?server=<服务器IP>
```

**注意：** `getDisplayMedia` 要求安全上下文（HTTPS 或 localhost/`file://`）。本地文件方式请使用 **Chrome**，其他浏览器可能不支持 `file://` 下的 WebSocket。

## HTTPS 与证书

主播端使用 `getDisplayMedia` 进行屏幕共享，Chrome 要求安全上下文。服务器会自动检测 `cert.pem` / `key.pem`，存在则启用 HTTPS，否则退化为 HTTP（本地开发）。

### 生成自签名证书

```bash
openssl req -x509 -newkey rsa:2048 \
  -keyout /root/webrtc-server/key.pem \
  -out /root/webrtc-server/cert.pem \
  -days 3650 -nodes \
  -subj '/CN=<服务器IP>'
```

### 浏览器证书提示

自签名证书不被浏览器信任，首次访问会提示"您的连接不是私密连接"。点击 **"高级" → "继续前往（不安全）"** 即可。每个浏览器只需操作一次。

观众端不依赖安全上下文，但使用 HTTPS 可以避免 WebSocket 被中间设备干扰。

## URL 参数配置

支持通过 URL 查询参数覆盖配置：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `server` | 自动检测 | 信令服务器地址（远程访问时自动从页面 URL 提取） |
| `port` | 自动检测 | 信令服务器端口（同上） |
| `turn` | — | TURN 服务器 IP（不填不启用 TURN） |
| `turnUser` | — | TURN 用户名 |
| `turnPass` | — | TURN 密码 |

### 使用示例

使用示例 IP `203.0.113.1`，TURN 密码 `saki`：

```bash
# 远程访问（HTTPS，server/port 自动检测）
https://203.0.113.1:8848/?turn=203.0.113.1&turnUser=webrtc&turnPass=saki
https://203.0.113.1:8848/viewer.html?turn=203.0.113.1&turnUser=webrtc&turnPass=saki

# 本地文件（需指定 server）
file:///.../broadcaster.html?server=203.0.113.1&turn=203.0.113.1&turnUser=webrtc&turnPass=saki
file:///.../viewer.html?server=203.0.113.1&turn=203.0.113.1&turnUser=webrtc&turnPass=saki
```

## 测试

```bash
cd server
npm test
```

## TURN 服务器部署

大学校园网等对称 NAT 环境下 P2P 直连可能失败，考虑部署 TURN relay。

### 安装 Coturn

```bash
apt-get update && apt-get install -y coturn
```

### 配置 `/etc/turnserver.conf`（参考[示例](coturn/turnserver.conf.example)）

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

此外，云服务器（阿里云/腾讯云等）需要在**安全组**中额外开放以上端口，仅配置 UFW 是不够的。

### 验证 TURN

```bash
turnutils_uclient -t -u webrtc -w <密码> -p 3478 <公网IP>
```

输出中出现 `relay` 地址即表示 TURN 正常工作。

## 信令服务器部署

**前置条件：** 安装 [Node.js](https://nodejs.org/)（任意较新版本即可）。

### 文件结构

```
/root/webrtc-server/
├── server.js          # 信令 + 静态文件服务
├── cert.pem           # HTTPS 证书（可选，没有则 HTTP）
├── key.pem            # HTTPS 私钥（可选）
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

### systemd 服务

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
Environment=PORT=8848

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

Tip：关闭旧进程时避免用 `pkill -f 'node server.js'`，会匹配自身 SSH 命令行。用 `ps aux | grep -E '[n]ode.*server\.js' | awk '{print $2}' | xargs kill`。
