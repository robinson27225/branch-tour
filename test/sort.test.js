import { test } from 'node:test';
import assert from 'node:assert/strict';
import { surnameOf, closeness, sortPeople, SORTS, DEFAULT_SORT } from '../src/sort.js';

const P = (id, name, o = {}) => ({ id, name, birth: { date: '' }, death: { date: '' }, ...o });
const ids = (list) => list.map((p) => p.id);

test('the default is the birth surname', () => assert.equal(DEFAULT_SORT, 'surname'));
test('every sort offered is known to sortPeople', () => {
  const list = [P('B-1', 'B'), P('A-1', 'A')];
  for (const { id } of SORTS) assert.equal(sortPeople(list, id).length, 2);
});

test('surnameOf: the stored birth name, else the WikiTree ID, else the last word', () => {
  assert.equal(surnameOf(P('Orem-182', 'Betty Lou Wyland', { lastNameAtBirth: 'Orem' })), 'Orem');
  assert.equal(surnameOf(P('Orem-182', 'Betty Lou Wyland')), 'Orem');          // an older pack: the ID starts with it
  assert.equal(surnameOf(P("D'Allemand-14", 'X')), "D'Allemand");
  assert.equal(surnameOf(P('Unknown-9', 'Mary Smith')), 'Smith');
  assert.equal(surnameOf(P('u123', 'Mary Smith')), 'Smith');
});

test('sorted by surname, ties by name, ignoring case and keeping the input untouched', () => {
  const list = [P('Wyland-2', 'Quinten Wyland'), P('bagby-165', 'Margaret Bagby'), P('Wyland-1', 'Betty Wyland', { lastNameAtBirth: 'Orem' }), P('Fox-1', 'David Fox')];
  assert.deepEqual(ids(sortPeople(list, 'surname')), ['bagby-165', 'Fox-1', 'Wyland-1', 'Wyland-2']);
  assert.deepEqual(ids(list), ['Wyland-2', 'bagby-165', 'Wyland-1', 'Fox-1']);
});

test('surname order puts Orem before Wyland even when the married name sorts the other way', () => {
  const list = [P('Wyland-2', 'Quinten Wyland'), P('Orem-182', 'Betty Lou Wyland', { lastNameAtBirth: 'Orem' })];
  assert.deepEqual(ids(sortPeople(list, 'surname')), ['Orem-182', 'Wyland-2']);
});

test('birth and death sorts go by date and put people with no date last', () => {
  const list = [
    P('C-1', 'C', { birth: { date: '1900-05-01' }, death: { date: '1970' } }),
    P('A-1', 'A', { birth: { date: '1850-00-00' }, death: { date: '' } }),
    P('B-1', 'B', { birth: { date: '' }, death: { date: '1920-03-02' } }),
    P('D-1', 'D', { birth: { date: '1850-01-15' }, death: { date: '1920-01-09' } }),
  ];
  assert.deepEqual(ids(sortPeople(list, 'birth')), ['A-1', 'D-1', 'C-1', 'B-1']);   // 1850 with no month before 1850-01-15
  assert.deepEqual(ids(sortPeople(list, 'death')), ['D-1', 'B-1', 'C-1', 'A-1']);
});

test('closest relative first: ancestors and family, then cousins by distance, then marriage, then unknown, then not traced', () => {
  const list = [
    P('N-1', 'N', { relation: { kind: 'untraced' } }),
    P('K-1', 'K', { relation: { kind: 'cousin', generations: 20 } }),
    P('F-1', 'F', { relation: { kind: 'ancestor', degrees: 1 } }),
    P('J-1', 'J', { relation: { kind: 'cousin', generations: 14 } }),
    P('M-1', 'M', { relation: { kind: 'connection', distance: 3 } }),
    P('U-1', 'U'),
    P('G-1', 'G', { relation: { kind: 'ancestor', degrees: 3 } }),
  ];
  assert.deepEqual(ids(sortPeople(list, 'relation')), ['F-1', 'G-1', 'J-1', 'K-1', 'M-1', 'U-1', 'N-1']);
  assert.ok(closeness(P('x', 'x', { relation: { kind: 'sibling', degrees: 1 } })) < closeness(P('y', 'y', { relation: { kind: 'cousin', generations: 4 } })));
});

test('an unknown sort name falls back to surname', () => {
  assert.deepEqual(ids(sortPeople([P('B-1', 'B'), P('A-1', 'A')], 'nonsense')), ['A-1', 'B-1']);
});
