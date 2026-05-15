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
