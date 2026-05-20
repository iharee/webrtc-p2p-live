const L = (navigator.language || '').startsWith('zh') ? {
  idle:          '准备就绪',
  waitingStream: '等待主播推流...',
  streaming:     '观看中',
  joinBtn:       '加入直播',
  micError:      '麦克风权限被拒绝',
  qualityAuto:   '自动',
  qualityLow:    '标清',
  qualityHigh:   '高清',
  qualityCustom: '自定义',
} : {
  idle:          'Ready',
  waitingStream: 'Waiting for broadcaster...',
  streaming:     'Watching',
  joinBtn:       'Join Stream',
  micError:      'Microphone access denied',
  qualityAuto:   'Auto',
  qualityLow:    'Standard',
  qualityHigh:   'High',
  qualityCustom: 'Custom',
};

const STATE = {
  IDLE: 'idle',
  WAITING_STREAM: 'waiting-stream',
  STREAMING: 'streaming'
};

class Viewer {
  constructor() {
    this.state = STATE.IDLE;
    this.signaling = null;
    this.pc = null;
    this.pendingCandidates = [];
    this.micStream = null;

    this.statusEl = document.getElementById('status');
    this.remoteVideo = document.getElementById('remoteVideo');
    this.joinBtn = document.getElementById('joinBtn');
    this.joinBtn.textContent = L.joinBtn;

    this.joinBtn.addEventListener('click', () => this.join());

    this.qualityBar = document.getElementById('qualityBar');
    this.qualityButtons = this.qualityBar.querySelectorAll('button[data-quality]');
    this.customBitrate = document.getElementById('customBitrate');
    this.currentQuality = 'high';

    this.qualityButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const q = btn.dataset.quality;
        if (q === 'custom') {
          this.setQuality('custom');
          const v = parseInt(this.customBitrate.value);
          if (v && v >= 1000 && v <= 20000) {
            this.signaling.send({ type: 'quality-change', quality: 'custom', maxBitrate: v * 1000 });
          }
        } else {
          this.setQuality(q);
          if (this.signaling && this.signaling.ws.readyState === WebSocket.OPEN) {
            this.signaling.send({ type: 'quality-change', quality: q });
          }
        }
      });
    });

    this.customBitrate.addEventListener('input', () => {
      const v = parseInt(this.customBitrate.value);
      document.getElementById('customBtn').disabled = !v || v < 1000 || v > 20000;
    });

    // Set initial button text from L
    document.querySelector('[data-quality="auto"]').textContent = L.qualityAuto;
    document.querySelector('[data-quality="low"]').textContent = L.qualityLow;
    document.querySelector('[data-quality="high"]').textContent = L.qualityHigh;
    document.getElementById('customBtn').textContent = L.qualityCustom;
  }

  setState(s) {
    this.state = s;
    const map = {
      [STATE.IDLE]: L.idle,
      [STATE.WAITING_STREAM]: L.waitingStream,
      [STATE.STREAMING]: L.streaming
    };
    this.statusEl.textContent = map[s] || s;
  }

  async join() {
    if (this.state !== STATE.IDLE) return;
    this.joinBtn.disabled = true;

    this.setState(STATE.WAITING_STREAM);
    this.qualityBar.style.display = 'flex';

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.warn(L.micError + ':', err.message);
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
        const remoteAudio = document.getElementById('remoteAudio');
        if (remoteAudio) remoteAudio.srcObject = e.streams[0];
      }
    };

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.signaling.sendIceCandidate(e.candidate);
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'connected') {
        this.setState(STATE.STREAMING);
      } else if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'disconnected') {
        this.reset();
      }
    };

    if (this.micStream) {
      this.micStream.getTracks().forEach(track => {
        this.pc.addTrack(track, this.micStream);
      });
    }

    this.signaling = new SignalingClient(window.CONFIG.wsUrl);
    this.signaling.addEventListener('open', () => this.signaling.join('viewer'));
    this.signaling.addEventListener('offer', (e) => this.onOffer(e.detail));
    this.signaling.addEventListener('ice-candidate', (e) => this.onIceCandidate(e.detail));
    this.signaling.addEventListener('peer-left', () => this.reset());
    this.signaling.addEventListener('error', () => this.reset());
    this.signaling.addEventListener('close', () => this.reset());
  }

  async onOffer({ sdp }) {
    await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    await this.flushPendingCandidates();

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.signaling.sendAnswer(answer.sdp);
  }

  async onIceCandidate({ candidate }) {
    if (this.pc && this.pc.remoteDescription) {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      this.pendingCandidates.push(candidate);
    }
  }

  async flushPendingCandidates() {
    for (const c of this.pendingCandidates) {
      await this.pc.addIceCandidate(new RTCIceCandidate(c));
    }
    this.pendingCandidates = [];
  }

  setQuality(quality) {
    this.currentQuality = quality;
    this.qualityButtons.forEach(b => b.classList.remove('active'));
    this.qualityBar.querySelector(`[data-quality="${quality}"]`).classList.add('active');
    this.customBitrate.disabled = (quality !== 'custom');
  }

  reset() {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.signaling) {
      try { this.signaling.ws.close(); } catch (_) { /* already closing/closed */ }
      this.signaling = null;
    }
    this.remoteVideo.srcObject = null;
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    this.pendingCandidates = [];
    this.setState(STATE.IDLE);
    this.joinBtn.disabled = false;
    this.qualityBar.style.display = 'none';
  }
}

new Viewer();
