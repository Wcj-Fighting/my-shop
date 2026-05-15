# npm Dev Server with Hot Reload and Local Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc `python -m http.server` workflow with `npm run dev`: a single Node-based dev server that serves the static site, auto-reloads on file change, prints LAN URL + QR code, exposes local upload/save endpoints, and auto-commits to the `test` branch.

**Architecture:** Single process. `scripts/dev-server.js` boots `browser-sync` (static + livereload) and mounts a small middleware that owns three JSON endpoints. Helper modules in `server/` (net, routes, git-sync) are pure and unit-tested. `admin.html` adds a 1-second `/api/health` probe to pick local vs GitHub mode.

**Tech Stack:** Node ≥18, `browser-sync`, `qrcode-terminal`. Tests use `node:test` + `node:assert` (no jest). `git`, `multipart` parsing, fs writes via Node built-ins (`child_process`, `node:fs/promises`, manual multipart parser — kept tiny and inlined).

**Spec:** `docs/superpowers/specs/2026-05-15-npm-dev-server-design.md`

**Branch:** Work on `test` (already checked out).

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json` | scripts (`dev`, `test`), devDependencies |
| `package-lock.json` | committed |
| `.gitignore` | ignore `node_modules/`, `*.log`, `.DS_Store` |
| `scripts/dev-server.js` | boot: net → routes → git-sync → browser-sync; SIGINT cleanup; banner |
| `server/net.js` | `findOpenPort(start, end)`, `pickLanIp(interfaces)` |
| `server/routes.js` | factory `createApiHandler({ rootDir, gitSync })` returning `(req,res,next)` |
| `server/git-sync.js` | factory `createGitSync({ rootDir, branch })` returning `{ enabled, sync(paths, message) }` |
| `admin.html` | add `detectMode()` + `uploadImageToLocal()` + `saveProductsToLocal()`; branch in 2 call sites |
| `tests/dev-server.test.js` | unit tests for `net`, `routes`, `git-sync` |
| `AGENTS.md` | replace hardcoded LAN URL with `npm run dev` instructions |

`server/*.js` exports plain factories so tests can inject a temp dir and a fake `spawn`. No global state, no side effects on import.

---

## Task 1: Bootstrap npm project

**Files:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
*.log
.DS_Store
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "my-shop",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "node scripts/dev-server.js",
    "test": "node --test tests/"
  },
  "devDependencies": {
    "browser-sync": "^3.0.2",
    "qrcode-terminal": "^0.12.0"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: creates `node_modules/` and `package-lock.json`, no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: bootstrap npm project for dev server"
```

---

## Task 2: `server/net.js` — port and LAN IP helpers

**Files:**
- Create: `server/net.js`
- Create: `tests/dev-server.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/dev-server.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../server/net'`.

- [ ] **Step 3: Implement `server/net.js`**

```js
const net = require('node:net');

const VIRTUAL_NAME_PATTERNS = [
  /vEthernet/i,
  /VMware/i,
  /VirtualBox/i,
  /Tailscale/i,
  /Hyper-?V/i,
  /Loopback/i,
];

function isVirtual(name) {
  return VIRTUAL_NAME_PATTERNS.some((re) => re.test(name));
}

function ipPriority(addr) {
  if (addr.startsWith('192.168.')) return 0;
  if (addr.startsWith('10.')) return 1;
  if (addr.startsWith('172.')) return 2;
  return 3;
}

function pickLanIp(interfaces) {
  const candidates = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (isVirtual(name)) continue;
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      candidates.push({ name, address: a.address });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => ipPriority(a.address) - ipPriority(b.address));
  return candidates[0].address;
}

function probePort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, '0.0.0.0');
  });
}

async function findOpenPort(start, end) {
  for (let p = start; p <= end; p++) {
    if (await probePort(p)) return p;
  }
  throw new Error(`No free port in range ${start}-${end}`);
}

module.exports = { findOpenPort, pickLanIp };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/net.js tests/dev-server.test.js
git commit -m "feat: add port and LAN IP helpers"
```

---

## Task 3: `server/git-sync.js` — branch-protected git sync

**Files:**
- Create: `server/git-sync.js`
- Modify: `tests/dev-server.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/dev-server.test.js`:

```js
const { createGitSync } = require('../server/git-sync');

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
    calls.push([cmd, ...args]);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../server/git-sync'`.

- [ ] **Step 3: Implement `server/git-sync.js`**

```js
const { spawn: realSpawn } = require('node:child_process');

function runGit(spawnImpl, rootDir, args) {
  return new Promise((resolve) => {
    const child = spawnImpl('git', args, { cwd: rootDir });
    let stderr = '';
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

function createGitSync({ rootDir, branch, spawn = realSpawn }) {
  const enabled = branch === 'test';
  let queue = Promise.resolve();
  let warned = false;

  function warnOnce() {
    if (warned) return;
    warned = true;
    console.warn(`[git-sync] current branch is "${branch}", auto-sync is OFF (only "test" is enabled)`);
  }

  async function sync(paths, message) {
    if (!enabled) {
      warnOnce();
      return { synced: false, reason: 'disabled' };
    }
    const job = queue.then(async () => {
      const add = await runGit(spawn, rootDir, ['add', '--', ...paths]);
      if (add.code !== 0) {
        console.warn(`[git-sync] add failed: ${add.stderr.trim()}`);
        return { synced: false, reason: 'add' };
      }
      const commit = await runGit(spawn, rootDir, ['commit', '-m', message]);
      if (commit.code !== 0) {
        // Likely "nothing to commit"; treat as no-op
        return { synced: false, reason: 'nothing-to-commit' };
      }
      const push = await runGit(spawn, rootDir, ['push', 'origin', 'test']);
      if (push.code !== 0) {
        console.warn(`[git-sync] push failed: ${push.stderr.trim()}`);
        return { synced: false, reason: 'push' };
      }
      return { synced: true };
    });
    queue = job.catch(() => {}); // never break the queue
    return job;
  }

  return { enabled, sync };
}

module.exports = { createGitSync };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/git-sync.js tests/dev-server.test.js
git commit -m "feat: add branch-protected git sync"
```

---

## Task 4: `server/routes.js` — health, upload, save-products

**Files:**
- Create: `server/routes.js`
- Modify: `tests/dev-server.test.js`

This task implements three endpoints in one handler. Multipart parsing is a tiny inline implementation (single-file, single-field) — no extra dependency.

- [ ] **Step 1: Write the failing tests**

Append to `tests/dev-server.test.js`:

```js
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../server/routes'`.

- [ ] **Step 3: Implement `server/routes.js`**

```js
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > max) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseSingleMultipart(buffer, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const start = buffer.indexOf(delim);
  if (start < 0) return null;
  const headerStart = start + delim.length + 2; // skip CRLF
  const headerEnd = buffer.indexOf('\r\n\r\n', headerStart);
  if (headerEnd < 0) return null;
  const headerStr = buffer.slice(headerStart, headerEnd).toString('utf8');
  const headers = {};
  for (const line of headerStr.split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  const dataStart = headerEnd + 4;
  const dataEnd = buffer.indexOf(`\r\n--${boundary}`, dataStart);
  if (dataEnd < 0) return null;
  const data = buffer.slice(dataStart, dataEnd);
  const dispo = headers['content-disposition'] || '';
  const fnameMatch = /filename="([^"]*)"/.exec(dispo);
  return {
    filename: fnameMatch ? fnameMatch[1] : 'file',
    contentType: headers['content-type'] || 'application/octet-stream',
    data,
  };
}

function safeExt(filename, contentType) {
  const ext = path.extname(filename).toLowerCase().replace(/[^.\w]/g, '');
  if (ext) return ext;
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/jpeg') return '.jpg';
  if (contentType === 'image/gif') return '.gif';
  if (contentType === 'image/webp') return '.webp';
  return '.bin';
}

function makeFilename(originalName, contentType) {
  const ts = Date.now();
  const rand = crypto.randomBytes(3).toString('hex');
  return `${ts}-${rand}${safeExt(originalName, contentType)}`;
}

function createApiHandler({ rootDir, gitSync, branch }) {
  return async function handle(req, res, next) {
    const url = req.url || '';
    if (!url.startsWith('/api/')) return next();

    try {
      if (req.method === 'GET' && url === '/api/health') {
        return sendJson(res, 200, {
          ok: true, mode: 'local', branch, autoSync: !!(gitSync && gitSync.enabled)
        });
      }

      if (req.method === 'POST' && url === '/api/save-products') {
        const buf = await readBody(req, MAX_UPLOAD_BYTES);
        let parsed;
        try { parsed = JSON.parse(buf.toString('utf8')); }
        catch { return sendJson(res, 400, { error: 'invalid json' }); }
        const target = path.join(rootDir, 'products.json');
        const tmp = `${target}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(parsed, null, 2), 'utf8');
        await fs.rename(tmp, target);
        const result = await gitSync.sync(['products.json'], 'chore(dev): update products via dev server');
        return sendJson(res, 200, { ok: true, synced: result.synced });
      }

      if (req.method === 'POST' && url === '/api/upload') {
        const ct = req.headers['content-type'] || '';
        const m = /boundary=(.+)$/.exec(ct);
        if (!m) return sendJson(res, 400, { error: 'missing boundary' });
        const buf = await readBody(req, MAX_UPLOAD_BYTES);
        const part = parseSingleMultipart(buf, m[1]);
        if (!part) return sendJson(res, 400, { error: 'malformed multipart' });
        if (!part.contentType.startsWith('image/')) {
          return sendJson(res, 400, { error: 'not an image' });
        }
        const filename = makeFilename(part.filename, part.contentType);
        const relPath = `images/${filename}`;
        const abs = path.join(rootDir, relPath);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, part.data);
        const result = await gitSync.sync([relPath], `chore(dev): add image ${filename}`);
        return sendJson(res, 200, { url: relPath, synced: result.synced });
      }

      return next();
    } catch (err) {
      if (err.message === 'too large') return sendJson(res, 400, { error: 'too large' });
      console.error('[api]', err);
      return sendJson(res, 500, { error: err.message || 'internal error' });
    }
  };
}

module.exports = { createApiHandler };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests pass (net + git-sync + routes).

- [ ] **Step 5: Commit**

```bash
git add server/routes.js tests/dev-server.test.js
git commit -m "feat: add health, upload and save-products endpoints"
```

---

## Task 5: `scripts/dev-server.js` — boot script

**Files:**
- Create: `scripts/dev-server.js`

This task wires everything together. No new tests — manual smoke test at the end.

- [ ] **Step 1: Create `scripts/dev-server.js`**

```js
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const browserSync = require('browser-sync');
const qrcode = require('qrcode-terminal');
const { findOpenPort, pickLanIp } = require('../server/net');
const { createGitSync } = require('../server/git-sync');
const { createApiHandler } = require('../server/routes');

const ROOT = path.resolve(__dirname, '..');

function currentBranch() {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

function banner({ port, lanIp, branch, autoSync }) {
  const localUrl = `http://localhost:${port}`;
  const lanUrl = lanIp ? `http://${lanIp}:${port}` : '(no LAN IP detected)';
  const sep = '─'.repeat(45);
  console.log('');
  console.log(sep);
  console.log(' my-shop dev server');
  console.log(sep);
  console.log(` Local:    ${localUrl}`);
  console.log(` LAN:      ${lanUrl}`);
  console.log(` Branch:   ${branch}  ${autoSync ? '(auto-sync ON)' : '(auto-sync OFF — switch to test)'}`);
  console.log('');
  if (lanIp) qrcode.generate(lanUrl, { small: true });
  console.log('');
  console.log(' Press Ctrl+C to stop');
  console.log(sep);
}

async function main() {
  const startPort = parseInt(process.env.PORT, 10) || 8002;
  const port = await findOpenPort(startPort, startPort + 48);
  const lanIp = pickLanIp(os.networkInterfaces());
  const branch = currentBranch();
  const gitSync = createGitSync({ rootDir: ROOT, branch });
  const api = createApiHandler({ rootDir: ROOT, gitSync, branch });

  const bs = browserSync.create();
  bs.init({
    server: { baseDir: ROOT },
    port,
    open: false,
    notify: false,
    logLevel: 'info',
    ui: false,
    ghostMode: false,
    files: [
      `${ROOT}/*.html`,
      `${ROOT}/*.css`,
      `${ROOT}/*.js`,
      `${ROOT}/products.json`,
    ],
    watchOptions: { ignored: ['node_modules/**', '.git/**', 'docs/**', 'tests/**', 'images/**'] },
    middleware: [
      { route: '/api', handle: (req, res, next) => api(req, res, next) },
    ],
  }, (err) => {
    if (err) { console.error(err); process.exit(1); }
    banner({ port, lanIp, branch, autoSync: gitSync.enabled });
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    bs.exit();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke test the server**

Run: `npm run dev`
Expected:
- Banner prints with `Local:`, `LAN:`, `Branch: test  (auto-sync ON)`, plus a QR code.
- Open `http://localhost:<port>/index.html` in a browser — page loads.
- Open `http://localhost:<port>/api/health` — returns `{"ok":true,"mode":"local","branch":"test","autoSync":true}`.
- Edit `index.html` (e.g. add a space) and save — browser auto-reloads.
- Press Ctrl+C — server stops cleanly.

- [ ] **Step 3: Commit**

```bash
git add scripts/dev-server.js
git commit -m "feat: add dev server boot script with browser-sync"
```

---

## Task 6: Wire `admin.html` to local mode

**Files:**
- Modify: `admin.html`

`admin.html` line numbers below match the file at the start of this work; they may shift slightly during edits — search for the snippet text.

- [ ] **Step 1: Add mode detection on page load**

Find the script block in `admin.html` near the top of the inline JS (search for `let pendingImageBlob`). Add this just before the existing `pendingImageBlob` declaration:

```js
// dev server detection: if /api/health responds within 1s, use local mode
window.__SHOP_MODE__ = 'github';
window.__SHOP_AUTO_SYNC__ = false;
(async () => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1000);
    const res = await fetch('/api/health', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      window.__SHOP_MODE__ = 'local';
      window.__SHOP_AUTO_SYNC__ = !!data.autoSync;
      const tag = document.getElementById('modeTag');
      if (tag) {
        tag.textContent = data.autoSync ? 'local mode (sync)' : 'local mode (no sync)';
        tag.style.background = '#0a7d2c';
      }
    }
  } catch { /* keep github mode */ }
})();
```

- [ ] **Step 2: Add the mode tag to the UI**

Find the admin page header (search for the first `<h1>` or `<header>` in `admin.html`). Add a small badge next to the title:

```html
<span id="modeTag" style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:4px;background:#888;color:#fff;font-size:12px;vertical-align:middle">github mode</span>
```

- [ ] **Step 3: Add `uploadImageToLocal` helper**

Find the `uploadImageToGitHub` function (search for `async function uploadImageToGitHub`). Add this function immediately above it:

```js
async function uploadImageToLocal(blob) {
  const fd = new FormData();
  const ext = (blob.type.split('/')[1] || 'bin').replace('jpeg', 'jpg');
  fd.append('file', blob, `upload.${ext}`);
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`upload failed: ${res.status} ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.url;
}
```

- [ ] **Step 4: Branch in `saveProduct` to use local upload when available**

Find the upload call in `saveProduct` (search for `image = await uploadImageToGitHub`). Replace this block:

```js
                if (!token) {
                    showStatus('productsStatus', '请先保存 Token', 'error');
                    return;
                }

                try {
                    const sizeKB = Math.round(pendingImageBlob.size / 1024);
                    showStatus('productsStatus', `正在上传图片（${sizeKB} KB）...`, 'loading');
                    image = await uploadImageToGitHub(pendingImageBlob, GITHUB_USERNAME, GITHUB_REPO, token);
                    clearPendingImage();
                } catch (error) {
                    console.error('Upload failed:', error);
                    showStatus('productsStatus', `图片上传失败：${error.message}`, 'error');
                    return;
                }
```

with:

```js
                try {
                    const sizeKB = Math.round(pendingImageBlob.size / 1024);
                    showStatus('productsStatus', `正在上传图片（${sizeKB} KB）...`, 'loading');
                    if (window.__SHOP_MODE__ === 'local') {
                        image = await uploadImageToLocal(pendingImageBlob);
                    } else {
                        if (!token) {
                            showStatus('productsStatus', '请先保存 Token', 'error');
                            return;
                        }
                        image = await uploadImageToGitHub(pendingImageBlob, GITHUB_USERNAME, GITHUB_REPO, token);
                    }
                    clearPendingImage();
                } catch (error) {
                    console.error('Upload failed:', error);
                    showStatus('productsStatus', `图片上传失败：${error.message}`, 'error');
                    return;
                }
```

- [ ] **Step 5: Branch in `saveToGitHub` to use local save when available**

Find `async function saveToGitHub()`. Add this block at the very top of the function body (before the existing token check):

```js
            if (window.__SHOP_MODE__ === 'local') {
                showStatus('productsStatus', '正在保存（本地）...', 'loading');
                try {
                    const res = await fetch('/api/save-products', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ products })
                    });
                    if (!res.ok) {
                        const err = await res.text();
                        throw new Error(`${res.status} ${err.slice(0, 200)}`);
                    }
                    const data = await res.json();
                    const syncMsg = data.synced ? '，已 push 到 test 分支' : '（未同步到远端）';
                    showStatus('productsStatus', `✓ 已保存到本地${syncMsg}`, 'success');
                } catch (error) {
                    console.error('Local save failed:', error);
                    showStatus('productsStatus', `本地保存失败：${error.message}`, 'error');
                }
                return;
            }
```

- [ ] **Step 6: Smoke test**

Run: `npm run dev` (in another terminal if first one still hosts the previous task's server; or restart it).

In a browser:
1. Open the admin page from the printed Local URL.
2. Confirm the green `local mode (sync)` badge appears.
3. Open `/api/health` — see the JSON body.
4. (Without committing) edit one product and click "保存到 GitHub" — verify `products.json` on disk updated.
5. Upload an image — verify a new file appears under `images/`.
6. Check `git log` — should see two new commits authored by dev server.

- [ ] **Step 7: Commit**

```bash
git add admin.html
git commit -m "feat: detect local dev mode in admin.html"
```

---

## Task 7: Update `AGENTS.md`

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Replace the hardcoded LAN section**

Replace the entire content of `AGENTS.md` with:

```markdown
# Project Collaboration Notes

- After every feature change, fix, or optimization in this project, include clickable local preview links in the final response so the user can immediately check the result on their phone.
- Start the dev server with `npm run dev`. It auto-detects an open port (starting at 8002) and the LAN IP, prints both URLs and a QR code at startup. Use the URLs from the latest server output for previews.
- The dev server provides hot reload (HTML/CSS/JS/products.json) and local upload endpoints. Saving in `admin.html` writes to local files and (on the `test` branch only) auto-commits & pushes to `origin/test`.
- Do not hardcode IPs or ports anywhere — always pull them from the running server's banner output.
- Code changes for ongoing development happen on the `test` branch. `main` is the stable branch and is merged into only after `test` is verified.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md for npm dev server workflow"
```

---

## Final Verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: PASS — all unit tests in `tests/` pass.

- [ ] **Step 2: Run the existing image-interactions test still passes**

The existing `tests/image-interactions.test.js` may use a different runner. Inspect it; if it is also `node:test`-compatible it runs as part of `npm test`. If it requires a different runner, leave it as-is and note in the final report.

- [ ] **Step 3: End-to-end smoke**

Run: `npm run dev`
Verify (manually, with a phone on the same Wi-Fi):
- Phone scans QR code → sees `index.html`
- Edit `index.html` text and save → phone page auto-refreshes
- In admin: upload an image, save products → both ops succeed; new commits visible in `git log`; `images/` and `products.json` on disk updated
- `git status` is clean after dev server commits

- [ ] **Step 4: Final summary commit (if any docs/cleanup remain)**

If anything was left uncommitted, commit it. Otherwise skip.
