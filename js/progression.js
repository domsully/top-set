/*
 * Progression engine — pure functions, no DOM.
 *
 * Philosophy (per exercise, across every workout it appears in):
 *   - One heavy top set. Stay at a weight until you hit `moveUpReps` (default 9),
 *     then add `increment` (default 5 lb). A single session is enough to move up.
 *   - After moving to a new weight, it stays put for `graceSessions` (default 3)
 *     sessions no matter how they go.
 *   - After that, if the average top-set reps over the last `graceSessions`
 *     sessions at that weight is below `floorReps` (default 4), drop back.
 *   - Rep target: at a weight you've already lifted, match your most recent reps
 *     there (best reps at that weight are reported too). At a new weight, aim for
 *     `startReps` (default 6).
 *   - The strength trend uses a rolling average of estimated max over the last
 *     `windowSessions` (default 4) sessions, so one bad day barely moves it.
 *   - Back-off sets: `backoffSets` sets at `backoffPct` (default 70%) of the
 *     top weight, rounded to the increment.
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    unit: 'lb',
    increment: 5,
    moveUpReps: 9,
    floorReps: 4,
    graceSessions: 3,
    windowSessions: 4,
    backoffPct: 0.7,
    backoffSets: 2,
    startReps: 6
  };

  function withDefaults(settings) {
    var s = {};
    for (var k in DEFAULTS) s[k] = DEFAULTS[k];
    if (settings) for (var j in settings) if (settings[j] !== undefined && settings[j] !== null && settings[j] !== '') s[j] = settings[j];
    return s;
  }

  function roundTo(x, inc) {
    if (!inc || inc <= 0) return Math.round(x * 100) / 100;
    var r = Math.round(x / inc) * inc;
    return Math.round(r * 100) / 100;
  }

  /** Epley estimated 1-rep max. */
  function e1rm(weight, reps) {
    weight = Number(weight); reps = Number(reps);
    if (!(weight > 0) || !(reps > 0)) return 0;
    if (reps === 1) return weight;
    return weight * (1 + reps / 30);
  }

  /** Reps you'd expect at `weight` given an estimated max. */
  function repsAt(est, weight) {
    if (!(est > 0) || !(weight > 0)) return null;
    return 30 * (est / weight - 1);
  }

  function validSets(sets) {
    return (sets || []).filter(function (s) {
      return s && Number(s.reps) > 0 && Number(s.weight) >= 0 && s.weight !== '' && s.weight !== null;
    }).map(function (s) {
      return { kind: s.kind || 'work', weight: Number(s.weight), reps: Number(s.reps) };
    });
  }

  /** The top set: one marked 'top', otherwise the heaviest (ties → most reps). */
  function topSet(sets) {
    var v = validSets(sets);
    if (!v.length) return null;
    var marked = v.filter(function (s) { return s.kind === 'top'; });
    var pool = marked.length ? marked : v;
    return pool.reduce(function (best, s) {
      if (!best) return s;
      if (s.weight > best.weight) return s;
      if (s.weight === best.weight && s.reps > best.reps) return s;
      return best;
    }, null);
  }

  /**
   * Flatten every logged session into one chronological history for an exercise.
   * data.sessions: [{ id, date:'YYYY-MM-DD', createdAt, workoutId, entries:[{ exerciseId, sets:[...] }] }]
   */
  function historyFor(data, exerciseId) {
    var out = [];
    (data.sessions || []).forEach(function (sess) {
      (sess.entries || []).forEach(function (en, idx) {
        if (en.exerciseId !== exerciseId) return;
        var top = topSet(en.sets);
        if (!top) return;
        out.push({
          sessionId: sess.id,
          workoutId: sess.workoutId,
          date: sess.date,
          createdAt: sess.createdAt || 0,
          order: idx,
          top: top,
          sets: validSets(en.sets),
          e1rm: e1rm(top.weight, top.reps)
        });
      });
    });
    out.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.order - b.order;
    });
    return out;
  }

  function mean(arr) {
    if (!arr.length) return null;
    return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
  }

  /** Rolling average of estimated max over the last `n` sessions, for every point in history. */
  function trendSeries(hist, n) {
    return hist.map(function (h, i) {
      var win = hist.slice(Math.max(0, i - n + 1), i + 1).map(function (x) { return x.e1rm; }).filter(function (x) { return x > 0; });
      return mean(win);
    });
  }

  /**
   * Suggest the next session's top set and back-offs.
   * exercise: { increment?, startWeight? }  (per-exercise overrides)
   */
  function suggest(hist, settings, exercise) {
    var s = withDefaults(settings);
    exercise = exercise || {};
    var inc = Number(exercise.increment) > 0 ? Number(exercise.increment) : Number(s.increment);
    var res = {
      status: 'new', weight: null, reason: '', targetReps: null, targetIsStart: false,
      lastReps: null, bestReps: null, trend: null,
      runLength: 0, runAvg: null, lastTop: null, dropTo: null, backoff: null, increment: inc
    };

    if (!hist.length) {
      var start = Number(exercise.startWeight);
      res.weight = start > 0 ? start : null;
      res.reason = res.weight ? 'Starting weight. Log a session to build a trend.' : 'No history yet. Set a starting weight or just log your first session.';
      res.backoff = res.weight ? { weight: roundTo(res.weight * s.backoffPct, inc), sets: s.backoffSets } : null;
      if (res.weight) { res.targetReps = Number(s.startReps); res.targetIsStart = true; }
      return res;
    }

    var last = hist[hist.length - 1];
    var W = last.top.weight;
    res.lastTop = last.top;

    // Consecutive sessions at the current weight, ending with the latest one.
    var run = [];
    for (var i = hist.length - 1; i >= 0; i--) {
      if (hist[i].top.weight === W) run.unshift(hist[i]); else break;
    }
    res.runLength = run.length;

    // Where to drop back to: the most recent lighter weight before this run, else one increment down.
    var dropTo = null;
    for (var k = hist.length - run.length - 1; k >= 0; k--) {
      if (hist[k].top.weight < W) { dropTo = hist[k].top.weight; break; }
    }
    if (dropTo === null) dropTo = Math.max(0, roundTo(W - inc, inc));
    res.dropTo = dropTo;

    var grace = Math.max(1, Number(s.graceSessions));
    var recentRun = run.slice(-grace);
    res.runAvg = mean(recentRun.map(function (h) { return h.top.reps; }));

    if (last.top.reps >= s.moveUpReps) {
      res.status = 'up';
      res.weight = roundTo(W + inc, inc);
      res.reason = 'Hit ' + last.top.reps + ' reps at ' + W + ' — move up.';
    } else if (run.length >= grace && res.runAvg < s.floorReps) {
      res.status = 'drop';
      res.weight = dropTo;
      res.reason = 'Averaged ' + fmt1(res.runAvg) + ' reps over ' + grace + ' sessions at ' + W + ' (floor ' + s.floorReps + ') — drop back.';
    } else if (run.length < grace && run.length === hist.length) {
      // First weight ever logged: nothing to drop back to yet, just build reps.
      res.status = 'hold';
      res.weight = W;
      res.reason = 'Building reps toward ' + s.moveUpReps + '.';
    } else if (run.length < grace) {
      res.status = 'grace';
      res.weight = W;
      res.reason = 'Session ' + (run.length + 1) + ' of ' + grace + ' at this weight' +
        (last.top.reps < s.floorReps ? ' — rough day, holding steady.' : '.');
    } else {
      res.status = 'hold';
      res.weight = W;
      res.reason = 'Building reps toward ' + s.moveUpReps + '.';
    }

    // Rolling trend over the last N sessions (any weight).
    var series = trendSeries(hist, Math.max(1, Number(s.windowSessions)));
    res.trend = series[series.length - 1];

    // Reps you've done at the suggested weight: most recent and best.
    var atW = hist.filter(function (h) { return h.top.weight === res.weight; });
    if (atW.length) {
      res.lastReps = atW[atW.length - 1].top.reps;
      res.bestReps = Math.max.apply(null, atW.map(function (h) { return h.top.reps; }));
    }
    if (res.status === 'up' || res.lastReps === null) {
      res.targetReps = Number(s.startReps);
      res.targetIsStart = true;
    } else {
      res.targetReps = res.lastReps;
    }

    res.backoff = { weight: roundTo(res.weight * s.backoffPct, inc), sets: Number(s.backoffSets) };
    return res;
  }

  function fmt1(x) { return x === null || x === undefined ? '–' : (Math.round(x * 10) / 10).toString(); }

  var api = {
    DEFAULTS: DEFAULTS, withDefaults: withDefaults, roundTo: roundTo, e1rm: e1rm, repsAt: repsAt,
    topSet: topSet, validSets: validSets, historyFor: historyFor, trendSeries: trendSeries, suggest: suggest, fmt1: fmt1
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Progression = api;
})(typeof self !== 'undefined' ? self : this);
