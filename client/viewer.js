const L = (navigator.language || '').startsWith('zh') ? {
  idle:            '准备就绪',
  waitingStream:   '等待主播推流...',
  streaming:       '观看中',
  joinBtn:         '加入观看',
  micDenied:       '麦克风权限被拒绝，不影响观看',
  qualityAuto:     '自动',
  qualityLow:      '标清',
  qualityHigh:     '高清',
  qualityCustom:   '自定义',
  roomFull:        '房间已满，无法加入',
  badToken:        'Token 错误，请重试',
  needToken:       '请输入房间 Token',
  broadcasterLeft: '主播已断开连接',
  connectionLost:  '连接断开',
  modalTitle:      '输入房间 Token',
  modalHint:       '请向主播索取房间 Token',
  confirmBtn:      '确认',
  cancelBtn:       '取消',
} : {
  idle:            'Ready',
  waitingStream:   'Waiting for broadcaster...',
  streaming:       'Watching',
  joinBtn:         'Join Stream',
  micDenied:       'Microphone access denied — watching unaffected',
  qualityAuto:     'Auto',
  qualityLow:      'Standard',
  qualityHigh:     'High',
  qualityCustom:   'Custom',
  roomFull:        'Room is full',
  badToken:        'Incorrect token — please try again',
  needToken:       'Enter the room token to join',
  broadcasterLeft: 'Broadcaster disconnected',
  connectionLost:  'Connection lost',
  modalTitle:      'Enter Room Token',
  modalHint:       'Ask the broadcaster for the room token',
  confirmBtn:      'Confirm',
  cancelBtn:       'Cancel',
};

const STATE = {
  IDLE: 'idle',
  WAITING_STREAM: 'waiting-stream',
  STREAMING: 'streaming'
};

function showToast(msg, type) {
  type = type || 'info';
  var container = document.getElementById('toastContainer');
  if (!container) return;
  var el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(function () {
    el.classList.add('toast-out');
    el.addEventListener('animationend', function () { el.remove(); });
  }, 3500);
}

class Viewer {
  constructor() {
    var self = this;
    this.state = STATE.IDLE;
    this.signaling = null;
    this.pc = null;
    this.pendingCandidates = [];
    this.micStream = null;
    this._modalOverlay = null;

    this.statusEl   = document.getElementById('status');
    this.remoteVideo = document.getElementById('remoteVideo');
    this.joinBtn    = document.getElementById('joinBtn');
    this.joinBtn.className = 'btn-primary';
    this.joinBtn.textContent = L.joinBtn;

    this.joinBtn.addEventListener('click', function () { self.join(); });

    this.qualityBar = document.getElementById('qualityBar');
    this.qualityButtons = this.qualityBar.querySelectorAll('button[data-quality]');
    this.customBitrate = document.getElementById('customBitrate');
    this.currentQuality = 'high';

    this.qualityButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var q = btn.dataset.quality;
        if (q === 'custom') {
          self.setQuality('custom');
          var v = parseInt(self.customBitrate.value);
          if (v && v >= 1000 && v <= 20000 && self.signaling && self.signaling.ws.readyState === WebSocket.OPEN) {
            self.signaling.send({ type: 'quality-change', quality: 'custom', maxBitrate: v * 1000 });
          }
        } else {
          self.setQuality(q);
          if (self.signaling && self.signaling.ws.readyState === WebSocket.OPEN) {
            self.signaling.send({ type: 'quality-change', quality: q });
          }
        }
      });
    });

    this.customBitrate.addEventListener('input', function () {
      var v = parseInt(self.customBitrate.value);
      document.getElementById('customBtn').disabled = !v || v < 1000 || v > 20000;
    });

    document.querySelector('[data-quality="auto"]').textContent = L.qualityAuto;
    document.querySelector('[data-quality="low"]').textContent = L.qualityLow;
    document.querySelector('[data-quality="high"]').textContent = L.qualityHigh;
    document.getElementById('customBtn').textContent = L.qualityCustom;
  }

  setState(s) {
    this.state = s;
    var map = {};
    map[STATE.IDLE] = L.idle;
    map[STATE.WAITING_STREAM] = L.waitingStream;
    map[STATE.STREAMING] = L.streaming;
    this.statusEl.textContent = map[s] || s;
  }

  /** Show the token input modal overlay. Returns a Promise that resolves with the token, or null if cancelled. */
  showTokenModal() {
    var self = this;
    return new Promise(function (resolve) {
      // Remove any existing modal
      if (self._modalOverlay) { self._modalOverlay.remove(); self._modalOverlay = null; }

      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML =
        '<div class="modal-card">' +
          '<h2>' + L.modalTitle + '</h2>' +
          '<p>' + L.modalHint + '</p>' +
          '<input type="text" id="modalTokenInput" maxlength="64" placeholder="Token" style="font-size:18px;letter-spacing:3px" autofocus>' +
          '<div class="modal-actions">' +
            '<button class="btn-ghost" id="modalCancelBtn">' + L.cancelBtn + '</button>' +
            '<button class="btn-primary" id="modalConfirmBtn">' + L.confirmBtn + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      self._modalOverlay = overlay;

      var input = overlay.querySelector('#modalTokenInput');
      input.focus();

      function submit() {
        var t = input.value.trim();
        if (t.length > 0) {
          self.hideModal();
          resolve(t);
        }
      }

      overlay.querySelector('#modalConfirmBtn').addEventListener('click', submit);
      overlay.querySelector('#modalCancelBtn').addEventListener('click', function () {
        self.hideModal();
        resolve(null);
      });
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
          self.hideModal();
          resolve(null);
        }
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') {
          self.hideModal();
          resolve(null);
        }
      });
    });
  }

  hideModal() {
    if (!this._modalOverlay) return;
    var overlay = this._modalOverlay;
    this._modalOverlay = null;
    overlay.classList.add('modal-out');
    overlay.addEventListener('animationend', function () { overlay.remove(); });
  }

  async join() {
    if (this.state !== STATE.IDLE) return;
    this.joinBtn.disabled = true;

    this.setState(STATE.WAITING_STREAM);
    this.qualityBar.style.display = 'flex';

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.warn(L.micDenied + ':', err.message);
      showToast(L.micDenied, 'warning');
      this.micStream = null;
    }

    this.pc = new RTCPeerConnection({ iceServers: window.CONFIG.iceServers });
    this.pc.addTransceiver('video', { direction: 'recvonly' });
    this.pc.addTransceiver('audio', { direction: 'sendrecv' });

    this.pc.ontrack = (e) => {
      if (!e.streams || !e.streams[0]) return;
      if (e.track.kind === 'video') {
        this.remoteVideo.srcObject = e.streams[0];
      } else if (e.track.kind === 'audio' && !e.streams[0].getVideoTracks().length) {
        var remoteAudio = document.getElementById('remoteAudio');
        if (remoteAudio) remoteAudio.srcObject = e.streams[0];
      }
    };

    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.signaling.sendIceCandidate(e.candidate);
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'connected') {
        this.setState(STATE.STREAMING);
      } else if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'disconnected') {
        showToast(L.connectionLost, 'error');
        this.reset();
      }
    };

    if (this.micStream) {
      this.micStream.getTracks().forEach(function (track) {
        this.pc.addTrack(track, this.micStream);
      }, this);
    }

    var self = this;
    this.signaling = new SignalingClient(window.CONFIG.wsUrl);
    this.signaling.addEventListener('open', function () {
      self.signaling.join('viewer', window.CONFIG.roomId, window.CONFIG.token);
    });
    this.signaling.addEventListener('offer', function (e) { self.onOffer(e.detail); });
    this.signaling.addEventListener('ice-candidate', function (e) { self.onIceCandidate(e.detail); });
    this.signaling.addEventListener('peer-left', function () {
      showToast(L.broadcasterLeft, 'warning');
      self.reset();
    });
    this.signaling.addEventListener('error', function () { self.reset(); });
    this.signaling.addEventListener('close', function () { self.reset(); });

    // Broadcaster came online — try to auth
    this.signaling.addEventListener('broadcaster-joined', function () {
      if (window.CONFIG.token) {
        self.signaling.auth(window.CONFIG.token);
      } else {
        showToast(L.needToken, 'info');
        self.showTokenModal().then(function (t) {
          if (t && self.signaling) self.signaling.auth(t);
        });
      }
    });

    // Auth rejected — show toast and prompt for token
    this.signaling.addEventListener('rejected', function (e) {
      var reason = e.detail && e.detail.reason;
      if (reason === 'bad-token') {
        showToast(L.badToken, 'error');
        self.showTokenModal().then(function (t) {
          if (t && self.signaling) self.signaling.auth(t);
        });
      } else if (reason === 'room-full') {
        showToast(L.roomFull, 'error');
      }
    });
  }

  async onOffer(_ref) {
    var sdp = _ref.sdp;
    await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: sdp }));
    await this.flushPendingCandidates();

    var answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.signaling.sendAnswer(answer.sdp);
  }

  async onIceCandidate(_ref2) {
    var candidate = _ref2.candidate;
    if (this.pc && this.pc.remoteDescription) {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      this.pendingCandidates.push(candidate);
    }
  }

  async flushPendingCandidates() {
    for (var i = 0; i < this.pendingCandidates.length; i++) {
      await this.pc.addIceCandidate(new RTCIceCandidate(this.pendingCandidates[i]));
    }
    this.pendingCandidates = [];
  }

  setQuality(quality) {
    this.currentQuality = quality;
    this.qualityButtons.forEach(function (b) { b.classList.remove('active'); });
    this.qualityBar.querySelector('[data-quality="' + quality + '"]').classList.add('active');
    this.customBitrate.disabled = (quality !== 'custom');
  }

  reset() {
    if (this.pc) { this.pc.close(); this.pc = null; }
    if (this.signaling) {
      try { this.signaling.ws.close(); } catch (_) { /* already closing/closed */ }
      this.signaling = null;
    }
    this.remoteVideo.srcObject = null;
    if (this.micStream) { this.micStream.getTracks().forEach(function (t) { t.stop(); }); this.micStream = null; }
    this.pendingCandidates = [];
    this.hideModal();
    this.setState(STATE.IDLE);
    this.joinBtn.disabled = false;
    this.qualityBar.style.display = 'none';
  }
}

new Viewer();
