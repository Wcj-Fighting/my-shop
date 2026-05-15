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
