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

## 测试

```bash
cd server
npm test
```

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

### 步骤

1. 安装 Coturn 并配置 `coturn/turnserver.conf`
2. 安装 Caddy 并配置 `Caddyfile`
3. 更新 `client/broadcaster.js` 和 `client/viewer.js` 中的 `ICE_SERVERS` 填入 TURN 信息
4. `cd server && npm install && npm start`
5. Caddy 会自动处理 HTTPS 证书
