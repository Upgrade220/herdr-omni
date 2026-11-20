// diff-handoff.js: Show diff's hand-off to git-graph's Diff tab. Own loader: the module is pure, no herdr.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const src = fs.readFileSync(path.join(__dirname, '../mods/better-files/files/diff-handoff.js'), 'utf8').replace(/^export /gm, '');
const D = new Function(`${src}\nreturn { DIFF_TABS, DIFF_OPEN, PENDING_MS, diffPlan, diffSource, diffTarget };`)();

const spaces = [{ id: 's1', tabs: [{ id: 'A' }, { id: 'G' }] }, { id: 's2', tabs: [{ id: 'B' }] }];

test('the keys are git-graph\'s', () => {
  assert.equal(D.DIFF_TABS, 'git-graph.diff-tabs');
  assert.equal(D.DIFF_OPEN, 'git-graph.diff-open');
});

test('diffSource: untracked, staged only, else unstaged', () => {
  assert.equal(D.diffSource({ mark: 'A', staged: false, untracked: true }), 'untracked');
  assert.equal(D.diffSource({ mark: 'M', staged: true, untracked: false }), 'staged');
  assert.equal(D.diffSource({ mark: 'A', staged: true, untracked: false }), 'staged');
  assert.equal(D.diffSource({ mark: 'M', staged: false, untracked: false }), 'unstaged');
  assert.equal(D.diffSource({ mark: 'A', staged: false, untracked: false }), 'unstaged', 'added, then changed again');
  assert.equal(D.diffSource({}), 'unstaged');
});

test('diffTarget: by path from the Git root, in the shape the Diff tab reads', () => {
  const t = { path: '/repo/src/main.go', root: '/repo/src', on: null, top: '/repo', relative: 'src/main.go', staged: true, untracked: false };
  assert.deepEqual(D.diffTarget(t), { root: '/repo', on: null, path: 'src/main.go', source: 'staged' });
  assert.equal(D.diffTarget({ ...t, top: null }), null, 'not in a repo');
  assert.equal(D.diffTarget({ ...t, on: 'box', untracked: true, staged: false }).on, 'box');
});

test('diffPlan selects a live Diff tab, else asks for one, and a second click while it is on its way only hands over', () => {
  const target = { path: 'src/cart.js' };
  assert.deepEqual(D.diffPlan({ map: { s1: 'G' }, spaces, spaceId: 's1', target, now: 5 }), { select: 'G', newTab: null, open: { s1: { target, at: 5 } } });
  const one = D.diffPlan({ map: { s1: 'gone' }, spaces, spaceId: 's1', target, now: 6 });
  assert.deepEqual(one, { select: null, newTab: { name: 'cart.js' }, open: { s1: { target, at: 6, pendingTab: { at: 6, before: ['A', 'G'] } } } });
  const two = D.diffPlan({ map: {}, open: one.open, spaces, spaceId: 's1', target, now: 7 });
  assert.deepEqual(two, { select: null, newTab: null, open: { s1: { target, at: 7, pendingTab: { at: 6, before: ['A', 'G'] } } } });
  assert.deepEqual(D.diffPlan({ map: {}, open: one.open, spaces, spaceId: 's1', target, now: 6 + D.PENDING_MS }).newTab, { name: 'cart.js' });
});

// git-graph decides the same way for its own clicks; the two must not drift apart.
const place = path.join(__dirname, '../../git-graph/mods/git-graph/place.js');
test('diffPlan plans what git-graph\'s openDiffPlan plans', { skip: !fs.existsSync(place) && 'git-graph not in this repo' }, async () => {
  const g = await import(pathToFileURL(place).href);
  assert.equal(g.DIFF_TABS, D.DIFF_TABS);
  assert.equal(g.DIFF_OPEN, D.DIFF_OPEN);
  assert.equal(g.PENDING_MS, D.PENDING_MS);
  const target = { root: '/r', on: null, path: 'a/b c.js', source: 'unstaged' };
  const pending = { s1: { target, at: 100, pendingTab: { at: 100, before: ['A'] } } };
  const cases = [
    { map: { s1: 'G' }, open: {}, spaceId: 's1', now: 1 },
    { map: { s1: 'gone' }, open: {}, spaceId: 's1', now: 1 },
    { map: undefined, open: undefined, spaceId: 's1', now: 1 },
    { map: {}, open: pending, spaceId: 's1', now: 100 + D.PENDING_MS - 1 },
    { map: {}, open: pending, spaceId: 's1', now: 100 + D.PENDING_MS },
    { map: {}, open: pending, spaceId: 's2', now: 101 },
    { map: {}, open: {}, spaceId: 'nowhere', now: 1 },
  ];
  for (const c of cases) assert.deepEqual(D.diffPlan({ ...c, spaces, target }), g.openDiffPlan({ ...c, spaces, target }), JSON.stringify(c));
});
