// recent.js: pure Recent list. Own loader: the module has no herdr imports.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../mods/better-files/files/recent.js'), 'utf8').replace(/^export /gm, '');
const R = new Function(`${src}\nreturn { SKIP_DIRS, skipped, record, ago, recentRows, KINDS, kindsOf, relativeIn, dropFolders };`)();

test('150 distinct paths keep 100, newest first', () => {
  let list = [];
  for (let i = 0; i < 150; i++) list = R.record(list, `f${i}.js`, 1000 + i);
  assert.equal(list.length, 100);
  assert.equal(list[0].path, 'f149.js');
  assert.equal(list[99].path, 'f50.js');
});

test('re-recording moves to front without duplicating, input not mutated', () => {
  const a = R.record(R.record(R.record([], 'a', 1), 'b', 2), 'c', 3);
  const snapshot = JSON.stringify(a);
  const b = R.record(a, 'a', 9);
  assert.equal(JSON.stringify(a), snapshot);
  assert.deepEqual(b.map((e) => e.path), ['a', 'c', 'b']);
  assert.equal(b[0].at, 9);
});

test('skipped dirs are ignored', () => {
  assert.ok(R.skipped('node_modules/x/y.js'));
  assert.ok(R.skipped('a/.git/index'));
  assert.ok(!R.skipped('src/distant/x.js'));
  const list = R.record([], 'k', 1);
  assert.deepEqual(R.record(list, 'node_modules/x/y.js', 2), list);
  assert.deepEqual(R.record(list, '.git/index', 2), list);
});

test('recentRows: ago formats and gone', () => {
  const now = 10_000_000;
  const list = [
    { path: 'a', at: now - 120_000 }, { path: 'b', at: now - 5_000 }, { path: 'c', at: now - 30_000 },
    { path: 'd', at: now - 7_200_000 }, { path: 'e', at: now - 172_800_000 },
  ];
  const rows = R.recentRows(list, (p) => p !== 'a', now);
  assert.deepEqual(rows.map((r) => r.ago), ['2m', 'now', '30s', '2h', '2d']);
  assert.equal(rows[0].gone, true);
  assert.equal(rows[1].gone, false);
});

test('kinds: one sh call says file, folder or gone for each path, names with spaces too', () => {
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recent-'));
  fs.mkdirSync(path.join(dir, 'sub dir'));
  fs.writeFileSync(path.join(dir, 'sub dir/a b.js'), '');
  const paths = ['sub dir/a b.js', 'sub dir', 'gone.js'];
  const out = execFileSync('sh', ['-c', R.KINDS, 'kinds', ...paths], { cwd: dir, encoding: 'utf8' });
  const kinds = R.kindsOf(paths, out);
  assert.deepEqual([...kinds], [['sub dir/a b.js', 'f'], ['sub dir', 'd'], ['gone.js', '-']]);
  assert.equal(R.kindsOf(paths, 'f').size, 0, 'a short answer is no answer');
});

test('relativeIn: a watched path inside the folder, else null', () => {
  assert.equal(R.relativeIn('/r', '/r/src/a.js'), 'src/a.js');
  assert.equal(R.relativeIn('/r/', '/r/a.js'), 'a.js');
  assert.equal(R.relativeIn('/r', '/r'), null, 'the root itself means refresh everything');
  assert.equal(R.relativeIn('/r', '/rx/a.js'), null);
});

test('dropFolders: entries known to be folders go, unknown and gone stay; same list back when nothing goes', () => {
  const list = [{ path: 'a', at: 3 }, { path: 'src', at: 2 }, { path: 'b', at: 1 }];
  const kinds = new Map([['a', 'f'], ['src', 'd']]);
  assert.deepEqual(R.dropFolders(list, kinds), [{ path: 'a', at: 3 }, { path: 'b', at: 1 }]);
  const none = new Map([['a', '-']]);
  assert.equal(R.dropFolders(list, none), list);
});
