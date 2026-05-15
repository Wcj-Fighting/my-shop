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
      // Mount without `route` so req.url retains the full `/api/...` path.
      // createApiHandler early-returns via next() for non-/api/ requests.
      (req, res, next) => api(req, res, next),
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
