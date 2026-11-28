#!/usr/bin/env node
'use strict';
// Maintainer convenience, run automatically by `npm install` (see "prepare" in package.json).
//
// If - and only if - this clone's GitHub account can read the companion "<origin>-Private-Docs"
// repository, restore the maintainer's private notes next to the code and wire up the sync hooks.
// For everyone else (contributors, forks, CI, Docker builds) this is a silent no-op.
// It never throws and never fails an install.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const log = (m) => console.log(`[setup-private] ${m}`);
// silent by default; set PRIVATE_DOCS_DEBUG=1 to see why setup was skipped
const skip = (why) => { if (process.env.PRIVATE_DOCS_DEBUG) log(`skipped: ${why}`); };

function git(args, extra = {}) {
  return spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    // never prompt for credentials: no access just means "skip"
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    ...extra,
  });
}

function findSh() {
  const candidates = ['sh'];
  if (process.platform === 'win32') {
    // Git for Windows ships sh, but npm's cmd.exe shell often doesn't have it on PATH
    const ep = (git(['--exec-path']).stdout || '').trim();
    if (ep) {
      const gitRoot = path.resolve(ep, '..', '..', '..');
      candidates.push(path.join(gitRoot, 'usr', 'bin', 'sh.exe'), path.join(gitRoot, 'bin', 'sh.exe'));
    }
  }
  return candidates.find((c) => spawnSync(c, ['-c', 'exit 0']).status === 0);
}

// Installed git hooks are COPIES of private-docs/hooks/private-sync. If a machine's copies are older than the
// synced source (e.g. a fix made on another machine), re-run the idempotent bootstrap so nobody has to.
function refreshHooks(sidecar) {
  const src = path.join(root, 'private-docs', 'hooks', 'private-sync');
  const boot = path.join(root, 'private-docs', 'bootstrap.sh');
  if (!fs.existsSync(src) || !fs.existsSync(boot)) return skip('already set up; private-docs not present');
  const hooksDir = (git(['rev-parse', '--git-path', 'hooks']).stdout || '').trim();
  const norm = (f) => { try { return fs.readFileSync(f, 'utf8').replace(/\r/g, ''); } catch (e) { return null; } };
  const want = norm(src);
  const stale = ['pre-push', 'reference-transaction'].some((h) => norm(path.resolve(root, hooksDir, h)) !== want);
  if (!stale) return skip('already set up; hooks current');
  const sh = findSh();
  if (!sh) return skip('hooks are stale but no `sh` found');
  const r = spawnSync(sh, ['private-docs/bootstrap.sh', sidecar], { cwd: root, stdio: 'ignore', timeout: 60000 });
  log(r.status === 0 ? 'refreshed private-sync hooks.' : 'hooks are stale and refresh failed; run: sh private-docs/bootstrap.sh');
}

function main() {
  if (process.env.CI || process.env.PRIVATE_DOCS_SKIP) return skip('CI or opted out');
  if (!fs.existsSync(path.join(root, '.git'))) return skip('no .git (Docker build / tarball)');
  const existing = (git(['config', '--get', 'private.sidecar']).stdout || '').trim();
  if (existing) return refreshHooks(existing); // already set up: just keep its hooks current

  // Raw configured URL (NOT `remote get-url`, which applies insteadOf rewrites and could leak tokens
  // into the sidecar config). Works for https://github.com/o/r(.git) and git@github.com:o/r(.git).
  const origin = (git(['config', '--get', 'remote.origin.url']).stdout || '').trim();
  if (!/github\.com[/:]/.test(origin)) return skip('origin is not a github.com remote');
  const privateUrl = origin.replace(/(\.git)?\/?$/, '-Private-Docs.git');

  // Can this machine's GitHub login read it? If not, this is simply not the maintainer: stay silent.
  if (git(['ls-remote', '--exit-code', privateUrl, 'HEAD']).status !== 0) return skip('private docs repo not readable with this login');

  if (fs.existsSync(path.join(root, 'CLAUDE.md')) || fs.existsSync(path.join(root, 'private-docs'))) {
    log('private files already exist here; not overwriting. Run: sh private-docs/bootstrap.sh');
    return;
  }

  const sidecar = path.join(path.dirname(root), '.sidecar', `${path.basename(root)}.git`);
  if (fs.existsSync(sidecar)) {
    log(`${sidecar} already exists; not touching it.`);
    return;
  }

  log('private repo is reachable - restoring private files...');
  fs.mkdirSync(path.dirname(sidecar), { recursive: true });
  if (git(['clone', '--bare', '-q', privateUrl, sidecar]).status !== 0) return log('clone failed; skipped.');
  // autocrlf=false: otherwise Windows gives the scripts CRLF endings and `sh` chokes on them
  const co = git(['-c', 'core.autocrlf=false', `--git-dir=${sidecar}`, `--work-tree=${root}`, 'checkout', '-f', 'master']);
  if (co.status !== 0) return log('checkout failed; skipped.');

  const sh = findSh();
  if (!sh) return log('could not find `sh` to finish setup; run: sh private-docs/bootstrap.sh');
  const r = spawnSync(sh, ['private-docs/bootstrap.sh'], { cwd: root, stdio: 'inherit' });
  log(r.status === 0 ? 'done. CLAUDE.md and private-docs/ restored; auto-sync is on.' : 'bootstrap reported a problem; run: sh private-docs/verify.sh');
}

try {
  main();
} catch (e) {
  // never break `npm install`
}
