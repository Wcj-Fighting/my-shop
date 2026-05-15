const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { findOpenPort, pickLanIp } = require('../server/net');

test('findOpenPort returns the start port when free', async () => {
  const port = await findOpenPort(50000, 50020);
  assert.ok(port >= 50000 && port <= 50020);
});

test('findOpenPort skips a busy port', async () => {
  const blocker = net.createServer().listen(50100);
  await new Promise(r => blocker.once('listening', r));
  try {
    const port = await findOpenPort(50100, 50110);
    assert.notStrictEqual(port, 50100);
    assert.ok(port > 50100 && port <= 50110);
  } finally {
    await new Promise(r => blocker.close(r));
  }
});

test('findOpenPort throws when range exhausted', async () => {
  const blocker = net.createServer().listen(50200);
  await new Promise(r => blocker.once('listening', r));
  try {
    await assert.rejects(() => findOpenPort(50200, 50200));
  } finally {
    await new Promise(r => blocker.close(r));
  }
});

test('pickLanIp prefers 192.168 over 10. and 172.', () => {
  const ifaces = {
    eth0: [{ family: 'IPv4', internal: false, address: '10.0.0.5' }],
    wlan0: [{ family: 'IPv4', internal: false, address: '192.168.1.2' }],
    docker0: [{ family: 'IPv4', internal: false, address: '172.17.0.1' }]
  };
  assert.strictEqual(pickLanIp(ifaces), '192.168.1.2');
});

test('pickLanIp skips internal and IPv6', () => {
  const ifaces = {
    lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    eth0: [{ family: 'IPv6', internal: false, address: 'fe80::1' }],
    wlan0: [{ family: 'IPv4', internal: false, address: '10.0.0.5' }]
  };
  assert.strictEqual(pickLanIp(ifaces), '10.0.0.5');
});

test('pickLanIp skips virtual adapters by name', () => {
  const ifaces = {
    'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.30.160.1' }],
    'VMware Network Adapter VMnet1': [{ family: 'IPv4', internal: false, address: '192.168.222.1' }],
    'Tailscale': [{ family: 'IPv4', internal: false, address: '100.116.2.70' }],
    '以太网': [{ family: 'IPv4', internal: false, address: '192.168.1.2' }]
  };
  assert.strictEqual(pickLanIp(ifaces), '192.168.1.2');
});

test('pickLanIp returns null when no candidate', () => {
  assert.strictEqual(pickLanIp({}), null);
});
