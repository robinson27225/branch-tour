// Names the blood relationship between two people from their ancestor lines, the way WikiTree's
// Relationship Finder does: find the closest ancestor they share, count the generations down each side.
// Pure functions over a parent graph: Map(id -> { father, mother }).

const MAX_DEPTH = 10;

export function parentGraph(people) {
  const g = new Map();
  for (const [key, p] of Object.entries(people)) {
    const id = Number(p.Id || key);
    const father = Number(p.Father) > 0 ? Number(p.Father) : 0;
    const mother = Number(p.Mother) > 0 ? Number(p.Mother) : 0;
    if (id > 0) g.set(id, { father, mother });
  }
  return g;
}

// id -> fewest generations up from `start` (start itself is 0).
export function ancestorGenerations(graph, start, maxDepth = MAX_DEPTH) {
  const gens = new Map([[start, 0]]);
  let frontier = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next = [];
    for (const id of frontier) {
      const node = graph.get(id);
      if (!node) continue;
      for (const parent of [node.father, node.mother]) {
        if (parent && !gens.has(parent)) { gens.set(parent, depth); next.push(parent); }
      }
    }
    frontier = next;
  }
  return gens;
}

// The shared ancestor(s) with the fewest generations in all, and whether they are one person (half) or a couple.
export function closestCommon(graph, gensA, gensB) {
  let best = null;
  for (const [id, a] of gensA) {
    const b = gensB.get(id);
    if (b === undefined || a === 0 && b === 0) continue;
    const total = a + b;
    if (!best || total < best.total || (total === best.total && Math.max(a, b) < Math.max(best.a, best.b))) best = { a, b, total, ids: [id] };
    else if (total === best.total && a === best.a && b === best.b) best.ids.push(id);
  }
  if (!best) return null;
  const set = new Set(best.ids);
  let couple = false;
  for (const node of graph.values()) if (node.father && node.mother && set.has(node.father) && set.has(node.mother)) { couple = true; break; }
  return { ...best, half: best.ids.length < 2 || !couple };
}

const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const REMOVED = ['', 'once', 'twice', 'three times', 'four times', 'five times', 'six times', 'seven times', 'eight times', 'nine times', 'ten times'];
const nth = (n) => ORD[n] || `${n}th`;
const times = (n) => REMOVED[n] || `${n} times`;
const sex = (g, m, f, n) => (g === 'Male' ? m : g === 'Female' ? f : n);
const greats = (n) => (n <= 0 ? '' : n === 1 ? 'great-' : `${n === 2 ? 'second' : nth(n)} great-`);

// a = generations from you up to the shared ancestor, b = from them up to it. Both at least 1.
// Written to follow "They were ...".
export function describeKin(a, b, half, gender) {
  const h = half ? 'half ' : '';
  if (a === 1 && b === 1) return `your ${h}${sex(gender, 'brother', 'sister', 'sibling')}`;
  if (b === 1) return `your ${h}${a > 2 ? greats(a - 2) : ''}${sex(gender, 'uncle', 'aunt', 'aunt or uncle')}`;
  if (a === 1) return `your ${h}${b > 2 ? greats(b - 2) : ''}${sex(gender, 'nephew', 'niece', 'niece or nephew')}`;
  const degree = Math.min(a, b) - 1;
  const removed = Math.abs(a - b);
  return `your ${h}${nth(degree)} cousin${removed ? ` ${times(removed)} removed` : ''}`;
}

// null when no shared ancestor is within reach (related by marriage, or further back than we looked).
export function kinOf(graph, myGens, theirId, maxDepth = MAX_DEPTH) {
  if (myGens.get(theirId) === 0) return null; // yourself
  const theirs = ancestorGenerations(graph, theirId, maxDepth);
  const common = closestCommon(graph, myGens, theirs);
  if (!common || common.a === 0 || common.b === 0) return null; // direct lines are named elsewhere
  return { a: common.a, b: common.b, total: common.total, half: common.half, via: common.ids };
}
