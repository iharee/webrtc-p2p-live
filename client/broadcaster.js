const L = (navigator.language || '').startsWith('zh') ? {
  idle:              '准备就绪',
  preview:           '准备中...',
  waitingViewer:     '等待接收端加入...',
  streaming:         '推流中',
  startBtn:          '开始推流',
  tokenLabel:        'Token',
  saveBtn:           '保存',
  copyBtn:           '复制',
  copied:            '已复制',
  tokenSaved:        'Token 已保存',
  tokenCopied:       'Token 已复制到剪贴板',
  modalTitle:        '房间 Token',
  modalHint:         '将此 Token 分享给接收端即可加入观看',
  modalDone:         '完成',
  errorScreenshare:  '无法开始屏幕共享: ',
  errorNoScreenApi:  '当前浏览器不支持屏幕共享',
  errorScreenDenied: '屏幕共享权限被拒绝',
  micDenied:         '麦克风权限被拒绝，不影响推流',
  viewerJoined:      '接收端已加入',
  viewerLeft:        '接收端已离开',
  connectionLost:    '连接断开',
} : {
  idle:              'Ready',
  preview:           'Preparing...',
  waitingViewer:     'Waiting for viewer...',
  streaming:         'Live',
  startBtn:          'Start Streaming',
  tokenLabel:        'Token',
  saveBtn:           'Save',
  copyBtn:           'Copy',
  copied:            'Copied',
  tokenSaved:        'Token saved',
  tokenCopied:       'Token copied to clipboard',
  modalTitle:        'Room Token',
  modalHint:         'Share this token — viewers need it to join',
  modalDone:         'Done',
  errorScreenshare:  'Unable to start screen sharing: ',
  errorNoScreenApi:  'Screen sharing is not supported in this browser',
  errorScreenDenied: 'Screen sharing permission was denied',
  micDenied:         'Microphone access denied — streaming unaffected',
  viewerJoined:      'Viewer joined',
  viewerLeft:        'Viewer left',
  connectionLost:    'Connection lost',
};

const STATE = {
  IDLE: 'idle',
  PREVIEW: 'preview',
  WAITING_VIEWER: 'waiting-viewer',
  STREAMING: 'streaming'
};

function showToast(msg, type) {
  type = type || 'info';
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(function () {
    el.classList.add('toast-out');
    el.addEventListener('animationend', function () { el.remove(); });
  }, 3500);
}

class Broadcaster {
  constructor() {
    this.state = STATE.IDLE;
    this.signaling = null;
    this.pc = null;
    this.localStream = null;
    this.pendingCandidates = [];
    this.micStream = null;
    this.captureWidth = null;
    this.captureHeight = null;
    this.baselineBitrate = null;
    this.iceServers = null;

    this.statusEl   = document.getElementById('status');
    this.localVideo = document.getElementById('localVideo');
    this.startBtn   = document.getElementById('startBtn');
    this.startBtn.className = 'btn-primary';
    this.startBtn.textContent = L.startBtn;

    document.getElementById('tokenLabel').textContent = L.tokenLabel;

    this.startBtn.addEventListener('click', () => this.start());

    this.tokenInput = document.getElementById('tokenInput');
    this.tokenBtn   = document.getElementById('tokenBtn');
    this.tokenBtn.textContent = L.saveBtn;
    this.tokenInput.value = window.CONFIG.token || this.generateToken();

    this.tokenBtn.addEventListener('click', () => {
      if (this.state !== STATE.IDLE) {
        navigator.clipboard.writeText(this.tokenInput.value).then(
          () => showToast(L.tokenCopied, 'success'),
          () => {}
        );
      } else {
        const token = this.tokenInput.value.trim().toLowerCase();
        if (token && !/^[a-z0-9]{1,64}$/.test(token)) {
          showToast('Invalid token — a-z, 0-9 only', 'error');
        } else if (token) {
          this.tokenInput.value = token;
          showToast(L.tokenSaved, 'success');
        }
      }
    });
  }

  generateToken() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let t = '';
    for (let i = 0; i < 12; i++) t += chars[Math.floor(Math.random() * chars.length)];
    return t;
  }

  setState(s) {
    this.state = s;
    const map = {
      [STATE.IDLE]: L.idle,
      [STATE.PREVIEW]: L.preview,
      [STATE.WAITING_VIEWER]: L.waitingViewer,
      [STATE.STREAMING]: L.streaming
    };
    this.statusEl.textContent = map[s] || s;
  }

  /** Show a centered modal with the room token (read-only + copy). */
  showTokenModal(token) {
    // Remove any existing modal
    const prev = document.querySelector('.modal-overlay');
    if (prev) prev.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal-card">' +
        '<h2>' + L.modalTitle + '</h2>' +
        '<p>' + L.modalHint + '</p>' +
        '<input type="text" readonly value="' + token.replace(/"/g, '&quot;') + '">' +
        '<div class="modal-actions">' +
          '<button class="btn-ghost" id="modalCopyBtn">' + L.copyBtn + '</button>' +
          '<button class="btn-primary" id="modalDoneBtn">' + L.modalDone + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('#modalDoneBtn').addEventListener('click', () => this.hideModal(overlay));
    overlay.querySelector('#modalCopyBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(token).then(
        () => showToast(L.tokenCopied, 'success'),
        () => {}
      );
    });
    overlay.querySelector('input').addEventListener('click', function () { this.select(); });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.querySelector('#modalDoneBtn').click();
    });
  }

  hideModal(overlay) {
    overlay.classList.add('modal-out');
    overlay.addEventListener('animationend', function () { overlay.remove(); });
  }

  async start() {
    if (this.state !== STATE.IDLE) return;

    const rawToken = this.tokenInput.value.trim().toLowerCase();
    if (rawToken && !/^[a-z0-9]{1,64}$/.test(rawToken)) {
      showToast('Invalid token — a-z, 0-9 only', 'error');
      return;
    }

    this.startBtn.disabled = true;
    this.tokenInput.readOnly = true;
    this.tokenBtn.textContent = L.copyBtn;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      showToast(L.errorNoScreenApi, 'error');
      this.reset();
      return;
    }

    try {
      this.setState(STATE.PREVIEW);
      this.localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      this.localVideo.srcObject = this.localStream;

      const videoTrack = this.localStream.getVideoTracks()[0];
      const settings = videoTrack.getSettings();
      this.captureWidth = settings.width;
      this.captureHeight = settings.height;
      this.baselineBitrate = this.captureWidth * this.captureHeight * 2;

      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        console.warn(L.micDenied + ':', err.message);
        showToast(L.micDenied, 'warning');
        this.micStream = null;
      }

      this.signaling = new SignalingClient(window.CONFIG.wsUrl);
      const roomId = window.CONFIG.roomId;
      const token = this.tokenInput.value.trim().toLowerCase();
      this.signaling.addEventListener('open', () => this.signaling.join('broadcaster', roomId, token));
      this.signaling.addEventListener('joined', (e) => {
        const serverToken = e.detail && e.detail.token;
        if (serverToken && serverToken !== this.tokenInput.value) {
          this.tokenInput.value = serverToken;
        }
        if (e.detail && e.detail.iceServers) {
          this.iceServers = e.detail.iceServers;
        }
        this.setState(STATE.WAITING_VIEWER);
        this.showTokenModal(serverToken || this.tokenInput.value);
      });
      this.signaling.addEventListener('viewer-joined', () => {
        showToast(L.viewerJoined, 'success');
        this.onViewerJoined();
      });
      this.signaling.addEventListener('answer', (e) => this.onAnswer(e.detail));
      this.signaling.addEventListener('ice-candidate', (e) => this.onIceCandidate(e.detail));
      this.signaling.addEventListener('peer-left', () => {
        showToast(L.viewerLeft, 'warning');
        this.onPeerLeft();
      });
      this.signaling.addEventListener('error', () => {
        showToast(L.connectionLost, 'error');
        this.reset();
      });
      this.signaling.addEventListener('close', () => this.reset());
      this.signaling.addEventListener('quality-change', (e) => this.onQualityChange(e.detail));
    } catch (err) {
      const msg = err && err.name === 'NotAllowedError'
        ? L.errorScreenDenied
        : L.errorScreenshare + (err ? err.message : '');
      showToast(msg, 'error');
      this.reset();
    }
  }

  onPeerLeft() {
    if (this.pc) { this.pc.close(); this.pc = null; }
    this.pendingCandidates = [];
    this.setState(STATE.WAITING_VIEWER);
  }

  async onViewerJoined() {
    if (this.pc) { this.pc.close(); }
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers || [] });

    this.localStream.getTracks().forEach(track => {
      this.pc.addTrack(track, this.localStream);
    });

    if (this.micStream) {
      this.micStream.getTracks().forEach(track => {
        this.pc.addTrack(track, this.micStream);
      });
    }

    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.signaling.sendIceCandidate(e.candidate);
    };

    this.pc.ontrack = (e) => {
      if (e.track.kind === 'audio') {
        const remoteAudio = document.getElementById('remoteAudio');
        if (e.streams && e.streams[0]) remoteAudio.srcObject = e.streams[0];
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      if (this.pc.connectionState === 'connected') {
        this.setState(STATE.STREAMING);
      } else if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'disconnected') {
        showToast(L.connectionLost, 'warning');
        if (this.pc) { this.pc.close(); this.pc = null; }
        this.pendingCandidates = [];
        this.setState(STATE.WAITING_VIEWER);
      }
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.signaling.sendOffer(offer.sdp);
  }

  async onAnswer({ sdp }) {
    await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
    await this.flushPendingCandidates();
  }

  async onIceCandidate({ candidate }) {
    if (this.pc && this.pc.remoteDescription) {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      this.pendingCandidates.push(candidate);
    }
  }

  async onQualityChange({ quality, maxBitrate }) {
    if (!this.pc || !this.baselineBitrate) return;
    const videoSender = this.pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (!videoSender) return;
    const params = videoSender.getParameters();
    if (!params.encodings) params.encodings = [{}];
    if (quality === 'auto') {
      delete params.encodings[0].maxBitrate;
    } else if (quality === 'high') {
      params.encodings[0].maxBitrate = this.baselineBitrate;
    } else if (quality === 'low') {
      params.encodings[0].maxBitrate = Math.round(this.baselineBitrate * 0.5);
    } else if (quality === 'custom' && maxBitrate) {
      params.encodings[0].maxBitrate = maxBitrate;
    }
    try { await videoSender.setParameters(params); } catch (e) { console.warn('setParameters failed:', e); }
  }

  async flushPendingCandidates() {
    for (const c of this.pendingCandidates) {
      await this.pc.addIceCandidate(new RTCIceCandidate(c));
    }
    this.pendingCandidates = [];
  }

  reset() {
    if (this.pc) { this.pc.close(); this.pc = null; }
    if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }
    if (this.micStream) { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null; }
    const remoteAudio = document.getElementById('remoteAudio');
    if (remoteAudio) remoteAudio.srcObject = null;
    if (this.signaling) {
      try { this.signaling.ws.close(); } catch (_) { /* already closing/closed */ }
      this.signaling = null;
    }
    this.localVideo.srcObject = null;
    this.pendingCandidates = [];
    this.setState(STATE.IDLE);
    this.startBtn.disabled = false;
    this.tokenInput.readOnly = false;
    this.tokenBtn.textContent = L.saveBtn;
  }
}

new Broadcaster();
