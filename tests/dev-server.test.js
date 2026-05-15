const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { findOpenPort, pickLanIp } = require('../server/net');
const { createGitSync } = require('../server/git-sync');
const { createApiHandler } = require('../server/routes');

async function withServer(handler, fn) {
  const server = http.createServer((req, res) => handler(req, res, () => {
    res.statusCode = 404; res.end();
  }));
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  try { await fn(port); } finally { await new Promise(r => server.close(r)); }
}

function request(port, opts, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, ...opts }, (res) => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

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

test('createGitSync disables auto-sync on non-test branch', async () => {
  const calls = [];
  const fakeSpawn = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    return { on: (ev, cb) => ev === 'close' && setImmediate(() => cb(0)) };
  };
  const gs = createGitSync({ rootDir: '/tmp', branch: 'main', spawn: fakeSpawn });
  assert.strictEqual(gs.enabled, false);
  await gs.sync(['products.json'], 'msg');
  assert.deepStrictEqual(calls, []);
});

test('createGitSync runs add/commit/push on test branch', async () => {
  const calls = [];
  const fakeSpawn = (cmd, args) => {
    calls.push([cmd, args]);
    return { on: (ev, cb) => ev === 'close' && setImmediate(() => cb(0)) };
  };
  const gs = createGitSync({ rootDir: '/tmp', branch: 'test', spawn: fakeSpawn });
  assert.strictEqual(gs.enabled, true);
  const result = await gs.sync(['products.json', 'images/x.jpg'], 'chore: msg');
  assert.strictEqual(result.synced, true);
  assert.deepStrictEqual(calls[0], ['git', ['add', '--', 'products.json', 'images/x.jpg']]);
  assert.deepStrictEqual(calls[1], ['git', ['commit', '-m', 'chore: msg']]);
  assert.deepStrictEqual(calls[2], ['git', ['push', 'origin', 'test']]);
});

test('createGitSync serializes concurrent syncs', async () => {
  const order = [];
  const fakeSpawn = (cmd, args) => {
    const tag = `${args[0]}`;
    order.push(`start:${tag}`);
    return { on: (ev, cb) => {
      if (ev === 'close') setTimeout(() => { order.push(`end:${tag}`); cb(0); }, 5);
    }};
  };
  const gs = createGitSync({ rootDir: '/tmp', branch: 'test', spawn: fakeSpawn });
  await Promise.all([
    gs.sync(['a'], 'm1'),
    gs.sync(['b'], 'm2'),
  ]);
  // first sync (add->commit->push) must complete before second starts
  assert.strictEqual(order[0], 'start:add');
  assert.strictEqual(order[1], 'end:add');
});

test('createGitSync returns synced:false when push fails but does not throw', async () => {
  const fakeSpawn = (cmd, args) => ({
    on: (ev, cb) => {
      if (ev === 'close') {
        const code = args[0] === 'push' ? 1 : 0;
        setImmediate(() => cb(code));
      }
    }
  });
  const gs = createGitSync({ rootDir: '/tmp', branch: 'test', spawn: fakeSpawn });
  const result = await gs.sync(['x'], 'm');
  assert.strictEqual(result.synced, false);
});

test('GET /api/health returns mode and branch', async () => {
  const fakeGitSync = { enabled: true, sync: async () => ({ synced: true }) };
  const handler = createApiHandler({ rootDir: os.tmpdir(), gitSync: fakeGitSync, branch: 'test' });
  await withServer(handler, async (port) => {
    const res = await request(port, { method: 'GET', path: '/api/health' });
    assert.strictEqual(res.status, 200);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.mode, 'local');
    assert.strictEqual(json.branch, 'test');
    assert.strictEqual(json.autoSync, true);
  });
});

test('POST /api/save-products writes file and triggers sync', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'shop-'));
  const synced = [];
  const fakeGitSync = { enabled: true, sync: async (paths, msg) => { synced.push({ paths, msg }); return { synced: true }; } };
  const handler = createApiHandler({ rootDir: tmp, gitSync: fakeGitSync, branch: 'test' });
  await withServer(handler, async (port) => {
    const body = JSON.stringify({ products: [{ id: 1, name: 'x', price: '1', image: 'images/x.jpg' }] });
    const res = await request(port, {
      method: 'POST', path: '/api/save-products',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, body);
    assert.strictEqual(res.status, 200);
    const written = await fs.readFile(path.join(tmp, 'products.json'), 'utf8');
    assert.strictEqual(JSON.parse(written).products[0].name, 'x');
    assert.deepStrictEqual(synced[0].paths, ['products.json']);
    assert.match(synced[0].msg, /update products/);
  });
  await fs.rm(tmp, { recursive: true, force: true });
});

test('POST /api/save-products rejects invalid JSON', async () => {
  const handler = createApiHandler({ rootDir: os.tmpdir(), gitSync: { enabled: false, sync: async () => ({}) }, branch: 'test' });
  await withServer(handler, async (port) => {
    const body = '{not json';
    const res = await request(port, {
      method: 'POST', path: '/api/save-products',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, body);
    assert.strictEqual(res.status, 400);
  });
});

test('POST /api/upload writes image file and returns url', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'shop-'));
  await fs.mkdir(path.join(tmp, 'images'), { recursive: true });
  const synced = [];
  const fakeGitSync = { enabled: true, sync: async (paths, msg) => { synced.push({ paths, msg }); return { synced: true }; } };
  const handler = createApiHandler({ rootDir: tmp, gitSync: fakeGitSync, branch: 'test' });

  // 1x1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==', 'base64');
  const boundary = '----testbound';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.png"\r\nContent-Type: image/png\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(head), png, Buffer.from(tail)]);

  await withServer(handler, async (port) => {
    const res = await request(port, {
      method: 'POST', path: '/api/upload',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
    }, body);
    assert.strictEqual(res.status, 200);
    const json = JSON.parse(res.body);
    assert.match(json.url, /^images\/[\w.\-]+\.png$/);
    const filename = json.url.replace('images/', '');
    const stat = await fs.stat(path.join(tmp, 'images', filename));
    assert.strictEqual(stat.size, png.length);
    assert.deepStrictEqual(synced[0].paths, [json.url]);
  });
  await fs.rm(tmp, { recursive: true, force: true });
});

test('POST /api/upload rejects non-image content-type', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'shop-'));
  const handler = createApiHandler({ rootDir: tmp, gitSync: { enabled: false, sync: async () => ({}) }, branch: 'test' });
  const boundary = '----b';
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`
  );
  await withServer(handler, async (port) => {
    const res = await request(port, {
      method: 'POST', path: '/api/upload',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
    }, body);
    assert.strictEqual(res.status, 400);
  });
  await fs.rm(tmp, { recursive: true, force: true });
});
