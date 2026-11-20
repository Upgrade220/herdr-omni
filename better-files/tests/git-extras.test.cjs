// git-extras.js against throwaway git repos. Own loader: the module is pure, no herdr.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const src = fs.readFileSync(path.join(__dirname, '../mods/better-files/files/git-extras.js'), 'utf8').replace(/^export /gm, '');
const X = new Function(`${src}\nreturn { NUMSTAT, BRANCH, IGNORED, parseNumstat, folderCounts, parseBranch, summaryOf, parseIgnored, isIgnored, rebase };`)();

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'git-extras-'));
function repo() {
  const dir = tmp();
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
}
const commit = (dir, msg = 'c') => { git(dir, 'add', '-A'); git(dir, 'commit', '-qm', msg); };

test('numstat: adds, deletes, binary', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'a'), '');
  fs.writeFileSync(path.join(dir, 'b'), 'x\n');
  fs.writeFileSync(path.join(dir, 'bin'), Buffer.from([0, 1, 2, 3]));
  commit(dir);
  fs.writeFileSync(path.join(dir, 'a'), '1\n2\n3\n');
  fs.writeFileSync(path.join(dir, 'b'), '');
  fs.writeFileSync(path.join(dir, 'bin'), Buffer.from([0, 9, 9, 9, 9]));
  assert.deepEqual(X.parseNumstat(git(dir, ...X.NUMSTAT)), { a: { add: 3, del: 0 }, b: { add: 0, del: 1 }, bin: { add: null, del: null } });
});

test('folderCounts counts changes under every ancestor', () => {
  assert.deepEqual(X.folderCounts({ 'src/a.js': 'M', 'src/x/b.js': 'A', c: 'D' }), { '': 3, src: 2, 'src/x': 1 });
  assert.deepEqual(X.folderCounts({ 'src/a.js': { mark: 'M', staged: false } }), { '': 1, src: 1 });
});

test('parseBranch: ahead of a bare remote', () => {
  const remote = tmp();
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  const dir = repo();
  git(dir, 'remote', 'add', 'origin', remote);
  fs.writeFileSync(path.join(dir, 'f'), '1');
  commit(dir, 'one');
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  for (const n of ['2', '3']) { fs.writeFileSync(path.join(dir, 'f'), n); commit(dir, n); }
  assert.deepEqual(X.parseBranch(git(dir, ...X.BRANCH)), { branch: 'main', ahead: 2, behind: 0 });
});

test('no commits: branch known, summary works with empty numstat', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'f'), 'x');
  const info = X.parseBranch(git(dir, ...X.BRANCH));
  assert.deepEqual(info, { branch: 'main', ahead: 0, behind: 0 });
  assert.deepEqual(X.summaryOf({ f: 'A' }, {}, info), { branch: 'main', ahead: 0, behind: 0, add: 0, del: 0, modified: 0, added: 1, deleted: 0 });
});

test('summaryOf totals; null when not a repo', () => {
  const s = X.summaryOf({ a: 'M', b: { mark: 'A' }, c: 'D', d: 'U' }, { a: { add: 3, del: 1 }, bin: { add: null, del: null } }, { branch: 'x', ahead: 1, behind: 2 });
  assert.deepEqual(s, { branch: 'x', ahead: 1, behind: 2, add: 3, del: 1, modified: 2, added: 1, deleted: 1 });
  assert.equal(X.summaryOf({}, {}, null), null);
  assert.equal(X.parseBranch(''), null);
});

test('ignored folder covers its descendants', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/\n*.log\n');
  fs.mkdirSync(path.join(dir, 'dist/x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist/x/y.js'), '');
  fs.writeFileSync(path.join(dir, 'a.log'), '');
  fs.writeFileSync(path.join(dir, 'keep.js'), '');
  const set = X.parseIgnored(git(dir, ...X.IGNORED));
  assert.ok(set.has('dist/'));
  assert.ok(X.isIgnored(set, 'dist/x/y.js'));
  assert.ok(X.isIgnored(set, 'a.log'));
  assert.ok(!X.isIgnored(set, 'keep.js'));
  assert.ok(!X.isIgnored(set, 'distant/x.js'));
});

test('rebase: absolute or repo-relative keys, read from a shown subfolder', () => {
  const marks = { '/r/a.js': 'M', '/r/src/b.js': { mark: 'A' }, '/r/src/x/c.js': 'D', '/rx/d.js': 'M' };
  assert.deepEqual(X.rebase(marks, '', '/r/src'), { 'b.js': { mark: 'A' }, 'x/c.js': 'D' });
  assert.deepEqual(X.rebase({ 'src/b.js': 1, 'a.js': 2 }, '/r', '/r/src'), { 'b.js': 1 });
  assert.deepEqual(X.rebase({ 'a.js': 2 }, '/r', '/r'), { 'a.js': 2 });
  assert.deepEqual(X.folderCounts(X.rebase(marks, '', '/r')), { '': 3, src: 2, 'src/x': 1 });
  assert.deepEqual(X.rebase(null, '', '/r'), {});
});
