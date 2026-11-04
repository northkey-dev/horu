// Publishes the built app to GitHub Pages: copies pwa/dist into the "horu/" folder of the Pages repo and
// pushes it. The app then lives at https://<owner>.github.io/horu/.
//
//   HORU_PAGES_REPO=me/me.github.io npm run deploy   build and publish (afterwards plain `npm run deploy` is enough)
//
// The easier way for a fork is the "Publish app" workflow, see the README.
//
// Needs git with push access to the Pages repo (e.g. via `gh auth login`).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHECKOUT = path.join(ROOT, '.pages');
const REPO = process.env.HORU_PAGES_REPO;
if (!REPO && !fs.existsSync(path.join(CHECKOUT, '.git'))) {
  console.error('Set HORU_PAGES_REPO to your Pages repo, for example me/me.github.io.');
  process.exit(1);
}
const DIST = path.join(ROOT, 'pwa', 'dist');

const run = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const git = (...args) => run('git', args, CHECKOUT);

run(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], path.join(ROOT, 'pwa'));

if (!fs.existsSync(path.join(CHECKOUT, '.git'))) run('git', ['clone', `https://github.com/${REPO}.git`, CHECKOUT]);
else git('pull', '--ff-only');

const target = path.join(CHECKOUT, 'horu');
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(DIST, target, { recursive: true });
// No Jekyll: serve files as they are.
fs.writeFileSync(path.join(CHECKOUT, '.nojekyll'), '');
const home = path.join(CHECKOUT, 'index.html');
if (!fs.existsSync(home)) fs.writeFileSync(home, '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=horu/"><title>Horu</title>\n');

const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
git('add', '-A');
try {
  git('commit', '-m', `Horu ${sha}`);
} catch {
  console.log('Nothing changed.');
  process.exit(0);
}
git('push');
console.log('\nPublished. GitHub Pages updates in about a minute.');
