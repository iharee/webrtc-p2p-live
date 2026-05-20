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

    this.statusEl = document.getElementById('status');
    this.remoteVideo = document.getElementById('remoteVideo');
    this.joinBtn = document.getElementById('joinBtn');

    this.joinBtn.addEventListener('click', () => this.join());
  }

  setState(s) {
    this.state = s;
    const map = {
      [STATE.IDLE]: '准备就绪',
      [STATE.WAITING_STREAM]: '等待主播推流...',
      [STATE.STREAMING]: '观看中'
    };
    this.statusEl.textContent = map[s] || s;
  }

  async join() {
    if (this.state !== STATE.IDLE) return;
    this.joinBtn.disabled = true;

    this.setState(STATE.WAITING_STREAM);

    this.pc = new RTCPeerConnection({ iceServers: window.CONFIG.iceServers });

    this.pc.addTransceiver('video', { direction: 'recvonly' });
    this.pc.addTransceiver('audio', { direction: 'recvonly' });

    this.pc.ontrack = (e) => {
      if (e.streams && e.streams[0]) {
        this.remoteVideo.srcObject = e.streams[0];
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

  reset() {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.signaling) {
      this.signaling.ws.close();
      this.signaling = null;
    }
    this.remoteVideo.srcObject = null;
    this.pendingCandidates = [];
    this.setState(STATE.IDLE);
    this.joinBtn.disabled = false;
  }
}

new Viewer();
