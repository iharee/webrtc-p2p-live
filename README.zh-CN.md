[English](README.md)

# P2P WebRTC 双端直播

基于房间的 1v1 WebRTC P2P 实时流媒体系统，包含 Node.js 信令服务器与 broadcaster/viewer 浏览器端实现。

> 是为和亲友一起看 LoveLive 而设计的！

**浏览器：**推荐 [Google Chrome](https://www.google.com/chrome/)。其他浏览器可能存在未知问题，未经详细的测试与验证。

架构简述：

- Node.js 信令服务器负责 WebSocket 房间管理与信令转发；
- 前端 broadcaster 采集屏幕与麦克风并通过 WebRTC 推流；
- 前端 viewer 拉流并可选回传麦克风音频；
- 双端通过 P2P 直连传输媒体数据。

> **Android 推流端：**Android 版 Chrome 没有暴露 `getDisplayMedia()` API，因此 web 端 broadcaster 无法在 Android 设备上采集屏幕。请使用 [webrtc-p2p-live-android](https://github.com/iharee/webrtc-p2p-live-android) —— 一个原生的 Android 应用，以 `MediaProjection` 替代浏览器采集，信令协议与 viewer 体验是完全一致的。

## 快速上手

```bash
cd server
npm install
npm start
```

浏览器打开 `client/` 下的 HTML 文件：

- Broadcaster: `client/broadcaster.html`
- Viewer: `client/viewer.html`

本地开发无需查询参数，默认连 `localhost:8848`，房间 ID 为 `default`。Chrome 允许 `file://` 路径使用 `getDisplayMedia()`。

## 两种访问方式

### 方式一：远程 HTTPS（推荐）

服务器提供静态页面和 WebSocket 信令，无需准备本地文件。房间通过 URL 路径区分：

```
https://<服务器IP>:8848/live/<房间名>                   # broadcaster
https://<服务器IP>:8848/live/<房间名>/viewer.html       # viewer
```

`server` 和 `port` 参数会自动从页面 URL 提取，无需手动填写。

**多房间支持：**不同房间名（如 `/live/alice`、`/live/bob`）完全隔离，同一台服务器可同时服务多对 broadcaster-viewer。

### 方式二：本地文件

HTML 文件保存在本地，通过 `file://` 协议打开。需通过查询参数指定远程服务器和房间：

```
file:///path/to/client/broadcaster.html?server=<服务器IP>&room=<房间名>
file:///path/to/client/viewer.html?server=<服务器IP>&room=<房间名>
```

**注意：**`getDisplayMedia` 要求安全上下文（HTTPS 或 localhost/`file://`）。本地文件方式请使用 **Chrome**，其他浏览器可能不支持 `file://` 下的 WebSocket。

## Token 鉴权

系统通过 token 控制房间访问。

### broadcaster

- 页面打开后自动生成一个随机 token，显示在输入框中
- **开播前可编辑** — 可以将 token 改为与 viewer 协商好的值（如 `ick`）
- **开播后锁定** — token 变为只读，按钮变为「复制」，方便发送至 viewer
- broadcaster 离线后，当且仅当 broadcaster 与 viewer 均离线，否则 token 不变（即服务器中 Map 内容不移除）

### viewer

Token 提供两种输入方式，**推荐使用查询参数**：

1. **URL 查询参数（推荐）：**
   ```
   https://<服务器IP>:8848/live/<房间名>/viewer.html?token=xxxx
   ```
   系统自动鉴权，无需额外操作。

2. **页面内输入：**如果 URL 不带 `token` 参数，broadcaster 开播后页面上会显示 token 输入框，viewer 手动输入后点击确认。

### Token 行为

| 场景 | 行为 |
|------|------|
| Token 正确 + 房间有空位 | 加入房间，开始接收推流 |
| Token 错误 | 提示 `bad-token`，可重试 |
| 房间已满 | 提示「房间已满」 |
| broadcaster 未开播 | viewer 可提前进入等待，broadcaster 开播后自动鉴权 |

**安全提示：**简便起见，系统不使用登录 / 用户系统。Token 本质是「拥有链接 = 拥有访问权」。如需更严格的访问控制，建议使用足够长且不可猜测的 token。

## 画质控制

viewer 提供画质选择栏，通过 WebSocket 信令通知 broadcaster 调整编码参数。所有画质档位基于 broadcaster 屏幕实际分辨率动态计算，无硬编码码率，不同屏幕自适应。

| 档位 | 行为 |
|------|------|
| **自动** | 不设码率上限，完全交给浏览器 GCC 自适应调节（默认） |
| **高清** | 码率 = baseline（baseline = 宽 × 高 × 2 bps） |
| **标清** | 码率 = baseline × 0.5 |
| **自定义** | 输入绝对码率值（kbps），适用于需要精确控制的场景 |

**baseline 示例：**1080p → ~4.1Mbps、2K → ~7.4Mbps、4K → ~16.6Mbps。

画质调整无需重新协商 WebRTC 连接，即时生效。

## 双向语音

broadcaster 和 viewer 各通过 `getUserMedia` 单独采集麦克风音频，两个独立的音频轨道通过 WebRTC 发送。viewer 说话时 broadcaster 能听到，反之亦然。

- **系统声音（电影音频）：**由 `getDisplayMedia` 的 `audio: true` 捕获。Chrome 完整支持，Safari 不支持。
- **麦克风（语音交流）：**由 `getUserMedia` 单独采集。权限被拒绝时静默降级，不影响屏幕共享。

## URL 参数配置

支持通过 URL 查询参数覆盖配置：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `server` | 自动检测 | 信令服务器地址（远程访问时自动从页面 URL 提取） |
| `port` | 自动检测 | 信令服务器端口（同上） |
| `room` | URL 路径提取 | 房间 ID（远程访问时从 `/live/<房间名>` 提取） |
| `token` | — | 房间访问 token（viewer 建议携带，broadcaster 忽略此参数） |
| `turn` | — | TURN 服务器 IP（覆盖服务端注入的默认值；如服务端已配环境变量，TURN 自动生效） |
| `turnUser` | — | TURN 用户名（覆盖） |
| `turnPass` | — | TURN 密码（覆盖） |

### 使用示例

使用示例 IP `203.0.113.1`，房间 `myroom`，协商 token `saki-lovelive`：

```bash
# broadcaster
https://203.0.113.1:8848/live/myroom/

# viewer — token 通过查询参数传入
https://203.0.113.1:8848/live/myroom/viewer.html?token=saki-lovelive

# 本地文件（需指定 server 和 room）
file:///.../broadcaster.html?server=203.0.113.1&room=myroom
file:///.../viewer.html?server=203.0.113.1&room=myroom&token=saki-lovelive
```

TURN 由服务端自动注入，无需在 URL 中指定。仅在需要覆盖默认 relay 时使用 `?turn=` 参数。

## HTTPS 与证书

broadcaster 使用 `getDisplayMedia` 进行屏幕共享，Chrome 要求安全上下文。服务器会自动检测 `cert.pem` / `key.pem`，存在则启用 HTTPS，否则退化为 HTTP（本地开发）。

### 生成自签名证书

```bash
openssl req -x509 -newkey rsa:2048 \
  -keyout /root/webrtc-server/key.pem \
  -out /root/webrtc-server/cert.pem \
  -days 3650 -nodes \
  -subj '/CN=<服务器IP>'
```

### 浏览器证书提示

自签名证书不被浏览器信任，首次访问会提示「您的连接不是私密连接」。点击**「高级」 → 「继续前往（不安全）」**即可。每个浏览器只需操作一次。

viewer 不依赖安全上下文，但使用 HTTPS 可以避免 WebSocket 被中间设备干扰。

## 测试

```bash
cd server
npm test
```

## TURN 服务器部署

当通信双方均处于严格 NAT 之后（大学校园网、企业防火墙、运营商 CGNAT），P2P 直连大概率失败。TURN relay 通过服务器中转媒体数据，保证连接可用。

**信令服务器会自动将 TURN 配置注入客户端页面**，无需在 URL 中拼接参数。启动服务器前设置环境变量：

| 变量 | 示例 | 说明 |
|------|------|------|
| `TURN_HOST` | `182.92.168.150` | TURN 服务器 IP 或域名 |
| `TURN_USER` | `webrtc` | TURN 长期凭据用户名 |
| `TURN_PASS` | `your-password` | TURN 长期凭据密码 |

设置 `TURN_HOST` 后，服务端会将完整的 ICE 配置（含三级 relay URL、用户名、密码）注入每个客户端页面：

```
turn:<TURN_HOST>:3478                    # UDP（最快）
turn:<TURN_HOST>:3478?transport=tcp      # TCP 回退（更难被阻断）
turns:<TURN_HOST>:5349                   # TLS 回退（需有效证书）
```

配置完成后，双端 URL 即为最终形式，无需附加任何 TURN 参数：

```
https://<服务器IP>:8848/live/<房间名>                   # broadcaster
https://<服务器IP>:8848/live/<房间名>/viewer.html?token=xxxx  # viewer
```

凭据（用户名、密码）不出服务器，不暴露在链接、浏览器历史记录或截图中。

本地开发或需临时覆盖默认 relay 时，仍可通过 `?turn=` / `?turnUser=` / `?turnPass=` 查询参数指定。

### 必要性

仅依赖单一公共 STUN 服务器（如 `stun.l.google.com`）在真实的复杂网络环境中是不够稳健的：

| 网络环境 | Google STUN | TURN relay |
|------|-------------|------------|
| 典型家用宽带 | 通常可达 | 不需要（NAT 较宽松） |
| 受限网络环境（校园网、企业内网） | 经常被屏蔽或限流 | **必须** |
| 运营商级 NAT (CGNAT) | 可能间歇性失败 | **强烈建议** |
| 企业防火墙 | 通常被屏蔽 | **必须** |

**常见故障模式：**Google STUN 在受限网络环境中常被屏蔽或限速，ICE 无法收集 `srflx` candidate，若此时无 TURN 支持 —— 连接可能静默失败。多 STUN 来源 + 默认 TURN relay 可以消除这一单点风险。

### 安装 Coturn

```bash
apt-get update && apt-get install -y coturn
```

### 配置 `/etc/turnserver.conf`

```conf
listening-port=3478
tls-listening-port=5349
listening-ip=<内网IP>           # 本机网卡 IP（如 172.17.191.160）
relay-ip=<内网IP>               # 同上
external-ip=<公网IP>            # 对外广播的公网 IP

# TURNS TLS 证书（tls-listening-port 需要此配置才能生效）
cert=/path/to/cert.pem
pkey=/path/to/key.pem

realm=<公网IP>
server-name=<公网IP>
lt-cred-mech
user=webrtc:<你的密码>
total-quota=100
bps-capacity=0
stale-nonce
no-loopback-peers
```

完整注释版示例见 [`coturn/turnserver.conf.example`](coturn/turnserver.conf.example)。

**注意：**`cert=` 和 `pkey=` 是 `tls-listening-port=5349` 的必需项。如果缺失，coturn **不会报错但 silent 跳过** TLS 监听 —— 端口 5349 将不会监听，`turns:` candidate 永远不可用。

**云服务器需区分 `listening-ip`（内网）和 `external-ip`（公网）。**

### TURNS 的 TLS 证书

**自签名证书无法用于浏览器的 TURNS 连接。**Chrome、Android WebView 及原生 WebRTC 栈对 TURN 的 TLS 校验非常严格 —— 浏览器页面的「继续前往（不安全）」例外仅适用于页面自身，不会扩展至 TURN TLS 层。

生产环境建议配置域名并通过 Let's Encrypt 获取正式证书：

```bash
certbot certonly --standalone -d turn.example.com
```

然后在 `turnserver.conf` 中引用：

```conf
cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
```

在域名就绪前，TCP TURN（`turn:...:3478?transport=tcp`）是最可靠的回退方案 —— 无需 TLS，且能穿透大多数防火墙。

### 启动 Coturn

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

**云服务器**（阿里云、AWS 等）需在**安全组**中额外开放以上端口，仅配置 UFW 是不够的。

### 验证 TURN

```bash
turnutils_uclient -t -u webrtc -w <密码> -p 3478 <公网IP>
```

输出中出现 `relay` 地址即表示 TURN relay 正常工作。

若只出现 `srflx` 或 `host` 而无 `relay`，检查防火墙规则并查看 coturn 日志：

```bash
journalctl -u coturn -f
```

### ICE 排错清单

当 viewer 无法连接时：

1. **打开浏览器 DevTools → Console。**查找 `ICE servers` 日志 — 确认 TURN URL、用户名、密码已被注入
2. **打开 `chrome://webrtc-internals`**（Chrome）或 `about:webrtc`（Firefox）— 检查 selected candidate pair。如果显示 `host-host` 但双方在不同网络 → ICE 未工作
3. **无 `relay` candidate？**TURN 未配置或不可达 — 检查服务端环境变量和 coturn 运行状态
4. **无 `srflx` candidate？**STUN 不可达 — `config.js` 中的多 STUN 列表会提供回退
5. **`turns:` candidate 持续超时？**确认证书来自受信任 CA（非自签名）

## 信令服务器部署

**前置条件：**安装 [Node.js](https://nodejs.org/)（任意较新版本即可）。

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

Tip：关闭旧进程时避免用 `pkill -f 'node server.js'`，这会匹配自身 SSH 命令行。考虑 `ps aux | grep -E '[n]ode.*server\.js' | awk '{print $2}' | xargs kill`。
