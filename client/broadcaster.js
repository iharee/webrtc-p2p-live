
const L = (navigator.language || '').startsWith('zh') ? {
  idle:            '准备就绪',
  preview:         '准备中...',
  waitingViewer:   '等待观众加入...',
  streaming:       '直播中',
  startBtn:        '开始直播',
  errorScreenshare:'无法开始屏幕共享: ',
  qualityAuto:  '自动',
  qualityLow:   '标清',
  qualityHigh:  '高清',
  qualityCustom:'自定义',
} : {
  idle:            'Ready',
  preview:         'Preparing...',
  waitingViewer:   'Waiting for viewer...',
  streaming:       'Live',
  startBtn:        'Start Streaming',
  errorScreenshare:'Unable to start screen sharing: ',
  qualityAuto:  'Auto',
  qualityLow:   'Standard',
  qualityHigh:  'High',
  qualityCustom:'Custom',
};

const STATE = {
  IDLE: 'idle',
  PREVIEW: 'preview',
  WAITING_VIEWER: 'waiting-viewer',
  STREAMING: 'streaming'
};

class Broadcaster {
  constructor() {
    this.state = STATE.IDLE;
    this.signaling = null;
    this.pc = null;
    this.localStream = null;
    this.pendingCandidates = [];

    this.statusEl = document.getElementById('status');
    this.localVideo = document.getElementById('localVideo');
    this.startBtn = document.getElementById('startBtn');
    this.startBtn.textContent = L.startBtn;

    this.startBtn.addEventListener('click', () => this.start());
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

  async start() {
    if (this.state !== STATE.IDLE) return;
    this.startBtn.disabled = true;

    try {
      this.setState(STATE.PREVIEW);
      this.localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: true
      });
      this.localVideo.srcObject = this.localStream;

      this.signaling = new SignalingClient(window.CONFIG.wsUrl);
      this.signaling.addEventListener('open', () => this.signaling.join('broadcaster'));
      this.signaling.addEventListener('joined', () => this.setState(STATE.WAITING_VIEWER));
      this.signaling.addEventListener('viewer-joined', () => this.onViewerJoined());
      this.signaling.addEventListener('answer', (e) => this.onAnswer(e.detail));
      this.signaling.addEventListener('ice-candidate', (e) => this.onIceCandidate(e.detail));
      this.signaling.addEventListener('peer-left', () => this.reset());
      this.signaling.addEventListener('error', () => this.reset());
      this.signaling.addEventListener('close', () => this.reset());
      this.signaling.addEventListener('quality-change', (e) => this.onQualityChange(e.detail));
    } catch (err) {
      alert(L.errorScreenshare + err.message);
      this.reset();
    }
  }

  async onViewerJoined() {
    this.pc = new RTCPeerConnection({ iceServers: window.CONFIG.iceServers });

    this.localStream.getTracks().forEach(track => {
      this.pc.addTrack(track, this.localStream);
    });

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

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    const videoSender = this.pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (videoSender) {
      const params = videoSender.getParameters();
      if (!params.encodings) params.encodings = [{}];
      params.encodings[0].maxBitrate = 4000000;
      try { await videoSender.setParameters(params); } catch (e) { console.warn('setParameters failed:', e); }
    }
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
    if (!this.pc) return;
    const videoSender = this.pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (!videoSender) return;
    const params = videoSender.getParameters();
    if (!params.encodings) params.encodings = [{}];
    if (quality === 'auto') {
      delete params.encodings[0].maxBitrate;
      delete params.encodings[0].scaleResolutionDownBy;
    } else if (quality === 'low') {
      params.encodings[0].maxBitrate = 1500000;
      params.encodings[0].scaleResolutionDownBy = 1.5;
    } else if (quality === 'high') {
      params.encodings[0].maxBitrate = 4000000;
      params.encodings[0].scaleResolutionDownBy = undefined;
    } else if (quality === 'custom' && maxBitrate) {
      params.encodings[0].maxBitrate = maxBitrate;
      params.encodings[0].scaleResolutionDownBy = undefined;
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
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.signaling) {
      this.signaling.ws.close();
      this.signaling = null;
    }
    this.localVideo.srcObject = null;
    this.pendingCandidates = [];
    this.setState(STATE.IDLE);
    this.startBtn.disabled = false;
  }
}

new Broadcaster();
