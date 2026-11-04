// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/progression.js');

let n = 0;
function mk(exerciseId, rows, workoutId = 'w1') {
  // rows: [[date, weight, reps, ...backoffs]]
  return {
    sessions: rows.map(([date, w, r, ...b]) => ({
      id: 's' + (++n), date, createdAt: n, workoutId,
      entries: [{ exerciseId, sets: [{ kind: 'top', weight: w, reps: r }, ...b.map(x => ({ kind: 'backoff', weight: x[0], reps: x[1] }))] }]
    }))
  };
}
const sug = (data, id = 'bench', ex = {}) => P.suggest(P.historyFor(data, id), {}, ex);

test('no history uses starting weight', () => {
  const r = sug({ sessions: [] }, 'bench', { startWeight: 135 });
  assert.equal(r.status, 'new');
  assert.equal(r.weight, 135);
  assert.equal(r.backoff.weight, 95);
});

test('single session at 9 reps moves up 5 lb', () => {
  const r = sug(mk('bench', [['2026-10-01', 185, 9]]));
  assert.equal(r.status, 'up');
  assert.equal(r.weight, 190);
  assert.equal(r.backoff.weight, 135);
});

test('8 reps holds weight', () => {
  const r = sug(mk('bench', [['2026-10-01', 185, 6], ['2026-10-08', 185, 7], ['2026-10-15', 185, 8]]));
  assert.equal(r.status, 'hold');
  assert.equal(r.weight, 185);
});

test('bad day right after a jump stays put (grace)', () => {
  const r = sug(mk('bench', [['2026-10-01', 185, 9], ['2026-10-08', 190, 3]]));
  assert.equal(r.status, 'grace');
  assert.equal(r.weight, 190);
  assert.equal(r.runLength, 1);
});

test('two rough sessions still in grace', () => {
  const d = mk('bench', [['2026-10-01', 185, 9], ['2026-10-08', 190, 3], ['2026-10-15', 190, 3]]);
  assert.equal(sug(d).status, 'grace');
});

test('drop back after 3 sessions averaging under 4', () => {
  const d = mk('bench', [['2026-10-01', 185, 9], ['2026-10-08', 190, 3], ['2026-10-15', 190, 4], ['2026-10-22', 190, 4]]);
  const r = sug(d);
  assert.equal(r.status, 'drop'); // 3,4,4 = 3.67
  assert.equal(r.weight, 185);
});

test('3 sessions averaging exactly 4 holds', () => {
  const d = mk('bench', [['2026-10-01', 185, 9], ['2026-10-08', 190, 3], ['2026-10-15', 190, 4], ['2026-10-22', 190, 5]]);
  assert.equal(sug(d).status, 'hold');
});

test('drop with no lighter history goes down one increment', () => {
  const d = mk('bench', [['2026-10-01', 200, 3], ['2026-10-08', 200, 3], ['2026-10-15', 200, 2]]);
  const r = sug(d);
  assert.equal(r.status, 'drop');
  assert.equal(r.weight, 195);
});

test('one off day mid-run does not move the weight', () => {
  const d = mk('bench', [['2026-10-01', 190, 6], ['2026-10-08', 190, 7], ['2026-10-15', 190, 4]]);
  const r = sug(d);
  assert.equal(r.status, 'hold');
  assert.equal(r.weight, 190);
});

test('shared history across workouts, sorted by date', () => {
  const a = mk('bench', [['2026-10-01', 185, 7], ['2026-10-08', 185, 8]], 'upperA');
  const b = mk('bench', [['2026-10-04', 185, 7], ['2026-10-11', 185, 9]], 'fullB');
  const data = { sessions: [...a.sessions, ...b.sessions] };
  const h = P.historyFor(data, 'bench');
  assert.deepEqual(h.map(x => x.date), ['2026-10-01', '2026-10-04', '2026-10-08', '2026-10-11']);
  assert.equal(P.suggest(h, {}).status, 'up');
});

test('rolling trend uses last 4 sessions and gives a rep target', () => {
  const d = mk('bench', [['2026-09-01', 150, 5], ['2026-10-01', 185, 6], ['2026-10-08', 185, 7], ['2026-10-15', 185, 8], ['2026-10-22', 190, 4]]);
  const r = sug(d);
  const lastFour = [[185, 6], [185, 7], [185, 8], [190, 4]].map(([w, x]) => P.e1rm(w, x));
  assert.ok(Math.abs(r.trend - lastFour.reduce((a, b) => a + b) / 4) < 1e-9);
  assert.equal(r.status, 'grace');
  assert.equal(r.weight, 190);
  assert.equal(r.targetReps, 4); // most recent reps at 190
});

test('per-exercise increment override', () => {
  const r = sug(mk('db', [['2026-10-01', 50, 9]]), 'db', { increment: 2.5 });
  assert.equal(r.weight, 52.5);
});

test('top set is heaviest when none marked', () => {
  assert.deepEqual(P.topSet([{ weight: 135, reps: 10 }, { weight: 185, reps: 6 }, { weight: 185, reps: 7 }]), { kind: 'work', weight: 185, reps: 7 });
});

test('empty / partial sets are ignored', () => {
  assert.equal(P.topSet([{ weight: '', reps: '' }, { weight: 100, reps: 0 }]), null);
});

test('half reps are kept and 8.5 does not move up', () => {
  assert.equal(sug(mk('lp', [['2026-10-01', 190, 8.5]]), 'lp').status, 'hold');
  assert.equal(sug(mk('lp', [['2026-10-01', 190, 5.5]]), 'lp').lastTop.reps, 5.5);
});

test('first set marked top wins even if a later set is heavier', () => {
  assert.equal(P.topSet([{ kind: 'top', weight: 180, reps: 4 }, { kind: 'backoff', weight: 185, reps: 2 }]).weight, 180);
});

test('holding shows most recent reps and best reps at that weight', () => {
  let r = sug(mk('bench', [['2026-10-01', 185, 9], ['2026-10-08', 190, 6], ['2026-10-15', 190, 7]]));
  assert.equal(r.targetReps, 7); assert.equal(r.lastReps, 7); assert.equal(r.bestReps, 7);
  r = sug(mk('bench', [['2026-10-01', 185, 9], ['2026-10-08', 190, 6], ['2026-10-15', 190, 8], ['2026-10-22', 190, 5]]));
  assert.equal(r.status, 'hold'); assert.equal(r.targetReps, 5); assert.equal(r.bestReps, 8);
  assert.equal(r.targetIsStart, false);
});

test('a new weight always starts at 6 reps', () => {
  const r = sug(mk('bench', [['2026-10-01', 185, 7], ['2026-10-08', 185, 9]]));
  assert.equal(r.status, 'up'); assert.equal(r.weight, 190);
  assert.equal(r.targetReps, 6); assert.equal(r.targetIsStart, true);
  assert.equal(r.lastReps, null);
  assert.equal(sug({ sessions: [] }, 'bench', { startWeight: 135 }).targetReps, 6);
});

test('dropping back uses your reps from that weight', () => {
  const d = mk('bench', [['2026-09-24', 185, 8], ['2026-10-01', 185, 9], ['2026-10-08', 190, 3], ['2026-10-15', 190, 4], ['2026-10-22', 190, 3]]);
  const r = sug(d);
  assert.equal(r.status, 'drop'); assert.equal(r.weight, 185);
  assert.equal(r.lastReps, 9); assert.equal(r.bestReps, 9); assert.equal(r.targetReps, 9);
});

test('start reps setting is configurable', () => {
  const h = P.historyFor(mk('bench', [['2026-10-01', 185, 9]]), 'bench');
  assert.equal(P.suggest(h, { startReps: 5 }).targetReps, 5);
});
