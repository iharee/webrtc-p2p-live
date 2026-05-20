class SignalingClient extends EventTarget {
  constructor(url) {
    super();
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.dispatchEvent(new Event('open'));
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'ping') {
        this.send({ type: 'pong' });
        return;
      }
      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
    };

    this.ws.onclose = (e) => {
      this.dispatchEvent(new CustomEvent('close', { detail: { code: e.code, reason: e.reason } }));
    };

    this.ws.onerror = (err) => {
      this.dispatchEvent(new CustomEvent('error', { detail: err }));
    };
  }

  join(role) {
    this.send({ type: 'join', role });
  }

  sendOffer(sdp) {
    this.send({ type: 'offer', sdp });
  }

  sendAnswer(sdp) {
    this.send({ type: 'answer', sdp });
  }

  sendIceCandidate(candidate) {
    this.send({ type: 'ice-candidate', candidate });
  }

  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
