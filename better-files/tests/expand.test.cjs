// expand.js: which folders Expand all opens. Own loader: no herdr imports.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '../mods/better-files/files', f), 'utf8')
  .replace(/^import\s+[\s\S]*?;$/gm, '').replace(/^export /gm, '');
const E = new Function(`${read('recent.js')}\n${read('git-extras.js')}\n${read('expand.js')}\nreturn { childFolders, EXPAND_MAX };`)();

const entries = [
  { name: 'src', dir: true },
  { name: '.github', dir: true },
  { name: 'node_modules', dir: true },
  { name: 'dist', dir: true },
  { name: 'build', dir: true },
  { name: 'README.md', dir: false },
];

test('child folders of the root, skipping heavy folders', () => {
  assert.deepEqual(E.childFolders(entries, '', { dotfiles: true, ignored: null }), ['src', '.github', 'build']);
});

test('hidden dotfolders stay closed when dotfiles are hidden', () => {
  assert.deepEqual(E.childFolders(entries, '', { dotfiles: false, ignored: null }), ['src', 'build']);
});

test('Git-ignored folders stay closed', () => {
  const ignored = new Set(['build/']);
  assert.deepEqual(E.childFolders(entries, '', { dotfiles: true, ignored }), ['src', '.github']);
});

test('nested paths are relative to the shown folder', () => {
  const inner = [{ name: 'lib', dir: true }, { name: 'a.js', dir: false }];
  assert.deepEqual(E.childFolders(inner, 'src', { dotfiles: true, ignored: null }), ['src/lib']);
});

test('a cap on how many folders open at once', () => {
  assert.equal(E.EXPAND_MAX, 300);
});
