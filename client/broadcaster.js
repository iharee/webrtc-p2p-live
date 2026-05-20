const WS_URL = location.protocol === 'https:'
  ? `wss://${location.host}/ws`
  : 'ws://localhost:8080';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' }
];

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

    this.startBtn.addEventListener('click', () => this.start());
  }

  setState(s) {
    this.state = s;
    const map = {
      [STATE.IDLE]: '准备就绪',
      [STATE.PREVIEW]: '准备中...',
      [STATE.WAITING_VIEWER]: '等待观众加入...',
      [STATE.STREAMING]: '直播中'
    };
    this.statusEl.textContent = map[s] || s;
  }

  async start() {
    if (this.state !== STATE.IDLE) return;
    this.startBtn.disabled = true;

    try {
      this.setState(STATE.PREVIEW);
      this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.localVideo.srcObject = this.localStream;

      this.signaling = new SignalingClient(WS_URL);
      this.signaling.addEventListener('open', () => this.signaling.join('broadcaster'));
      this.signaling.addEventListener('joined', () => this.setState(STATE.WAITING_VIEWER));
      this.signaling.addEventListener('viewer-joined', () => this.onViewerJoined());
      this.signaling.addEventListener('answer', (e) => this.onAnswer(e.detail));
      this.signaling.addEventListener('ice-candidate', (e) => this.onIceCandidate(e.detail));
      this.signaling.addEventListener('peer-left', () => this.reset());
      this.signaling.addEventListener('error', () => this.reset());
      this.signaling.addEventListener('close', () => this.reset());
    } catch (err) {
      alert('无法访问摄像头/麦克风: ' + err.message);
      this.reset();
    }
  }

  async onViewerJoined() {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

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
