/* Top Set — app UI. Vanilla JS, no build step. Data lives in localStorage on this device. */
(function () {
  'use strict';
  var P = window.Progression;
  var KEY = 'topset.v1';
  var DRAFT_KEY = 'topset.draft.v1';
  var APP_VERSION = '1.3.1';

  // ---------- small utils ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtW(x) {
    if (x === null || x === undefined || x === '' || isNaN(x)) return '–';
    return String(Math.round(Number(x) * 100) / 100);
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayISO(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(s) { var p = String(s).split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); }
  function addDays(iso, n) { var d = parseISO(iso); d.setDate(d.getDate() + n); return todayISO(d); }
  function fmtDate(s, long) {
    var d = parseISO(s);
    var o = { month: 'short', day: 'numeric' };
    if (long) o.weekday = 'short';
    if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString(undefined, o);
  }
  function $(sel) { return document.querySelector(sel); }

  // ---------- storage ----------
  function emptyDB(settings) {
    var s = {};
    for (var k in P.DEFAULTS) s[k] = P.DEFAULTS[k];
    s.barWeight = 45;
    if (settings) for (var j in settings) s[j] = settings[j];
    return { version: 1, settings: s, exercises: [], workouts: [], sessions: [], sleep: {}, example: false, lastExport: null };
  }
  function normalize(d) {
    var base = emptyDB();
    d = d && typeof d === 'object' ? d : {};
    var s = base.settings;
    if (d.settings) for (var k in d.settings) s[k] = d.settings[k];
    return {
      version: 1, settings: s,
      exercises: Array.isArray(d.exercises) ? d.exercises : [],
      workouts: Array.isArray(d.workouts) ? d.workouts.map(migrateWorkout) : [],
      sessions: mergeSameDay(Array.isArray(d.sessions) ? d.sessions : []),
      sleep: migrateSleep(d),
      example: !!d.example, lastExport: d.lastExport || null
    };
  }
  // Saving a workout part-way and then again later the same day makes two sessions.
  // Fold them into one session per workout per day so history reads as one workout.
  var mergedOnLoad = 0;
  function mergeSameDay(sessions) {
    var keep = [], byKey = {};
    sessions.slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); }).forEach(function (s) {
      if (!s || !s.workoutId || !s.date) { keep.push(s); return; }
      var k = s.workoutId + '|' + s.date, first = byKey[k];
      if (!first) { byKey[k] = s; keep.push(s); return; }
      first.entries = (first.entries || []).concat(s.entries || []);
      if (s.note && s.note !== first.note) first.note = first.note ? first.note + ' / ' + s.note : s.note;
      first.createdAt = Math.max(first.createdAt || 0, s.createdAt || 0);
      mergedOnLoad++;
    });
    return keep;
  }
  // Sleep is one entry per day. v1.2 kept it on sessions; move any of those into the daily log.
  function migrateSleep(d) {
    var out = {};
    if (d.sleep && typeof d.sleep === 'object' && !Array.isArray(d.sleep)) {
      for (var k in d.sleep) { var h = parseSleep(d.sleep[k]); if (/^\d{4}-\d{2}-\d{2}$/.test(k) && h !== null) out[k] = h; }
    }
    (Array.isArray(d.sessions) ? d.sessions : []).forEach(function (sess) {
      if (sess && sess.sleep !== undefined) {
        var h = parseSleep(sess.sleep);
        if (h !== null && out[sess.date] === undefined) out[sess.date] = h;
        delete sess.sleep;
      }
    });
    return out;
  }
  // A workout is a list of groups ("slots"), e.g. "Chest". Each group lists the exercises you can pick from that day.
  function migrateWorkout(w) {
    if (!Array.isArray(w.slots)) {
      w.slots = (Array.isArray(w.items) ? w.items : []).map(function (it) {
        return { id: uid(), name: it.group || '', options: [{ exerciseId: it.exerciseId, note: it.note || '' }] };
      });
    }
    delete w.items;
    w.slots.forEach(function (sl) {
      if (!sl.id) sl.id = uid();
      if (!Array.isArray(sl.options)) sl.options = [];
      if (sl.name === undefined) sl.name = '';
    });
    if (w.description === undefined) w.description = '';
    return w;
  }
  function looksLikeBackup(d) {
    return d && typeof d === 'object' && Array.isArray(d.exercises) && Array.isArray(d.workouts) && Array.isArray(d.sessions);
  }
  function loadDB() {
    try { var raw = localStorage.getItem(KEY); if (raw) return normalize(JSON.parse(raw)); } catch (e) { /* fall through */ }
    return null;
  }
  var storageWarned = false;
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) {
      if (!storageWarned) toast('This device won’t let the app save. Export a backup from Settings so you don’t lose work.');
      storageWarned = true;
    }
  }
  var persistTimer = null;
  function persistSoon() { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 300); }

  function loadDraft() { try { var r = localStorage.getItem(DRAFT_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  var draftTimer = null;
  function saveDraftSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) { /* ignore */ } }, 250);
  }
  function clearDraft() { draft = null; try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } }
  function draftHasData(d) {
    return !!d && d.entries.some(function (e) { return e.sets.some(function (s) { return s.reps !== '' && s.reps !== null && s.reps !== undefined; }); });
  }

  // ---------- example program ----------
  function exampleDB() {
    var d = emptyDB();
    d.example = true;
    function ex(name, equipment, notes) {
      var e = { id: uid(), name: name, notes: notes || '', equipment: equipment, increment: '', startWeight: '' };
      d.exercises.push(e); return e;
    }
    var bench = ex('Bench press', 'barbell', 'Feet planted, touch mid-chest.');
    var squat = ex('Back squat', 'barbell');
    var dl = ex('Deadlift', 'barbell');
    var ohp = ex('Overhead press', 'barbell');
    var row = ex('Barbell row', 'barbell');
    var rdl = ex('Romanian deadlift', 'barbell');
    var incl = ex('Incline dumbbell press', 'dumbbell', 'Weight is per dumbbell.');
    function wk(name, desc, items) {
      var w = { id: uid(), name: name, description: desc, slots: items.map(function (it) { return { id: uid(), name: it[2] || '', options: [{ exerciseId: it[0].id, note: it[1] || '' }] }; }) };
      d.workouts.push(w); return w;
    }
    var plan = [
      [1, wk('Upper A', 'Heavy bench day. Rest 3 min after each top set.', [[bench, '', 'Chest'], [row, 'Strict, no hip swing', 'Back'], [ohp, '', 'Shoulders']])],
      [2, wk('Lower A', 'Squat day.', [[squat, '', 'Squat'], [rdl, '3 second lowering', 'Hinge']])],
      [4, wk('Upper B', 'Press first, bench second.', [[ohp, '', 'Shoulders'], [incl, '', 'Incline'], [bench, 'Paused reps', 'Chest']])],
      [5, wk('Lower B', 'Pull day.', [[dl, '', 'Hinge'], [squat, 'Belt on the top set', 'Squat']])]
    ];
    var script = {};
    script[bench.id] = [[185, 6], [185, 7], [185, 6], [185, 8], [185, 9], [190, 5], [190, 4], [190, 6], [190, 7], [190, 6], [190, 8]];
    script[squat.id] = [[225, 5], [225, 6], [225, 6], [225, 7], [225, 8], [225, 9], [230, 5], [230, 6], [230, 4], [230, 6], [230, 7]];
    script[dl.id] = [[275, 6], [275, 7], [275, 9], [280, 6], [280, 7]];
    script[ohp.id] = [[115, 7], [115, 8], [115, 8], [115, 9], [120, 4], [120, 5], [120, 3], [120, 5], [120, 6], [120, 6], [120, 7]];
    script[row.id] = [[155, 8], [155, 9], [160, 7], [160, 8], [160, 8], [160, 9]];
    script[rdl.id] = [[185, 8], [185, 8], [185, 9], [190, 7], [190, 8], [190, 8]];
    script[incl.id] = [[55, 8], [55, 9], [60, 4], [60, 3], [60, 3]];
    var today = todayISO();
    var now = new Date();
    var dow = (now.getDay() + 6) % 7; // Monday = 0
    var monday = addDays(today, -dow - 35);
    var t = 1;
    for (var week = 0; week < 6; week++) {
      plan.forEach(function (p) {
        var date = addDays(monday, week * 7 + p[0] - 1);
        if (date >= today) return;
        var entries = [];
        p[1].slots.forEach(function (sl) {
          var exId = sl.options[0].exerciseId;
          var q = script[exId];
          if (!q || !q.length) return;
          var s = q.shift();
          var bo = P.roundTo(s[0] * 0.7, 5);
          entries.push({ slotId: sl.id, exerciseId: exId, sets: [
            { kind: 'top', weight: s[0], reps: s[1] },
            { kind: 'backoff', weight: bo, reps: 10 }
          ] });
        });
        if (entries.length) d.sessions.push({ id: uid(), date: date, createdAt: t++, workoutId: p[1].id, note: '', entries: entries });
      });
    }
    var sleepScript = [7.5, 6, 8, 7, 5.5, 7.5, 8.5, 6.5, 7, 6, 8, 7, 6.5, 9];
    for (var n = 1; n <= sleepScript.length; n++) d.sleep[addDays(today, -n)] = sleepScript[n - 1];
    return d;
  }

  // ---------- state ----------
  var db = loadDB();
  if (!db) { db = exampleDB(); persist(); }
  else if (mergedOnLoad) persist();
  var draft = loadDraft();
  var editDraft = null;
  var view = { name: 'train' };
  var stack = [];
  var pendingImport = null;

  function exById(id) { for (var i = 0; i < db.exercises.length; i++) if (db.exercises[i].id === id) return db.exercises[i]; return null; }
  function wById(id) { for (var i = 0; i < db.workouts.length; i++) if (db.workouts[i].id === id) return db.workouts[i]; return null; }
  function sessById(id) { for (var i = 0; i < db.sessions.length; i++) if (db.sessions[i].id === id) return db.sessions[i]; return null; }
  function unit() { return db.settings.unit === 'kg' ? 'kg' : 'lb'; }
  function suggestionFor(ex) {
    var h = P.historyFor(db, ex.id);
    var s = P.suggest(h, db.settings, ex);
    s.hist = h;
    return s;
  }
  function usedIn(exId) {
    return db.workouts.filter(function (w) { return w.slots.some(function (sl) { return sl.options.some(function (o) { return o.exerciseId === exId; }); }); });
  }
  function sleepFor(date) { var h = db.sleep ? db.sleep[date] : undefined; return h === undefined ? null : parseSleep(h); }
  function sleepOf(sessionId) { var s = sessById(sessionId); return s ? sleepFor(s.date) : null; }
  function slotById(w, id) { if (!w) return null; for (var i = 0; i < w.slots.length; i++) if (w.slots[i].id === id) return w.slots[i]; return null; }
  // Which option to pre-select for a group: the one you logged last time in this group, else the first.
  function defaultPick(w, sl) {
    var opts = sl.options.filter(function (o) { return exById(o.exerciseId); });
    if (!opts.length) return null;
    var ids = opts.map(function (o) { return o.exerciseId; });
    var sess = db.sessions.filter(function (s) { return s.workoutId === w.id; }).sort(function (a, b) {
      return a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.createdAt || 0) - (a.createdAt || 0);
    });
    for (var i = 0; i < sess.length; i++) {
      for (var j = 0; j < sess[i].entries.length; j++) {
        var e = sess[i].entries[j];
        if (e.slotId === sl.id && ids.indexOf(e.exerciseId) >= 0) return e.exerciseId;
      }
    }
    return ids[0];
  }
  function lastDone(workoutId) {
    var dates = db.sessions.filter(function (s) { return s.workoutId === workoutId; }).map(function (s) { return s.date; }).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }

  // ---------- icons ----------
  var I = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
    train: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12h20"/><rect x="5" y="7" width="3" height="10" rx="1"/><rect x="16" y="7" width="3" height="10" rx="1"/><path d="M3 9.5v5M21 9.5v5"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    up: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'
  };

  // ---------- pieces ----------
  function statusChip(s) {
    var grace = Number(db.settings.graceSessions) || 3;
    var map = {
      up: ['up', 'Move up'],
      hold: ['hold', 'Hold'],
      grace: ['grace', 'New weight ' + Math.min(s.runLength + 1, grace) + '/' + grace],
      drop: ['drop', 'Drop back'],
      'new': ['new', 'Start']
    };
    var m = map[s.status] || map.hold;
    return '<span class="chip ' + m[0] + '">' + esc(m[1]) + '</span>';
  }

  function plateList(weight, barOverride) {
    var bar = barOverride !== undefined ? barOverride : Number(db.settings.barWeight);
    if (!(bar >= 0)) bar = unit() === 'kg' ? 20 : 45;
    if (!(weight > bar)) return null;
    var side = (weight - bar) / 2;
    var sizes = unit() === 'kg' ? [25, 20, 15, 10, 5, 2.5, 1.25] : [45, 35, 25, 10, 5, 2.5];
    var out = [];
    sizes.forEach(function (p) { while (side >= p - 1e-9) { out.push(p); side -= p; } });
    return { plates: out, rest: Math.round(side * 100) / 100 };
  }
  function plateSVG(weight, barOverride) {
    var pl = plateList(weight, barOverride);
    if (!pl || !pl.plates.length) return '';
    var kg = unit() === 'kg';
    var H = kg ? { 25: 36, 20: 36, 15: 32, 10: 28, 5: 20, 2.5: 15, 1.25: 11 } : { 45: 36, 35: 32, 25: 28, 10: 21, 5: 16, 2.5: 12 };
    function cls(p) {
      if (kg) return p >= 20 ? 'p45' : p === 15 ? 'p35' : p === 10 ? 'p25' : 'psm';
      return p === 45 ? 'p45' : p === 35 ? 'p35' : p === 25 ? 'p25' : 'psm';
    }
    var x = 20, parts = [];
    pl.plates.forEach(function (p) {
      var w = p >= 10 ? 7 : 5, h = H[p] || 12;
      parts.push('<rect class="' + cls(p) + '" x="' + x + '" y="' + (20 - h / 2) + '" width="' + w + '" height="' + h + '" rx="1.5"/>');
      x += w + 1.5;
    });
    var width = x + 14;
    var svg = '<svg viewBox="0 0 ' + width + ' 40" role="img" aria-label="Plates per side: ' + pl.plates.join(', ') + '">' +
      '<rect class="pbar" x="0" y="18" width="' + width + '" height="4" rx="2"/>' +
      '<rect class="pbar" x="14" y="13" width="4" height="14" rx="1"/>' + parts.join('') + '</svg>';
    var label = pl.plates.map(fmtW).join(' · ') + (pl.rest > 0 ? ' +' + fmtW(pl.rest) : '');
    return '<div class="plates">' + svg + '<span class="small muted num">per side ' + esc(label) + '</span></div>';
  }

  // "Last 7 · Best 8" at the suggested weight, or "Start at 6" for a new weight.
  function repsLine(s) {
    if (s.weight === null || s.weight === undefined || !s.targetReps) return '';
    if (s.targetIsStart) return 'New weight · start at ' + s.targetReps + (s.bestReps ? ' · best here ' + fmtW(s.bestReps) : '');
    return 'Last ' + fmtW(s.lastReps) + ' · Best ' + fmtW(s.bestReps);
  }

  function suggestionBlock(ex, s) {
    var u = unit();
    if (s.weight === null || s.weight === undefined) {
      return '<p class="muted small">' + esc(s.reason) + '</p>';
    }
    var target = s.targetReps ? s.targetReps : null;
    var big = '<div class="big num">' + fmtW(s.weight) + '<span class="unit">' + u + '</span>' +
      (target ? '<span class="x">×</span>' + fmtW(target) : '') + '</div>';
    var sub = target ? '<div class="small"><span class="reps-meta">' + esc(repsLine(s)) + '</span><span class="muted"> · move up at ' + esc(db.settings.moveUpReps) + '</span></div>' : '';
    var bo = s.backoff && s.backoff.sets > 0 ? '<span class="chip">Back-off ' + s.backoff.sets + ' × ' + fmtW(s.backoff.weight) + '</span>' : '';
    return '<div class="suggest">' + big + (ex.equipment === 'barbell' ? plateSVG(Number(s.weight)) : ex.equipment === 'smith' ? plateSVG(Number(s.weight), 0) : '') + '</div>' + sub +
      '<p class="small muted">' + esc(s.reason) + '</p>' + (bo ? '<div class="chips">' + bo + '</div>' : '');
  }

  function setsString(sets) {
    return sets.map(function (s) { return fmtW(s.weight) + '×' + s.reps; }).join(' · ');
  }

  function sparkSVG(hist) {
    var tr = P.trendSeries(hist, Number(db.settings.windowSessions) || 4).slice(-10).filter(function (x) { return x; });
    if (tr.length < 2) return '<svg class="spark" viewBox="0 0 72 28" aria-hidden="true"></svg>';
    var lo = Math.min.apply(null, tr), hi = Math.max.apply(null, tr);
    if (hi - lo < 1) { hi += 1; lo -= 1; }
    var pts = tr.map(function (v, i) { return (2 + 68 * i / (tr.length - 1)).toFixed(1) + ',' + (25 - 22 * (v - lo) / (hi - lo)).toFixed(1); });
    var last = pts[pts.length - 1].split(',');
    return '<svg class="spark" viewBox="0 0 72 28" aria-hidden="true"><polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.6" fill="var(--accent)"/></svg>';
  }

  function chartSVG(hist) {
    var MAX = 24;
    var h = hist.slice(-MAX);
    if (h.length < 2) return '<p class="muted small">Log a couple of sessions to see the chart.</p>';
    var full = P.trendSeries(hist, Number(db.settings.windowSessions) || 4);
    var trend = full.slice(-h.length);
    var W = 340, H = 196, L = 38, R = 12, T = 12, B = 28;
    var vals = [];
    h.forEach(function (x, i) { vals.push(x.e1rm, x.top.weight); if (trend[i]) vals.push(trend[i]); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var steps = [5, 10, 20, 25, 50, 100, 200];
    var step = steps[steps.length - 1];
    for (var k = 0; k < steps.length; k++) { if ((Math.ceil(hi / steps[k]) - Math.floor(lo / steps[k])) <= 5) { step = steps[k]; break; } }
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; if (hi === lo) hi += step;
    function X(i) { return L + (W - L - R) * (i / (h.length - 1)); }
    function Y(v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); }
    var g = [];
    for (var v = lo; v <= hi + 1e-9; v += step) {
      g.push('<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/>');
      g.push('<text x="' + (L - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + fmtW(v) + '</text>');
    }
    var wpath = '';
    h.forEach(function (x, i) {
      var y = Y(x.top.weight).toFixed(1);
      if (i === 0) wpath += 'M' + X(0).toFixed(1) + ' ' + y;
      else wpath += ' H' + X(i).toFixed(1) + ' V' + y;
    });
    var tpts = [];
    trend.forEach(function (t, i) { if (t) tpts.push([X(i), Y(t)]); });
    var tpath = tpts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = tpath + ' L' + tpts[tpts.length - 1][0].toFixed(1) + ' ' + Y(lo).toFixed(1) + ' L' + tpts[0][0].toFixed(1) + ' ' + Y(lo).toFixed(1) + ' Z';
    var dots = h.map(function (x, i) { return '<circle class="dot" cx="' + X(i).toFixed(1) + '" cy="' + Y(x.e1rm).toFixed(1) + '" r="3"><title>' + esc(fmtDate(x.date)) + ': ' + fmtW(x.top.weight) + '×' + x.top.reps + '</title></circle>'; }).join('');
    var end = tpts[tpts.length - 1];
    var labels = '<text x="' + L + '" y="' + (H - 8) + '" text-anchor="start">' + esc(fmtDate(h[0].date)) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 8) + '" text-anchor="end">' + esc(fmtDate(h[h.length - 1].date)) + '</text>';
    return '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Strength trend over the last ' + h.length + ' sessions">' +
      g.join('') + '<path class="area" d="' + area + '" opacity="0.7"/>' + '<path class="weight" d="' + wpath + '"/>' +
      '<path class="trend" d="' + tpath + '"/>' + dots + '<circle class="end" cx="' + end[0].toFixed(1) + '" cy="' + end[1].toFixed(1) + '" r="4.5"/>' + labels + '</svg></div>' +
      '<div class="legend"><span><i style="background:var(--accent)"></i>Rolling avg est. max</span><span><i style="background:var(--muted)"></i>Top set weight</span><span><i style="background:transparent;border:1.5px solid var(--muted);width:8px;height:8px;border-radius:50%"></i>Session est. max</span></div>' +
      (hist.length > MAX ? '<p class="small muted">Showing the last ' + MAX + ' sessions.</p>' : '');
  }

  // ---------- sleep ----------
  function parseSleep(v) {
    if (v === undefined || v === null || String(v).trim() === '') return null;
    var n = Number(String(v).replace(',', '.').trim());
    return isFinite(n) && n >= 0 && n <= 24 ? Math.round(n * 100) / 100 : null;
  }
  var sleepSel = null; // the day selected in the sleep card
  function workoutsOn(date) {
    return db.sessions.filter(function (x) { return x.date === date; }).map(function (x) { var w = wById(x.workoutId); return w ? w.name : ''; }).filter(Boolean);
  }
  function sleepWeek() {
    var today = todayISO(), days = [];
    for (var i = 6; i >= 0; i--) { var dt = addDays(today, -i); days.push({ date: dt, hours: sleepFor(dt), workouts: workoutsOn(dt) }); }
    return days;
  }
  function sleepText(d) {
    return fmtDate(d.date, true) + ' · ' + (d.hours !== null ? fmtW(d.hours) + ' h sleep' : 'no sleep logged') +
      (d.workouts.length ? ' · before ' + d.workouts.join(', ') : '');
  }
  function sleepCard() {
    var days = sleepWeek();
    var today = todayISO();
    if (!sleepSel || !days.some(function (d) { return d.date === sleepSel; })) sleepSel = today;
    var sel = days.filter(function (d) { return d.date === sleepSel; })[0];
    var pts = days.filter(function (d) { return d.hours !== null; });
    var avg = pts.length ? pts.reduce(function (a, d) { return a + d.hours; }, 0) / pts.length : null;
    var W = 340, H = 150, L = 30, R = 10, T = 18, B = 24;
    var lo = 4, hi = 10;
    pts.forEach(function (d) { lo = Math.min(lo, Math.floor(d.hours / 2) * 2); hi = Math.max(hi, Math.ceil(d.hours / 2) * 2); });
    var colW = (W - L - R) / 7;
    function X(i) { return L + colW * (i + 0.5); }
    function Y(v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); }
    var g = [];
    days.forEach(function (d, i) {
      if (d.date === sleepSel) g.push('<rect class="sel-col" x="' + (X(i) - colW / 2 + 2).toFixed(1) + '" y="2" width="' + (colW - 4).toFixed(1) + '" height="' + (H - 4) + '" rx="8"/>');
    });
    for (var v = lo; v <= hi; v += 2) {
      g.push('<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/>');
      g.push('<text x="' + (L - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + v + '</text>');
    }
    var cols = days.map(function (d, i) {
      var lab = d.date === today ? 'Today' : parseISO(d.date).toLocaleDateString(undefined, { weekday: 'short' });
      var label = sleepText(d);
      var mark = d.hours === null ? '' :
        '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(d.hours).toFixed(1) + '" r="' + (d.date === sleepSel ? 7 : 5.5) + '"/>' +
        '<text class="val" x="' + X(i).toFixed(1) + '" y="' + (Y(d.hours) - 11).toFixed(1) + '" text-anchor="middle">' + fmtW(d.hours) + '</text>';
      return '<g class="sleep-pt' + (d.date === sleepSel ? ' on' : '') + '" tabindex="0" role="button" data-act="sleepDay" data-date="' + d.date + '" aria-pressed="' + (d.date === sleepSel) + '" aria-label="' + esc(label) + '">' +
        '<rect x="' + (X(i) - colW / 2).toFixed(1) + '" y="0" width="' + colW.toFixed(1) + '" height="' + H + '" fill="transparent"/>' + mark +
        '<text class="day' + (d.date === sleepSel ? ' today' : '') + '" x="' + X(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(lab) + '</text></g>';
    }).join('');
    var head = '<div class="row between"><span class="label">Sleep · last 7 days</span>' +
      (avg !== null ? '<span class="small"><span class="muted">Avg</span> <strong class="num">' + fmtW(Math.round(avg * 10) / 10) + ' h</strong><span class="muted"> · ' + pts.length + ' night' + (pts.length === 1 ? '' : 's') + '</span></span>' : '') + '</div>';
    var svg = '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Hours of sleep each night, last 7 days">' + g.join('') + cols + '</svg></div>';
    var dayName = sel.date === today ? 'last night' : 'the night before ' + fmtDate(sel.date, true);
    var form = '<div class="field"><label class="label" for="sleepHours">Hours slept ' + esc(dayName) + '</label>' +
      '<div class="row"><div class="unit-input grow"><input class="input num" id="sleepHours" inputmode="decimal" enterkeyhint="done" placeholder="e.g. 7.5" value="' + (sel.hours !== null ? fmtW(sel.hours) : '') + '"><span class="muted">hrs</span></div>' +
      '<button class="btn primary" data-act="saveSleep">' + (sel.hours !== null ? 'Update' : 'Save') + '</button></div>' +
      '<span class="small muted">' + (sel.workouts.length ? 'Before ' + esc(sel.workouts.join(', ')) + '. ' : '') + 'Tap a day on the graph to log or change it.</span></div>';
    return '<div class="card sleep-card">' + head + svg + form + '</div>';
  }

  // ---------- views ----------
  var VIEWS = {};

  VIEWS.train = function () {
    var parts = [];
    if (db.example) {
      parts.push('<div class="banner"><p>These are example workouts so you can see how suggestions work. Clear them when you’re ready to add your own.</p>' +
        '<button class="btn sm danger" data-act="clearExamples" data-confirm="Tap again to clear">Clear examples</button></div>');
    }
    if (draft && draftHasData(draft) && wById(draft.workoutId)) {
      parts.push('<div class="card"><div class="row between"><div class="stack"><span class="label">Unsaved session</span><h3>' + esc(wById(draft.workoutId).name) + ' · ' + esc(fmtDate(draft.date)) + '</h3></div></div>' +
        '<div class="btnrow"><button class="btn primary sm" data-act="start" data-id="' + esc(draft.workoutId) + '">Resume</button>' +
        '<button class="btn sm danger" data-act="discardDraft" data-confirm="Tap again to discard">Discard</button></div></div>');
    }
    parts.push(sleepCard());
    parts.push('<div class="section-head"><span class="label">Workouts</span><button class="btn ghost sm" data-act="newWorkout">+ New workout</button></div>');
    if (!db.workouts.length) {
      parts.push('<div class="card empty"><h3>No workouts yet</h3><p class="muted">Make a workout, then add exercises from your library. Each exercise keeps one history, wherever you log it.</p><button class="btn primary" data-act="newWorkout">Create a workout</button></div>');
    }
    db.workouts.forEach(function (w) {
      var ld = lastDone(w.id);
      var rows = w.slots.map(function (sl) {
        var pick = defaultPick(w, sl); var ex = pick && exById(pick); if (!ex) return '';
        var s = suggestionFor(ex);
        var more = sl.options.length > 1 ? ' <span class="muted">(+' + (sl.options.length - 1) + ')</span>' : '';
        var meta = repsLine(s);
        return '<div class="wrow"><span class="stack grow" style="gap:0"><span>' + (sl.name ? '<span class="muted">' + esc(sl.name) + ' · </span>' : '') + esc(ex.name) + more + '</span>' +
          (meta ? '<span class="small muted num">' + esc(meta) + '</span>' : '') + '</span>' +
          '<span class="num wnum">' + (s.weight !== null && s.weight !== undefined ? fmtW(s.weight) + (s.targetReps ? ' × ' + fmtW(s.targetReps) : '') : '–') + '</span>' + statusChip(s) + '</div>';
      }).join('');
      parts.push('<button class="card tap" data-act="start" data-id="' + esc(w.id) + '">' +
        '<div class="row between"><h2 class="grow">' + esc(w.name || 'Untitled workout') + '</h2><span class="small muted">' + (ld ? 'Last ' + esc(fmtDate(ld)) : 'Not logged yet') + '</span></div>' +
        (w.description ? '<p class="small muted">' + esc(w.description) + '</p>' : '') +
        (rows ? '<div class="stack">' + rows + '</div>' : '<p class="small muted">No exercises yet. Tap to add some.</p>') + '</button>');
    });
    return { title: 'Top Set', body: parts.join('') };
  };

  function curDraft() { return view.edit ? editDraft : draft; }
  function backoffCount() { return Math.max(0, Math.round(Number(db.settings.backoffSets)) || 0); }

  function newDraft(w) {
    var n = backoffCount();
    return {
      sessionId: null, workoutId: w.id, date: todayISO(), note: '', sleep: '', sleepTouched: false,
      entries: w.slots.map(function (sl) {
        var x = defaultPick(w, sl); var ex = x && exById(x); if (!ex) return null;
        return { slotId: sl.id, exerciseId: ex.id, sets: defaultSets(ex, n) };
      }).filter(Boolean)
    };
  }
  function defaultSets(ex, n) {
    var s = suggestionFor(ex);
    var sets = [{ kind: 'top', weight: s.weight === null || s.weight === undefined ? '' : s.weight, reps: '' }];
    for (var i = 0; i < n; i++) sets.push({ kind: 'backoff', weight: s.backoff ? s.backoff.weight : '', reps: '' });
    return sets;
  }
  function reconcileDraft(d, w) {
    // Keep a draft in step with the workout's groups (groups or exercises added while drafting).
    var n = backoffCount(), bySlot = {}, out = [];
    d.entries.forEach(function (e) { if (e.slotId) bySlot[e.slotId] = e; });
    w.slots.forEach(function (sl) {
      var ids = sl.options.map(function (o) { return o.exerciseId; }).filter(exById);
      if (!ids.length) return;
      var e = bySlot[sl.id];
      if (!e) { var x = defaultPick(w, sl); e = { slotId: sl.id, exerciseId: x, sets: defaultSets(exById(x), n) }; }
      else if (ids.indexOf(e.exerciseId) < 0) { e.exerciseId = defaultPick(w, sl); e.sets = defaultSets(exById(e.exerciseId), n); }
      if (e.stash) Object.keys(e.stash).forEach(function (id) { if (ids.indexOf(id) < 0) delete e.stash[id]; });
      out.push(e);
    });
    d.entries.forEach(function (e) { if (!e.slotId && exById(e.exerciseId)) out.push(e); });
    d.entries = out;
  }

  VIEWS.session = function () {
    var d = curDraft();
    if (!d) { view = { name: 'train' }; stack = []; return VIEWS.train(); }
    var w = wById(d.workoutId);
    var editing = !!view.edit;
    if (w && !editing) reconcileDraft(d, w);
    var u = unit();
    var parts = [];
    parts.push('<div class="card"><div class="grid2"><div class="field"><label class="label" for="sdate">Date</label><input class="input num" id="sdate" type="date" value="' + esc(d.date) + '" data-bind="date"></div>' +
      '<div class="field"><label class="label" for="ssleep">Sleep last night</label><div class="unit-input"><input class="input num" id="ssleep" inputmode="decimal" placeholder="e.g. 7.5" value="' + esc(d.sleepTouched ? d.sleep : (sleepFor(d.date) !== null ? fmtW(sleepFor(d.date)) : '')) + '" data-bind="sleep"><span class="muted">hrs</span></div></div></div>' +
      (w && w.description ? '<p class="small muted">' + esc(w.description) + '</p>' : '') + '</div>');
    if (editing) parts.push('<div class="banner"><p>Editing a logged session. Changes update each exercise’s history and suggestions.</p></div>');
    if (!d.entries.length) {
      parts.push('<div class="card empty"><h3>No exercises in this workout</h3><p class="muted">Add exercises from your library to start logging.</p>' +
        (w ? '<button class="btn primary" data-act="editWorkout" data-id="' + esc(w.id) + '">Add exercises</button>' : '') + '</div>');
    }
    d.entries.forEach(function (en, ei) {
      var ex = exById(en.exerciseId); if (!ex) return;
      var s = suggestionFor(ex);
      var sl = slotById(w, en.slotId);
      var opt = sl ? sl.options.filter(function (o) { return o.exerciseId === ex.id; })[0] : null;
      var prev = s.hist.filter(function (h) { return h.sessionId !== d.sessionId; });
      var last = prev[prev.length - 1];
      var lastW = last ? wById(last.workoutId) : null;
      var picker = '';
      if (!editing && sl && sl.options.length > 1) {
        var others = sl.options.filter(function (o) { return o.exerciseId !== ex.id && hasReps(en.stash && en.stash[o.exerciseId]); }).length;
        picker = '<div class="picker" role="group" aria-label="Pick the exercise for ' + esc(sl.name || 'this group') + '">' + sl.options.map(function (o) {
          var oe = exById(o.exerciseId); if (!oe) return '';
          var filled = oe.id === ex.id ? hasReps(en.sets) : hasReps(en.stash && en.stash[oe.id]);
          return '<button class="pick' + (filled ? ' filled' : '') + '" aria-pressed="' + (oe.id === ex.id) + '" data-act="pickOpt" data-e="' + ei + '" data-x="' + esc(oe.id) + '"' +
            (filled ? ' aria-label="' + esc(oe.name) + ', sets entered"' : '') + '>' + esc(oe.name) + (filled ? '<span class="pick-dot" aria-hidden="true">✓</span>' : '') + '</button>';
        }).join('') + '</div>' + (others ? '<p class="small muted">✓ = sets entered. Every exercise with a ✓ gets saved.</p>' : '');
      }
      var setsHTML = en.sets.map(function (st, si) {
        var bo = 0; for (var q = 0; q <= si; q++) if (en.sets[q].kind !== 'top') bo++;
        var tag = st.kind === 'top' ? '<span class="tag top">Top</span>' : '<span class="tag">B' + bo + '</span>';
        var ph = st.kind === 'top' && s.targetReps && !editing ? String(s.targetReps) : '';
        return '<div class="set">' + tag +
          '<input class="input" id="w-' + ei + '-' + si + '" inputmode="decimal" enterkeyhint="next" aria-label="' + esc(ex.name) + ' set ' + (si + 1) + ' weight" value="' + esc(st.weight) + '" data-bind="set" data-e="' + ei + '" data-s="' + si + '" data-f="weight">' +
          '<span class="times">×</span>' +
          '<input class="input" id="r-' + ei + '-' + si + '" inputmode="decimal" enterkeyhint="next" aria-label="' + esc(ex.name) + ' set ' + (si + 1) + ' reps" placeholder="' + esc(ph) + '" value="' + esc(st.reps) + '" data-bind="set" data-e="' + ei + '" data-s="' + si + '" data-f="reps">' +
          '<button class="del" aria-label="Remove set" data-act="delSet" data-e="' + ei + '" data-s="' + si + '">' + I.x + '</button></div>';
      }).join('');
      parts.push('<section class="card" aria-label="' + esc(ex.name) + '">' +
        (sl && sl.name ? '<span class="label">' + (w.slots.indexOf(sl) + 1) + ' · ' + esc(sl.name) + '</span>' : '') + picker +
        '<div class="row between"><h3 class="grow">' + esc(ex.name) + '</h3>' + (editing ? '' : statusChip(s)) + '</div>' +
        (ex.notes ? '<p class="small muted">' + esc(ex.notes) + '</p>' : '') +
        (editing ? '' : suggestionBlock(ex, s)) +
        (last ? '<p class="small"><span class="muted">Last · ' + esc(fmtDate(last.date)) + (lastW ? ', ' + esc(lastW.name) : '') + ':</span> <span class="num">' + esc(setsString(last.sets)) + '</span></p>' : '') +
        '<div class="sets"><div class="set-head label"><span></span><span>' + u + '</span><span></span><span>Reps</span><span></span></div>' + setsHTML + '</div>' +
        '<div class="btnrow"><button class="btn sm" data-act="addSet" data-e="' + ei + '">+ Back-off set</button>' +
        (en.sets.some(function (x) { return x.kind === 'top'; }) ? '' : '<button class="btn sm" data-act="addTop" data-e="' + ei + '">+ Top set</button>') + '</div>' +
        (opt ? '<div class="field"><label class="label" for="inote-' + ei + '">Note for this workout</label><textarea class="input" id="inote-' + ei + '" rows="2" placeholder="e.g. paused reps, burnout set" data-bind="itemNote" data-w="' + esc(w.id) + '" data-sl="' + esc(sl.id) + '" data-x="' + esc(ex.id) + '">' + esc(opt.note) + '</textarea></div>' : '') +
        '</section>');
    });
    parts.push('<div class="card"><div class="field"><label class="label" for="snote">Session notes</label><textarea class="input" id="snote" rows="3" placeholder="Food, stress, how it felt" data-bind="snote">' + esc(d.note) + '</textarea></div></div>');
    var bar = '<button class="btn primary block" data-act="saveSession">' + (editing ? 'Save changes' : 'Save session') + '</button>';
    if (editing) bar = '<button class="btn danger" data-act="deleteSession" data-confirm="Tap again">Delete</button>' + bar;
    var actions = w ? '<button class="iconbtn" data-act="editWorkout" data-id="' + esc(w.id) + '" aria-label="Edit workout">' + I.edit + '</button>' : '';
    return { title: editing ? 'Edit · ' + fmtDate(d.date) : (w ? w.name : 'Session'), back: true, actions: actions, body: parts.join(''), savebar: bar };
  };

  VIEWS.workoutEdit = function () {
    var w = wById(view.id);
    if (!w) { return { title: 'Workout', back: true, body: '<div class="card empty"><p>This workout no longer exists.</p></div>' }; }
    var parts = [];
    parts.push('<div class="card"><div class="field"><label class="label" for="wname">Name</label><input class="input" id="wname" value="' + esc(w.name) + '" placeholder="e.g. Upper (Push Focus)" data-bind="wField" data-k="name"></div>' +
      '<div class="field"><label class="label" for="wdesc">Description</label><textarea class="input" id="wdesc" rows="3" placeholder="Focus, rest times, warm-up" data-bind="wField" data-k="description">' + esc(w.description) + '</textarea></div></div>');
    parts.push('<p class="small muted">Each group is one movement you hit, like Chest or Hinge. Put every exercise you might do for it in the group, and pick one each session.</p>');
    var lib = db.exercises.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    w.slots.forEach(function (sl, i) {
      var gname = sl.name || 'group ' + (i + 1);
      var opts = sl.options.map(function (o, oi) {
        var ex = exById(o.exerciseId); if (!ex) return '';
        return '<div class="opt"><div class="row"><strong class="grow">' + esc(ex.name) + '</strong><button class="del" aria-label="Remove ' + esc(ex.name) + ' from ' + esc(gname) + '" data-act="optRemove" data-i="' + i + '" data-o="' + oi + '">' + I.x + '</button></div>' +
          '<input class="input" id="onote-' + i + '-' + oi + '" aria-label="Note for ' + esc(ex.name) + ' in this workout" placeholder="Note for this workout (optional)" value="' + esc(o.note) + '" data-bind="optNote" data-i="' + i + '" data-o="' + oi + '"></div>';
      }).join('');
      var inSlot = {}; sl.options.forEach(function (o) { inSlot[o.exerciseId] = true; });
      var avail = lib.filter(function (e) { return !inSlot[e.id]; });
      parts.push('<section class="card" aria-label="' + esc(gname) + '">' +
        '<div class="row"><span class="slotnum num">' + (i + 1) + '</span><input class="input grow" id="sname-' + i + '" aria-label="Group name" placeholder="Group, e.g. Chest" value="' + esc(sl.name) + '" data-bind="slotName" data-i="' + i + '">' +
        '<button class="ordbtn" aria-label="Move ' + esc(gname) + ' up" data-act="wUp" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>' + I.up + '</button>' +
        '<button class="ordbtn" aria-label="Move ' + esc(gname) + ' down" data-act="wDown" data-i="' + i + '"' + (i === w.slots.length - 1 ? ' disabled' : '') + '>' + I.down + '</button></div>' +
        (opts ? '<div class="stack" style="gap:10px">' + opts + '</div>' : '<p class="small muted">No exercises in this group yet.</p>') +
        '<details' + (sl.options.length ? '' : ' open') + '><summary class="btn ghost sm" style="padding-left:0">+ Add exercise to ' + esc(gname) + '</summary><div class="stack" style="margin-top:8px;gap:8px">' +
        (avail.length ? '<div class="row"><select class="input grow" id="sadd-' + i + '" aria-label="Exercise from library">' + avail.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>'; }).join('') + '</select><button class="btn sm" data-act="optAdd" data-i="' + i + '">Add</button></div>' : '') +
        '<div class="row"><input class="input grow" id="snew-' + i + '" aria-label="New exercise name" placeholder="Or a new exercise name" enterkeyhint="done"><button class="btn sm" data-act="optCreate" data-i="' + i + '">Create</button></div></div></details>' +
        '<div class="btnrow"><button class="btn ghost sm danger" style="padding-left:0" data-act="slotRemove" data-i="' + i + '" data-confirm="Tap again to remove">Remove group</button></div>' +
        '</section>');
    });
    parts.push('<button class="btn block" data-act="addSlot">+ Add group</button>');
    parts.push('<div class="btnrow" style="padding-top:12px"><button class="btn danger" data-act="deleteWorkout" data-confirm="Tap again to delete">Delete workout</button></div>' +
      '<p class="small muted">Deleting a workout or group keeps every exercise and its logged history.</p>');
    return { title: w.name || 'New workout', back: true, body: parts.join(''), savebar: '<button class="btn primary block" data-act="back">Done</button>' };
  };

  VIEWS.exercises = function () {
    var parts = [];
    parts.push('<div class="card"><label class="label" for="newex">Add an exercise</label><div class="row"><input class="input grow" id="newex" placeholder="e.g. Incline bench press" enterkeyhint="done"><button class="btn primary" data-act="addEx">Add</button></div></div>');
    if (!db.exercises.length) {
      parts.push('<div class="card empty"><h3>Your library is empty</h3><p class="muted">Add the exercises you like doing at your gym. Then mix them into workouts.</p></div>');
    }
    var list = db.exercises.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    list.forEach(function (ex) {
      var s = suggestionFor(ex);
      var used = usedIn(ex.id).map(function (w) { return w.name; });
      parts.push('<button class="card tap" data-act="openEx" data-id="' + esc(ex.id) + '"><div class="ex-row">' +
        '<div class="stack grow"><h3>' + esc(ex.name) + '</h3><span class="small muted">' + (used.length ? esc(used.join(', ')) : 'Not in a workout') + ' · ' + s.hist.length + ' logged</span></div>' +
        sparkSVG(s.hist) +
        '<div class="stack" style="align-items:flex-end"><span class="weight-mini num">' + (s.weight !== null && s.weight !== undefined ? fmtW(s.weight) : '–') + '</span>' + statusChip(s) + '</div></div></button>');
    });
    return { title: 'Exercises', body: parts.join('') };
  };

  VIEWS.exercise = function () {
    var ex = exById(view.id);
    if (!ex) return { title: 'Exercise', back: true, body: '<div class="card empty"><p>This exercise was deleted.</p></div>' };
    var s = suggestionFor(ex);
    var used = usedIn(ex.id);
    var u = unit();
    var parts = [];
    parts.push('<div class="card"><div class="row between"><span class="label">Next time</span>' + statusChip(s) + '</div>' + suggestionBlock(ex, s) +
      (s.trend ? '<p class="small"><span class="muted">Rolling avg est. max (last ' + esc(db.settings.windowSessions) + ' sessions):</span> <strong class="num">' + fmtW(Math.round(s.trend)) + ' ' + u + '</strong></p>' : '') +
      (s.runLength ? '<p class="small"><span class="muted">At ' + fmtW(s.lastTop.weight) + ' ' + u + ':</span> <span class="num">' + s.runLength + ' session' + (s.runLength > 1 ? 's' : '') + ', avg ' + P.fmt1(s.runAvg) + ' reps (last ' + Math.min(s.runLength, Number(db.settings.graceSessions) || 3) + ')</span></p>' : '') +
      '<p class="small muted">Used in: ' + (used.length ? esc(used.map(function (w) { return w.name; }).join(', ')) : 'no workouts yet') + '</p></div>');
    parts.push('<div class="card"><span class="label">Progress</span>' + chartSVG(s.hist) + '</div>');
    var rows = s.hist.slice().reverse().map(function (h) {
      var w = wById(h.workoutId);
      return '<button class="hist-row" style="background:none;border-left:0;border-right:0;border-bottom:0;width:100%;text-align:left;color:inherit" data-act="editSession" data-id="' + esc(h.sessionId) + '">' +
        '<span class="hist-date">' + esc(fmtDate(h.date)) + '</span><span class="stack grow"><span class="hist-sets">' + esc(setsString(h.sets)) + '</span><span class="small muted">' + esc(w ? w.name : 'Deleted workout') + (sleepOf(h.sessionId) !== null ? ' · ' + fmtW(sleepOf(h.sessionId)) + ' h sleep' : '') + ' · est. max ' + fmtW(Math.round(h.e1rm)) + '</span></span>' + I.edit.replace('aria-hidden', 'width="18" height="18" aria-hidden') + '</button>';
    }).join('');
    parts.push('<div class="card"><span class="label">History</span>' + (rows ? '<div class="hist">' + rows + '</div>' : '<p class="small muted">Nothing logged yet.</p>') + '</div>');
    parts.push('<div class="card"><span class="label">Details</span>' +
      '<div class="field"><label class="label" for="exname">Name</label><input class="input" id="exname" value="' + esc(ex.name) + '" data-bind="exField" data-k="name"></div>' +
      '<div class="field"><label class="label" for="exnotes">Description</label><textarea class="input" id="exnotes" rows="3" placeholder="Cues, setup, machine settings" data-bind="exField" data-k="notes">' + esc(ex.notes) + '</textarea></div>' +
      '<div class="grid2"><div class="field"><label class="label" for="exeq">Equipment</label><select class="input" id="exeq" data-bind="exField" data-k="equipment">' +
      ['barbell', 'smith', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other'].map(function (o) { return '<option value="' + o + '"' + (ex.equipment === o ? ' selected' : '') + '>' + (o === 'smith' ? 'Smith machine' : o.charAt(0).toUpperCase() + o.slice(1)) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label class="label" for="exinc">Jump (' + u + ')</label><input class="input num" id="exinc" inputmode="decimal" placeholder="' + esc(db.settings.increment) + ' (default)" value="' + esc(ex.increment) + '" data-bind="exField" data-k="increment"></div></div>' +
      '<div class="field"><label class="label" for="exstart">Starting weight (' + u + ')</label><input class="input num" id="exstart" inputmode="decimal" placeholder="Used until you log it" value="' + esc(ex.startWeight) + '" data-bind="exField" data-k="startWeight"></div>' +
      '</div>');
    parts.push('<div class="btnrow"><button class="btn danger" data-act="deleteEx" data-confirm="Tap again to delete">Delete exercise</button></div>' +
      '<p class="small muted">Deleting removes it from every workout and erases its logged sets.</p>');
    return { title: ex.name || 'Exercise', back: true, body: parts.join('') };
  };

  VIEWS.settings = function () {
    var st = db.settings, u = unit();
    function num(k, label, help, val, extra) {
      return '<div class="field"><label class="label" for="set-' + k + '">' + label + '</label><input class="input num" id="set-' + k + '" inputmode="decimal" value="' + esc(val !== undefined ? val : st[k]) + '" data-bind="setting" data-k="' + k + '"' + (extra || '') + '><span class="small muted">' + help + '</span></div>';
    }
    var parts = [];
    parts.push('<div class="card"><span class="label">Progression rules</span>' +
      num('moveUpReps', 'Move up at (reps)', 'One top set with this many reps or more moves the weight up next time.') +
      num('increment', 'Weight jump (' + u + ')', 'Default jump. Each exercise can override it.') +
      num('graceSessions', 'Sessions before dropping', 'After a jump, the weight stays put for this many sessions.') +
      num('floorReps', 'Rep floor', 'If the average top-set reps over those sessions is below this, drop back.') +
      num('startReps', 'Reps at a new weight', 'What to aim for the first time at a heavier weight. After that, the target is your most recent reps at that weight.') +
      num('windowSessions', 'Rolling window (sessions)', 'How many recent sessions the strength trend on each exercise’s chart averages over.') +
      '</div>');
    parts.push('<div class="card"><span class="label">Back-off sets</span><div class="grid2">' +
      num('backoffPct', 'Back-off %', 'Of the top set weight.', Math.round(Number(st.backoffPct) * 100)) +
      num('backoffSets', 'Back-off sets', 'Pre-filled when you start a session.') + '</div></div>');
    parts.push('<div class="card"><span class="label">Units and bar</span><div class="grid2">' +
      '<div class="field"><label class="label" for="set-unit">Units</label><select class="input" id="set-unit" data-bind="setting" data-k="unit"><option value="lb"' + (u === 'lb' ? ' selected' : '') + '>lb</option><option value="kg"' + (u === 'kg' ? ' selected' : '') + '>kg</option></select></div>' +
      num('barWeight', 'Bar weight', 'Used for the plates-per-side picture.') + '</div>' +
      '<p class="small muted">Changing units relabels numbers. It doesn’t convert logged weights.</p></div>');
    var imp = '';
    if (pendingImport) {
      imp = '<div class="banner"><p>Backup ready: ' + pendingImport.exercises.length + ' exercises, ' + pendingImport.workouts.length + ' workouts, ' + pendingImport.sessions.length + ' sessions. This replaces everything on this phone.</p>' +
        '<div class="btnrow"><button class="btn sm danger" data-act="applyImport" data-confirm="Tap again to replace">Replace my data</button><button class="btn sm" data-act="cancelImport">Cancel</button></div></div>';
    }
    parts.push('<div class="card"><span class="label">Backup</span>' +
      '<p class="small">Your data lives only on this phone. Save a backup now and then, and before changing phones.' + (db.lastExport ? ' Last backup: ' + esc(fmtDate(db.lastExport)) + '.' : ' No backup yet.') + '</p>' +
      '<div class="btnrow"><button class="btn primary sm" data-act="exportFile">Save backup file</button><button class="btn sm" data-act="copyBackup">Copy backup text</button></div>' +
      '<div class="field"><label class="label" for="importfile">Restore from a backup file</label><input class="input" id="importfile" type="file" accept="application/json,.json" data-bind="importFile"></div>' +
      '<details><summary class="btn ghost sm" style="padding-left:0">Restore from pasted text</summary><div class="stack" style="margin-top:8px"><textarea class="input" id="pastebox" rows="4" placeholder="Paste backup text here"></textarea><button class="btn sm" data-act="readPaste">Check backup</button></div></details>' +
      imp + '<div id="copyOut"></div></div>');
    parts.push('<div class="card"><span class="label">Reset</span><p class="small muted">Erase every exercise, workout and session on this phone.</p><div class="btnrow"><button class="btn danger sm" data-act="eraseAll" data-confirm="Tap again to erase">Erase all data</button>' +
      (db.example ? '' : '<button class="btn sm" data-act="loadExamples" data-confirm="Tap again to replace">Load example data</button>') + '</div></div>');
    parts.push('<p class="small muted" style="text-align:center">Top Set ' + APP_VERSION + ' · open source · works offline</p>');
    return { title: 'Settings', body: parts.join('') };
  };

  // ---------- render ----------
  var TABS = [['train', 'Train', I.train], ['exercises', 'Exercises', I.list], ['settings', 'Settings', I.settings]];
  function tabOf(name) { return name === 'exercises' || name === 'exercise' ? 'exercises' : name === 'settings' ? 'settings' : 'train'; }

  function render() {
    var v = (VIEWS[view.name] || VIEWS.train)();
    $('#topInner').innerHTML = (v.back ? '<button class="iconbtn" data-act="back" aria-label="Back">' + I.back + '</button>' : '') +
      '<h1' + (String(v.title).length > 16 ? ' class="long"' : '') + '>' + esc(v.title) + '</h1>' + (v.actions || '');
    $('#app').innerHTML = v.body;
    $('#savebar').innerHTML = v.savebar ? '<div class="savebar"><div class="inner">' + v.savebar + '</div></div>' : '';
    var cur = tabOf(view.name);
    $('#tabs').innerHTML = TABS.map(function (t) {
      return '<button class="tab" data-act="tab" data-tab="' + t[0] + '"' + (cur === t[0] ? ' aria-current="page"' : '') + '>' + t[2] + '<span>' + t[1] + '</span></button>';
    }).join('');
  }
  // Use browser history (so the phone's back gesture works) only when running as its own page.
  var useHistory = (function () { try { return window.self === window.top && !!history.pushState; } catch (e) { return false; } })();
  var pushed = 0;
  function go(next) {
    stack.push(view);
    view = next;
    if (useHistory) { try { history.pushState({ d: stack.length }, ''); pushed++; } catch (e) { /* ignore */ } }
    render(); window.scrollTo(0, 0);
  }
  function back() {
    if (view.name === 'session' && view.edit) editDraft = null;
    view = stack.pop() || { name: 'train' };
    render(); window.scrollTo(0, 0);
  }
  function goTab(name) { stack = []; editDraft = null; view = { name: name }; render(); window.scrollTo(0, 0); }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  // ---------- actions ----------
  function startWorkout(id) {
    var w = wById(id); if (!w) return;
    if (draft && draft.workoutId === id && !draft.sessionId) {
      if (draftHasData(draft)) toast('Picked up where you left off.');
    } else {
      if (draft && draftHasData(draft) && wById(draft.workoutId)) toast('Discarded the unsaved ' + wById(draft.workoutId).name + ' session.');
      draft = newDraft(w);
      saveDraftSoon();
    }
    go({ name: 'session' });
  }

  function hasReps(sets) { return (sets || []).some(function (x) { return Number(x.reps) > 0; }); }
  // Every exercise in a group that has reps entered gets saved, not just the one showing.
  function expandEntries(d) {
    var out = [];
    d.entries.forEach(function (e) {
      out.push({ slotId: e.slotId, exerciseId: e.exerciseId, sets: e.sets });
      var stash = e.stash || {};
      var w = wById(d.workoutId), sl = slotById(w, e.slotId);
      var order = sl ? sl.options.map(function (o) { return o.exerciseId; }) : [];
      Object.keys(stash).sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); }).forEach(function (id) {
        if (id !== e.exerciseId && exById(id) && hasReps(stash[id])) out.push({ slotId: e.slotId, exerciseId: id, sets: stash[id] });
      });
    });
    return out;
  }
  function cleanEntries(d) {
    return expandEntries(d).map(function (e) {
      return {
        slotId: e.slotId || null,
        exerciseId: e.exerciseId,
        sets: e.sets.filter(function (s) { return Number(s.reps) > 0; }).map(function (s) {
          var w = Number(s.weight);
          return { kind: s.kind, weight: isFinite(w) && w >= 0 ? w : 0, reps: Math.round(Number(s.reps) * 2) / 2 };
        })
      };
    }).filter(function (e) { return e.sets.length; });
  }

  function applyDraftSleep(d) {
    if (!d.sleepTouched) return;
    var h = parseSleep(d.sleep);
    if (h !== null) db.sleep[d.date] = h;
    else if (String(d.sleep || '').trim() === '') delete db.sleep[d.date];
  }

  function saveSession() {
    var d = curDraft();
    var entries = cleanEntries(d);
    if (!entries.length) { toast('Enter reps for at least one set, then save.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) d.date = todayISO();
    if (view.edit) {
      var s = sessById(d.sessionId);
      if (s) { s.date = d.date; s.note = d.note; s.entries = entries; }
      applyDraftSleep(d);
      persist(); editDraft = null;
      toast('Changes saved.');
      back();
      return;
    }
    var same = db.sessions.filter(function (x) { return x.workoutId === d.workoutId && x.date === d.date; })[0];
    if (same) {
      // Already saved this workout today: add to that session instead of starting a second one.
      same.entries = same.entries.concat(entries);
      if (d.note && d.note !== same.note) same.note = same.note ? same.note + ' / ' + d.note : d.note;
      same.createdAt = Date.now();
    } else {
      db.sessions.push({ id: uid(), date: d.date, createdAt: Date.now(), workoutId: d.workoutId, note: d.note, entries: entries });
    }
    applyDraftSleep(d);
    persist(); clearDraft();
    var notes = entries.map(function (e) {
      var ex = exById(e.exerciseId); var s = suggestionFor(ex);
      if (s.status === 'up') return ex.name + ' up to ' + fmtW(s.weight);
      if (s.status === 'drop') return ex.name + ' back to ' + fmtW(s.weight);
      return null;
    }).filter(Boolean);
    toast(notes.length ? 'Saved. Next time: ' + notes.join(', ') + '.' : 'Session saved.');
    goTab('train');
  }

  function shareOrDownload(text, name) {
    var blob = new Blob([text], { type: 'application/json' });
    try {
      var file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: name }).then(function () { return true; }).catch(function (e) { return e && e.name === 'AbortError' ? false : download(); });
      }
    } catch (e) { /* fall back */ }
    return Promise.resolve(download());
    function download() {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      return true;
    }
  }

  function readBackupText(text) {
    try {
      var d = JSON.parse(text);
      if (!looksLikeBackup(d)) throw new Error('shape');
      pendingImport = normalize(d);
    } catch (e) {
      pendingImport = null;
      toast('That isn’t a Top Set backup. Check you picked the right file or copied all of the text.');
    }
    render();
  }

  function moveItem(i, dir) {
    var w = wById(view.id); var j = i + dir;
    if (!w || j < 0 || j >= w.slots.length) return;
    var t = w.slots[i]; w.slots[i] = w.slots[j]; w.slots[j] = t;
    persist(); render();
  }

  function createExercise(name) {
    name = String(name || '').trim();
    if (!name) { toast('Type a name for the exercise first.'); return null; }
    var dup = db.exercises.filter(function (e) { return e.name.toLowerCase() === name.toLowerCase(); })[0];
    if (dup) return dup;
    var ex = { id: uid(), name: name, notes: '', equipment: 'barbell', increment: '', startWeight: '' };
    db.exercises.push(ex); persist();
    return ex;
  }

  var ACTIONS = {
    tab: function (b) { goTab(b.dataset.tab); },
    back: function () {
      if (useHistory && pushed > 0 && stack.length) history.back(); else back();
    },
    start: function (b) { startWorkout(b.dataset.id); },
    discardDraft: function () { clearDraft(); render(); toast('Unsaved session discarded.'); },
    addSet: function (b) {
      var d = curDraft(); var en = d.entries[+b.dataset.e]; if (!en) return;
      var ex = exById(en.exerciseId); var s = suggestionFor(ex);
      var lastBo = en.sets.filter(function (x) { return x.kind !== 'top'; }).pop();
      var top = en.sets.filter(function (x) { return x.kind === 'top'; })[0];
      var inc = Number(ex.increment) > 0 ? Number(ex.increment) : Number(db.settings.increment) || 5;
      var wgt = lastBo ? lastBo.weight : (top && top.weight !== '' ? P.roundTo(Number(top.weight) * Number(db.settings.backoffPct || 0.7), inc) : (s.backoff ? s.backoff.weight : ''));
      en.sets.push({ kind: 'backoff', weight: wgt, reps: '' });
      saveDraftSoon(); render();
    },
    addTop: function (b) {
      var d = curDraft(); var en = d.entries[+b.dataset.e]; if (!en) return;
      var s = suggestionFor(exById(en.exerciseId));
      en.sets.unshift({ kind: 'top', weight: s.weight === null || s.weight === undefined ? '' : s.weight, reps: '' });
      saveDraftSoon(); render();
    },
    delSet: function (b) {
      var d = curDraft(); var en = d.entries[+b.dataset.e]; if (!en) return;
      en.sets.splice(+b.dataset.s, 1);
      saveDraftSoon(); render();
    },
    saveSession: saveSession,
    deleteSession: function () {
      var id = editDraft && editDraft.sessionId;
      db.sessions = db.sessions.filter(function (s) { return s.id !== id; });
      persist(); editDraft = null; toast('Session deleted.'); back();
    },
    editSession: function (b) {
      var s = sessById(b.dataset.id); if (!s) return;
      editDraft = {
        sessionId: s.id, workoutId: s.workoutId, date: s.date, note: s.note || '', sleep: '', sleepTouched: false,
        entries: s.entries.map(function (e) { return { slotId: e.slotId || null, exerciseId: e.exerciseId, sets: e.sets.map(function (x) { return { kind: x.kind || 'work', weight: x.weight, reps: x.reps }; }) }; })
      };
      go({ name: 'session', edit: s.id });
    },
    editWorkout: function (b) { go({ name: 'workoutEdit', id: b.dataset.id }); },
    newWorkout: function () {
      var w = { id: uid(), name: 'Workout ' + (db.workouts.length + 1), description: '', items: [] };
      db.workouts.push(w); persist();
      go({ name: 'workoutEdit', id: w.id });
      var el = $('#wname'); if (el) { el.focus(); el.select(); }
    },
    wUp: function (b) { moveItem(+b.dataset.i, -1); },
    wDown: function (b) { moveItem(+b.dataset.i, 1); },
    slotRemove: function (b) { var w = wById(view.id); if (!w) return; w.slots.splice(+b.dataset.i, 1); persist(); render(); },
    addSlot: function () {
      var w = wById(view.id); if (!w) return;
      w.slots.push({ id: uid(), name: '', options: [] }); persist(); render();
      var el = document.getElementById('sname-' + (w.slots.length - 1)); if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); }
    },
    optRemove: function (b) { var w = wById(view.id); var sl = w && w.slots[+b.dataset.i]; if (!sl) return; sl.options.splice(+b.dataset.o, 1); persist(); render(); },
    optAdd: function (b) {
      var w = wById(view.id); var i = +b.dataset.i; var sl = w && w.slots[i]; var sel = document.getElementById('sadd-' + i);
      if (!sl || !sel || !sel.value) return;
      sl.options.push({ exerciseId: sel.value, note: '' }); persist(); render();
    },
    optCreate: function (b) {
      var w = wById(view.id); var i = +b.dataset.i; var sl = w && w.slots[i]; var inp = document.getElementById('snew-' + i);
      if (!sl || !inp) return;
      var ex = createExercise(inp.value); if (!ex) return;
      if (!sl.options.some(function (o) { return o.exerciseId === ex.id; })) sl.options.push({ exerciseId: ex.id, note: '' });
      persist(); render(); toast(ex.name + ' added to your library and this group.');
    },
    sleepDay: function (b) { sleepSel = b.getAttribute('data-date'); render(); var el = document.getElementById('sleepHours'); if (el) el.focus({ preventScroll: true }); },
    saveSleep: function () {
      var el = document.getElementById('sleepHours'); if (!el || !sleepSel) return;
      var raw = el.value.trim();
      if (raw === '') {
        if (db.sleep[sleepSel] !== undefined) { delete db.sleep[sleepSel]; persist(); render(); toast('Sleep entry removed.'); }
        else toast('Enter how many hours you slept, like 7.5.');
        return;
      }
      var h = parseSleep(raw);
      if (h === null) { toast('Enter hours between 0 and 24, like 7.5.'); return; }
      db.sleep[sleepSel] = h; persist(); render(); toast('Sleep saved.');
    },
    pickOpt: function (b) {
      var d = curDraft(); var en = d && d.entries[+b.dataset.e]; var ex = exById(b.dataset.x);
      if (!en || !ex || en.exerciseId === ex.id) return;
      // Keep what you typed for the exercise you're leaving, and bring back anything typed for the one you pick.
      en.stash = en.stash || {};
      en.stash[en.exerciseId] = en.sets;
      en.exerciseId = ex.id;
      en.sets = en.stash[ex.id] || defaultSets(ex, backoffCount());
      delete en.stash[ex.id];
      saveDraftSoon(); render();
    },
    deleteWorkout: function () {
      db.workouts = db.workouts.filter(function (w) { return w.id !== view.id; });
      if (draft && draft.workoutId === view.id) clearDraft();
      persist(); toast('Workout deleted. Exercise history kept.'); goTab('train');
    },
    openEx: function (b) { go({ name: 'exercise', id: b.dataset.id }); },
    addEx: function () {
      var inp = $('#newex'); if (!inp) return;
      var ex = createExercise(inp.value); if (!ex) return;
      go({ name: 'exercise', id: ex.id });
    },
    deleteEx: function () {
      var id = view.id;
      db.exercises = db.exercises.filter(function (e) { return e.id !== id; });
      db.workouts.forEach(function (w) { w.slots.forEach(function (sl) { sl.options = sl.options.filter(function (o) { return o.exerciseId !== id; }); }); });
      db.sessions.forEach(function (s) { s.entries = s.entries.filter(function (e) { return e.exerciseId !== id; }); });
      db.sessions = db.sessions.filter(function (s) { return s.entries.length; });
      if (draft) draft.entries = draft.entries.filter(function (e) { return e.exerciseId !== id; });
      persist(); toast('Exercise deleted.'); goTab('exercises');
    },
    clearExamples: function () { db = emptyDB(db.settings); clearDraft(); persist(); render(); toast('Examples cleared. Start by adding exercises or a workout.'); },
    loadExamples: function () { var s = db.settings; db = exampleDB(); db.settings = s; clearDraft(); persist(); goTab('train'); },
    eraseAll: function () { db = emptyDB(db.settings); clearDraft(); persist(); render(); toast('All data erased.'); },
    exportFile: function () {
      var name = 'top-set-backup-' + todayISO() + '.json';
      shareOrDownload(JSON.stringify(db, null, 2), name).then(function (ok) {
        if (!ok) return;
        db.lastExport = todayISO(); persist(); render();
        toast('Backup created. If no file appeared, use Copy backup text instead.');
      });
    },
    copyBackup: function () {
      var text = JSON.stringify(db);
      function fallback() {
        var out = $('#copyOut');
        if (out) {
          out.innerHTML = '<div class="field"><label class="label" for="copybox">Backup text — select all and copy</label><textarea class="input" id="copybox" rows="4" readonly></textarea></div>';
          var box = $('#copybox'); box.value = text; box.focus(); box.select();
        }
      }
      try {
        navigator.clipboard.writeText(text).then(function () {
          db.lastExport = todayISO(); persist(); toast('Backup copied. Paste it into a note or email to yourself.');
        }, fallback);
      } catch (e) { fallback(); }
    },
    readPaste: function () { var box = $('#pastebox'); readBackupText(box ? box.value : ''); },
    applyImport: function () {
      if (!pendingImport) return;
      db = pendingImport; pendingImport = null; clearDraft(); persist(); render(); toast('Backup restored.');
    },
    cancelImport: function () { pendingImport = null; render(); }
  };

  var BINDERS = {
    set: function (t) {
      var d = curDraft(); var en = d && d.entries[+t.dataset.e]; if (!en) return;
      var st = en.sets[+t.dataset.s]; if (!st) return;
      st[t.dataset.f] = t.value.replace(',', '.').trim();
      saveDraftSoon();
    },
    date: function (t) { curDraft().date = t.value; saveDraftSoon(); },
    snote: function (t) { curDraft().note = t.value; saveDraftSoon(); },
    sleep: function (t) { var d = curDraft(); d.sleep = t.value.replace(',', '.').trim(); d.sleepTouched = true; saveDraftSoon(); },
    itemNote: function (t) {
      var w = wById(t.dataset.w); if (!w) return;
      var sl = slotById(w, t.dataset.sl); if (!sl) return;
      sl.options.forEach(function (o) { if (o.exerciseId === t.dataset.x) o.note = t.value; });
      persistSoon();
    },
    wField: function (t) { var w = wById(view.id); if (!w) return; w[t.dataset.k] = t.value; persistSoon(); },
    slotName: function (t) { var w = wById(view.id); var sl = w && w.slots[+t.dataset.i]; if (!sl) return; sl.name = t.value; persistSoon(); },
    optNote: function (t) { var w = wById(view.id); var sl = w && w.slots[+t.dataset.i]; var o = sl && sl.options[+t.dataset.o]; if (!o) return; o.note = t.value; persistSoon(); },
    exField: function (t) {
      var ex = exById(view.id); if (!ex) return;
      var k = t.dataset.k, v = t.value;
      if (k === 'increment' || k === 'startWeight') { v = v.replace(',', '.').trim(); if (v !== '' && !(Number(v) >= 0)) return; }
      ex[k] = v; persistSoon();
    },
    setting: function (t) {
      var k = t.dataset.k, v = t.value;
      if (k === 'unit') { db.settings.unit = v; if (v === 'kg' && Number(db.settings.barWeight) === 45) db.settings.barWeight = 20; if (v === 'lb' && Number(db.settings.barWeight) === 20) db.settings.barWeight = 45; persistSoon(); return; }
      v = Number(String(v).replace(',', '.'));
      if (!isFinite(v) || v < 0 || String(t.value).trim() === '') return;
      if (k === 'backoffPct') v = Math.min(100, v) / 100;
      if (['moveUpReps', 'floorReps', 'graceSessions', 'windowSessions', 'backoffSets', 'startReps'].indexOf(k) >= 0) v = Math.round(v);
      if ((k === 'graceSessions' || k === 'windowSessions' || k === 'increment') && v <= 0) return;
      db.settings[k] = v; persistSoon();
    },
    importFile: function (t) {
      var f = t.files && t.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () { readBackupText(String(r.result || '')); };
      r.onerror = function () { toast('Couldn’t read that file. Try again or use pasted text.'); };
      r.readAsText(f);
    }
  };

  // ---------- events ----------
  function arm(b) {
    b.dataset.armed = '1';
    b.dataset.orig = b.innerHTML;
    b.textContent = b.dataset.confirm;
    setTimeout(function () { if (b.isConnected && b.dataset.armed === '1') { b.dataset.armed = ''; b.innerHTML = b.dataset.orig; } }, 3500);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    if (b.dataset.confirm !== undefined && b.dataset.armed !== '1') { e.preventDefault(); arm(b); return; }
    var fn = ACTIONS[b.dataset.act]; if (fn) { e.preventDefault(); fn(b, e); }
  });
  document.addEventListener('input', function (e) {
    var t = e.target; var fn = t.dataset && BINDERS[t.dataset.bind];
    if (fn && t.type !== 'file') fn(t);
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset) return;
    if (t.dataset.bind === 'importFile') BINDERS.importFile(t);
    if (t.tagName === 'SELECT' && BINDERS[t.dataset.bind]) BINDERS[t.dataset.bind](t);
    if ((t.dataset.bind === 'exField' && t.dataset.k === 'name') || (t.dataset.bind === 'wField' && t.dataset.k === 'name')) {
      var h = document.querySelector('.top h1'); if (h) h.textContent = t.value || 'Untitled';
    }
    if (t.dataset.bind === 'exField' && (t.dataset.k === 'equipment' || t.dataset.k === 'increment' || t.dataset.k === 'startWeight')) { persist(); render(); }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('sleep-pt')) { e.preventDefault(); ACTIONS.sleepDay(e.target); return; }
    if (e.key !== 'Enter' || !e.target.id) return;
    if (e.target.id === 'newex') { e.preventDefault(); ACTIONS.addEx(); }
    if (e.target.id === 'sleepHours') { e.preventDefault(); e.target.blur(); ACTIONS.saveSleep(); }
    var m = /^snew-(\d+)$/.exec(e.target.id);
    if (m) { e.preventDefault(); ACTIONS.optCreate({ dataset: { i: m[1] } }); }
  });
  window.addEventListener('popstate', function () { pushed = Math.max(0, pushed - 1); if (stack.length) back(); });
  window.addEventListener('scroll', function () { $('#top').classList.toggle('scrolled', window.scrollY > 4); }, { passive: true });
  window.addEventListener('pagehide', function () { clearTimeout(persistTimer); persist(); if (draft) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) { /* ignore */ } } });

  // ---------- boot ----------
  render();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
  try {
    var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || local)) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* not available here */ });
    }
  } catch (e) { /* ignore */ }
})();
