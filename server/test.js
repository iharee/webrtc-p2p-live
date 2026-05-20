const WebSocket = require('ws');

function waitForMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data)));
  });
}

function waitForOpen(ws) {
  return new Promise((resolve) => {
    ws.on('open', resolve);
  });
}

async function runTests() {
  console.log('Starting server tests...\n');

  // Start server
  require('./server.js');
  await new Promise(r => setTimeout(r, 500));

  // Test 1: Broadcaster join
  const b = new WebSocket('ws://localhost:8080');
  await waitForOpen(b);
  b.send(JSON.stringify({ type: 'join', role: 'broadcaster' }));
  const msg1 = await waitForMessage(b);
  console.assert(msg1.type === 'joined', 'Test 1 failed: expected joined, got', msg1.type);
  console.log('✓ Test 1: Broadcaster join');

  // Test 2: Viewer join + broadcaster receives viewer-joined
  const v = new WebSocket('ws://localhost:8080');
  await waitForOpen(v);
  v.send(JSON.stringify({ type: 'join', role: 'viewer' }));
  const msg2 = await waitForMessage(v);
  console.assert(msg2.type === 'joined', 'Test 2a failed: expected joined, got', msg2.type);

  const msg3 = await waitForMessage(b);
  console.assert(msg3.type === 'viewer-joined', 'Test 2b failed: expected viewer-joined, got', msg3.type);
  console.log('✓ Test 2: Viewer join and notification');

  // Test 3: Message relay (offer)
  b.send(JSON.stringify({ type: 'offer', sdp: 'test-offer' }));
  const msg4 = await waitForMessage(v);
  console.assert(msg4.type === 'offer' && msg4.sdp === 'test-offer', 'Test 3 failed');
  console.log('✓ Test 3: Offer relay');

  // Test 4: Reject duplicate broadcaster
  const b2 = new WebSocket('ws://localhost:8080');
  await waitForOpen(b2);
  b2.send(JSON.stringify({ type: 'join', role: 'broadcaster' }));
  const msg5 = await waitForMessage(b2);
  console.assert(msg5.type === 'rejected' && msg5.reason === 'broadcaster-exists', 'Test 4 failed');
  console.log('✓ Test 4: Reject duplicate broadcaster');

  // Test 5: Peer left notification
  v.close();
  const msg6 = await waitForMessage(b);
  console.assert(msg6.type === 'peer-left', 'Test 5 failed: expected peer-left, got', msg6.type);
  console.log('✓ Test 5: Peer left notification');

  console.log('\nAll tests passed!');
  b.close();
  b2.close();
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
