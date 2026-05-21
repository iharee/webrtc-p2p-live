const WebSocket = require('ws');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function waitForMessage(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('waitForMessage timed out')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data));
    });
  });
}

function waitForOpen(ws) {
  return new Promise((resolve) => {
    ws.once('open', resolve);
  });
}

async function runTests() {
  console.log('Starting multi-room server tests...\n');

  require('./server.js');
  await new Promise(r => setTimeout(r, 500));

  // Test 1: Broadcaster join with room + token
  const b = new WebSocket('ws://localhost:8080');
  await waitForOpen(b);
  b.send(JSON.stringify({ type: 'join', role: 'broadcaster', roomId: 'test-room', token: 'abcd1234abcd' }));
  const msg1 = await waitForMessage(b);
  assert(msg1.type === 'joined', `Test 1 failed: expected joined, got ${msg1.type}`);
  assert(msg1.token === 'abcd1234abcd', `Test 1 failed: token mismatch`);
  console.log('ok 1 - broadcaster join with token');

  // Test 2: Viewer join with matching token
  const v = new WebSocket('ws://localhost:8080');
  await waitForOpen(v);
  v.send(JSON.stringify({ type: 'join', role: 'viewer', roomId: 'test-room', token: 'abcd1234abcd' }));
  const msg2 = await waitForMessage(v);
  assert(msg2.type === 'joined', `Test 2a failed: expected joined, got ${msg2.type}`);

  const msg3 = await waitForMessage(b);
  assert(msg3.type === 'viewer-joined', `Test 2b failed: expected viewer-joined, got ${msg3.type}`);
  console.log('ok 2 - viewer join with token');

  // Test 3: Reject duplicate broadcaster in same room
  const b2 = new WebSocket('ws://localhost:8080');
  await waitForOpen(b2);
  b2.send(JSON.stringify({ type: 'join', role: 'broadcaster', roomId: 'test-room', token: 'xxxx' }));
  const msg4 = await waitForMessage(b2);
  assert(msg4.type === 'rejected' && msg4.reason === 'broadcaster-exists', 'Test 3 failed');
  console.log('ok 3 - reject duplicate broadcaster');

  // Test 4: Reject viewer with bad token
  const v2 = new WebSocket('ws://localhost:8080');
  await waitForOpen(v2);
  v2.send(JSON.stringify({ type: 'join', role: 'viewer', roomId: 'test-room', token: 'wrong-token!!' }));
  const msg5 = await waitForMessage(v2);
  assert(msg5.type === 'rejected' && msg5.reason === 'bad-token', 'Test 4 failed');
  console.log('ok 4 - reject bad token');

  // Test 5: Different rooms don't interfere
  const b3 = new WebSocket('ws://localhost:8080');
  await waitForOpen(b3);
  b3.send(JSON.stringify({ type: 'join', role: 'broadcaster', roomId: 'room-b', token: 'bbbbbbbbbbbb' }));
  const msg6 = await waitForMessage(b3);
  assert(msg6.type === 'joined', 'Test 5 failed: second room broadcaster rejected');
  console.log('ok 5 - independent rooms');

  // Test 6: Pending viewer gets broadcaster-joined
  const v3 = new WebSocket('ws://localhost:8080');
  await waitForOpen(v3);
  v3.send(JSON.stringify({ type: 'join', role: 'viewer', roomId: 'empty-room' }));
  const msg7 = await waitForMessage(v3);
  assert(msg7.type === 'joined', `Test 6a failed: expected joined, got ${msg7.type}`);

  const b4 = new WebSocket('ws://localhost:8080');
  await waitForOpen(b4);
  b4.send(JSON.stringify({ type: 'join', role: 'broadcaster', roomId: 'empty-room', token: 'cccccccccccc' }));
  await waitForMessage(b4); // joined

  const msg8 = await waitForMessage(v3);
  assert(msg8.type === 'broadcaster-joined', `Test 6b failed: expected broadcaster-joined, got ${msg8.type}`);
  console.log('ok 6 - pending viewer notified');

  // Test 7: Viewer auth via separate auth message
  const v4 = new WebSocket('ws://localhost:8080');
  await waitForOpen(v4);
  v4.send(JSON.stringify({ type: 'join', role: 'viewer', roomId: 'room-b' }));
  await waitForMessage(v4); // broadcaster-joined

  v4.send(JSON.stringify({ type: 'auth', token: 'bbbbbbbbbbbb' }));
  const msg9 = await waitForMessage(v4);
  assert(msg9.type === 'joined', `Test 7 failed: expected joined after auth, got ${msg9.type}`);
  console.log('ok 7 - viewer auth via separate message');

  console.log('\nAll tests passed!');
  [b, v, b2, v2, b3, v3, b4, v4].forEach(ws => { try { ws.close(); } catch(_) {} });
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
