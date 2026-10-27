import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parentGraph, ancestorGenerations, closestCommon, describeKin, kinOf } from '../src/kinship.js';

// ids: 100 & 101 great-grandparents (a couple); their children 1 (with 2) and 102.
//      1 & 2 -> 3 (with 6) and 4 (with 8) and 5.      3 & 6 -> 10 (you), 11 (sibling).  3 & 7 -> 12 (half sibling).
//      4 & 8 -> 13 (first cousin).  13 -> 16 (first cousin once removed).  11 -> 14 (nephew).
//      102 -> 103 -> 104 (second cousin to you: all share 100/101).
//      40 is a half sibling of 3 (child of 1 and 41); 40 & 43 -> 42, so 42 is your HALF first cousin.
const tree = () => parentGraph(Object.fromEntries([
  [1, [100, 101]], [102, [100, 101]],
  [3, [1, 2]], [4, [1, 2]], [5, [1, 2]],
  [10, [3, 6]], [11, [3, 6]], [12, [3, 7]],
  [13, [4, 8]], [16, [13, 30]], [14, [11, 31]],
  [103, [102, 9]], [104, [103, 32]], [21, [4, 20]], [40, [1, 41]], [42, [40, 43]],
  [100, [0, 0]], [101, [0, 0]], [2, [0, 0]],
].map(([id, [f, m]]) => [id, { Id: id, Father: f, Mother: m }])));

const kin = (a, b) => { const g = tree(); const mine = ancestorGenerations(g, a, 20); return kinOf(g, mine, b, 20); };
const label = (a, b, gender = 'Male') => { const k = kin(a, b); return k && describeKin(k.a, k.b, k.half, gender); };

test('ancestorGenerations counts generations up and keeps the fewest', () => {
  const g = ancestorGenerations(tree(), 10, 10);
  assert.equal(g.get(10), 0); assert.equal(g.get(3), 1); assert.equal(g.get(1), 2); assert.equal(g.get(100), 3);
  assert.ok(!g.has(4));
  assert.ok(!ancestorGenerations(tree(), 10, 1).has(1)); // depth is respected
});

test('siblings, half siblings, aunts and uncles, nieces and nephews', () => {
  assert.equal(label(10, 11, 'Male'), 'your brother');
  assert.equal(label(10, 11, 'Female'), 'your sister');
  assert.equal(label(10, 12, 'Male'), 'your half brother');       // only one parent shared
  assert.equal(label(10, 4, 'Male'), 'your uncle');                // 4 is a child of your grandparents
  assert.equal(label(10, 5, 'Female'), 'your aunt');
  assert.equal(label(10, 14, 'Male'), 'your nephew');              // child of your sibling
  assert.equal(label(14, 10, 'Female'), 'your aunt'.replace('aunt', 'aunt'));
});

test('cousins, removals and halves, with the shared ancestors', () => {
  assert.equal(label(10, 13), 'your first cousin');
  assert.equal(label(10, 16), 'your first cousin once removed');
  assert.equal(label(10, 21), 'your first cousin');              // a different other parent changes nothing: the grandparents are shared
  assert.equal(label(10, 42), 'your half first cousin');         // their parent is only a half sibling of yours
  assert.equal(label(10, 104), 'your second cousin');
  const k = kin(10, 13);
  assert.deepEqual([k.a, k.b, k.total, k.half], [2, 2, 4, false]); // both grandparents shared
  assert.deepEqual(k.via.sort(), [1, 2]);
  assert.equal(kin(10, 42).half, true);
  assert.deepEqual(kin(10, 42).via, [1]);
});

test('direct lines and strangers are not cousins', () => {
  assert.equal(kin(10, 1), null);      // your ancestor
  assert.equal(kin(1, 10), null);      // your descendant
  assert.equal(kin(10, 999), null);    // unknown
  assert.equal(kin(10, 10), null);
});

test('describeKin wording, including WikiTree\'s own example', () => {
  // Azure and Laodicia: 9 generations up on one side, 5 on the other, one shared ancestor
  assert.equal(describeKin(9, 5, true, 'Female'), 'your half fourth cousin four times removed');
  assert.equal(describeKin(10, 10, false, 'Male'), 'your ninth cousin');
  assert.equal(describeKin(11, 9, false, ''), 'your eighth cousin twice removed');
  assert.equal(describeKin(3, 1, false, 'Female'), 'your great-aunt');
  assert.equal(describeKin(4, 1, false, 'Male'), 'your second great-uncle');
  assert.equal(describeKin(1, 3, false, 'Male'), 'your great-nephew');
  assert.equal(describeKin(2, 1, false, ''), 'your aunt or uncle');
  assert.equal(describeKin(3, 3, false, ''), 'your second cousin');
  assert.equal(describeKin(14, 3, false, ''), 'your second cousin eleven times removed'.replace('eleven times', '11 times'));
});

test('closestCommon picks the fewest generations in all, and tells a couple from one person', () => {
  const g = tree();
  const c = closestCommon(g, ancestorGenerations(g, 10, 20), ancestorGenerations(g, 104, 20));
  assert.deepEqual([c.a, c.b, c.half], [3, 3, false]);
});
