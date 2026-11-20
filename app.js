/* ISC 2.0 portable project dashboard (D-083). Plain JS, no dependencies, no external requests.
   Pure calculation functions are exported for Node tests (module.exports); the browser part boots on DOMContentLoaded. */
(function (root, factory) {
  'use strict';
  var PM = factory();
  if (typeof module === 'object' && module.exports) module.exports = PM;
  else root.PM = PM;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { PM.boot(root); });
    else PM.boot(root);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------ constants
  var DONE = ['DONE', 'RELEASED'];
  var TECH = ['IMPLEMENTED', 'QA_PASS', 'DIRECTOR_ACCEPTED'];
  var RUNGS = ['IMPLEMENTED', 'QA_PASS', 'TECHNICAL_ACCEPTED', 'DEVICE_VALIDATED', 'DIRECTOR_ACCEPTED'];
  var SCN = ['opt', 'base', 'cons'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SVGNS = 'http://www.w3.org/2000/svg';

  // ------------------------------------------------------------ CSV
  function parseCSV(text) {
    var rows = [], row = [], f = '', q = false, i = 0, c;
    text = String(text || '').replace(/^﻿/, '');
    for (; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); rows.push(row); row = []; f = '';
      } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    if (!rows.length) return { columns: [], rows: [] };
    var cols = rows[0];
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      if (rows[r].length === 1 && rows[r][0] === '') continue;
      var o = {};
      for (var k = 0; k < cols.length; k++) o[cols[k]] = rows[r][k] === undefined ? '' : rows[r][k];
      out.push(o);
    }
    return { columns: cols, rows: out };
  }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(columns, rows) {
    var lines = [columns.map(csvCell).join(',')];
    rows.forEach(function (r) { lines.push(columns.map(function (c) { return csvCell(r[c]); }).join(',')); });
    return lines.join('\n') + '\n';
  }

  // ------------------------------------------------------------ helpers
  function num(v) { var x = parseFloat(v); return isFinite(x) && String(v).trim() !== '' ? x : null; }
  function r1(x) { return Math.round(x * 10) / 10; }
  function isExec(r) { return r.node_type !== 'EPIC' && r.node_type !== 'PARENT'; }
  function has(arr, v) { return arr.indexOf(v) >= 0; }
  function fmtDate(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return s || '—';
    var p = s.slice(0, 10).split('-');
    return parseInt(p[2], 10) + ' ' + MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0];
  }
  function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function dayNum(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5; }
  function groupBy(rows, keyFn, init) {
    var order = [], m = {};
    rows.forEach(function (r) { var k = keyFn(r); if (!(k in m)) { m[k] = init(k); order.push(k); } m[k].__rows.push(r); });
    return order.map(function (k) { return m[k]; });
  }

  // ------------------------------------------------------------ calculations (pure)
  function kpi(tasks) {
    var t = tasks.filter(isExec);
    var c = function (f) { return t.filter(f).length; };
    var done = c(function (r) { return has(DONE, r.status); });
    return {
      total: t.length, done: done,
      technical: c(function (r) { return has(TECH, r.status); }),
      in_progress: c(function (r) { return r.status === 'IN_PROGRESS'; }),
      hold: c(function (r) { return r.status === 'HOLD'; }),
      blocked: c(function (r) { return r.status === 'BLOCKED'; }),
      hold_blocked: c(function (r) { return r.status === 'HOLD' || r.status === 'BLOCKED'; }),
      pct_done: t.length ? r1(done / t.length * 100) : 0
    };
  }

  function ladder(tasks) {
    var t = tasks.filter(isExec);
    var at = {}, reached = {};
    RUNGS.forEach(function (g) { at[g] = 0; });
    var none = 0;
    t.forEach(function (r) { if (has(RUNGS, r.ladder)) at[r.ladder]++; else none++; });
    var acc = 0;
    for (var i = RUNGS.length - 1; i >= 0; i--) { acc += at[RUNGS[i]]; reached[RUNGS[i]] = acc; }
    return { rungs: RUNGS.map(function (g) { return { rung: g, at: at[g], reached: reached[g] }; }), none: none, total: t.length };
  }

  function forecast(schedule) {
    return SCN.map(function (s) {
      var f = schedule.filter(function (r) { return r.scenario === s && r.finish; }).map(function (r) { return r.finish; }).sort();
      return { scenario: s, launch: f.length ? f[f.length - 1] : null };
    });
  }

  function statusGroup(st) {
    if (has(DONE, st)) return 'done';
    if (has(TECH, st)) return 'technical';
    if (st === 'IN_PROGRESS') return 'active';
    if (st === 'HOLD' || st === 'BLOCKED') return 'hold_blocked';
    return 'open';
  }

  function msProgress(tasks) {
    return groupBy(tasks.filter(isExec), function (r) { return r.milestone || '(none)'; }, function (k) {
      return { milestone: k, total: 0, done: 0, technical: 0, active: 0, hold_blocked: 0, open: 0, __rows: [] };
    }).map(function (o) {
      o.__rows.forEach(function (r) { o.total++; o[statusGroup(r.status)]++; });
      delete o.__rows; o.pct = o.total ? r1(o.done / o.total * 100) : 0; return o;
    }).sort(function (a, b) { return b.total - a.total || (a.milestone < b.milestone ? -1 : 1); });
  }

  function wsStatus(tasks) {
    return groupBy(tasks.filter(isExec), function (r) { return r.workstream || '(none)'; }, function (k) {
      return { workstream: k, total: 0, done: 0, technical: 0, active: 0, hold_blocked: 0, open: 0, __rows: [] };
    }).map(function (o) {
      o.__rows.forEach(function (r) { o.total++; o[statusGroup(r.status)]++; });
      delete o.__rows; return o;
    }).sort(function (a, b) { return b.total - a.total || (a.workstream < b.workstream ? -1 : 1); });
  }

  function ganttBase(schedule, tasks) {
    var ms = {};
    tasks.forEach(function (r) { ms[r.task_id] = r.milestone || '(none)'; });
    var g = {}, order = [];
    schedule.forEach(function (r) {
      if (r.scenario !== 'base' || !r.start || !r.finish) return;
      var m = ms[r.task_id] || '(none)';
      if (!g[m]) { g[m] = { milestone: m, start: r.start, finish: r.finish, tasks: 0 }; order.push(m); }
      var o = g[m];
      if (r.start < o.start) o.start = r.start;
      if (r.finish > o.finish) o.finish = r.finish;
      o.tasks++;
    });
    return order.map(function (m) { return g[m]; }).sort(function (a, b) {
      return a.start < b.start ? -1 : a.start > b.start ? 1 : (a.milestone < b.milestone ? -1 : 1);
    });
  }

  function resByDate(runs) {
    var g = groupBy(runs, function (r) { return r.date || 'UNKNOWN'; }, function (k) {
      return { date: k, runs: 0, worker_min: 0, lock_min: 0, __rows: [] };
    });
    return g.map(function (o) {
      o.__rows.forEach(function (r) {
        o.runs++;
        if (r.kind === 'worker') o.worker_min += num(r.duration_min) || 0;
        o.lock_min += num(r.unity_lock_min) || 0;
      });
      delete o.__rows;
      o.worker_min = r1(o.worker_min); o.lock_min = r1(o.lock_min);
      return o;
    }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }

  function resTotal(runs) {
    var w = runs.filter(function (r) { return r.kind === 'worker'; });
    var sum = function (rows, k) { return rows.reduce(function (a, r) { return a + (num(r[k]) || 0); }, 0); };
    return {
      worker_runs: w.length,
      worker_min: r1(sum(w, 'duration_min')),
      worker_h: r1(sum(w, 'duration_min') / 60),
      lock_min: r1(sum(runs, 'unity_lock_min')),
      lock_h: r1(sum(runs, 'unity_lock_min') / 60),
      unknown_runs: w.filter(function (r) { return num(r.duration_min) === null; }).length
    };
  }

  function activeRows(tasks) { return tasks.filter(function (t) { return t.status === 'IN_PROGRESS' && t.node_type !== 'EPIC'; }); }
  function holdRows(tasks) {
    return tasks.filter(function (t) {
      return (t.status === 'HOLD' || t.status === 'BLOCKED') && t.node_type !== 'EPIC' && !/POST-LAUNCH|DEFERRED/.test(t.milestone || '');
    });
  }
  function filterRegister(tasks, f) {
    var q = String(f.q || '').trim().toLowerCase();
    return tasks.filter(function (r) {
      return (!f.status || r.status === f.status) && (!f.ws || r.workstream === f.ws) &&
        (!q || (r.task_id + ' ' + r.title).toLowerCase().indexOf(q) >= 0);
    });
  }
  function distinct(rows, field) {
    var s = {};
    rows.forEach(function (r) { if (r[field]) s[r[field]] = 1; });
    return Object.keys(s).sort();
  }
  function parseQuery(search) {
    var o = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
      try { o[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* malformed */ }
    });
    return o;
  }
  function takeaway(k, fc) {
    var base = fc.filter(function (x) { return x.scenario === 'base'; })[0];
    return k.done + ' of ' + k.total + ' executable tasks are done (' + k.pct_done + '%), ' + k.in_progress + ' are in progress and ' +
      k.hold_blocked + ' are on hold or blocked. The provisional base forecast puts public launch on ' + fmtDate(base && base.launch) + '.';
  }

  function computeAll(data) {
    var tasks = data.tasks, runs = data.runs, schedule = data.schedule;
    var k = kpi(tasks), fc = forecast(schedule);
    return {
      kpi: k, ladder: ladder(tasks), forecast: fc, ms: msProgress(tasks), ws: wsStatus(tasks),
      gantt: ganttBase(schedule, tasks), resByDate: resByDate(runs), resTotal: resTotal(runs),
      active: activeRows(tasks), hold: holdRows(tasks), takeaway: takeaway(k, fc)
    };
  }

  // ------------------------------------------------------------ browser rendering
  var doc, win, state = { data: null, manifest: null, texts: null, calc: null, filter: { q: '', status: '', ws: '' } };

  function el(tag, attrs, kids) {
    var e = doc.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (a) {
      if (a === 'text') e.textContent = attrs[a];
      else if (a === 'cls') e.className = attrs[a];
      else e.setAttribute(a, attrs[a]);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
    return e;
  }
  function sv(tag, attrs, text) {
    var e = doc.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (a) { if (a === 'style') Object.assign(e.style, attrs[a]); else e.setAttribute(a, attrs[a]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function $(id) { return doc.getElementById(id); }
  function show(v) { return v == null || v === '' ? '—' : String(v); }
  function td(tr, v, cls) { var c = tr.insertCell(); c.textContent = show(v); if (cls) c.className = cls; return c; }
  function titleTd(tr, r) {
    var c = tr.insertCell();
    if (has(DONE, r.status)) { var s = el('s', { text: r.title }); c.appendChild(s); c.appendChild(el('span', { cls: 'skip', text: ' (done)' })); }
    else c.textContent = r.title;
    return c;
  }
  function chipTd(tr, s) { var c = tr.insertCell(); c.appendChild(el('span', { cls: 'chip st-' + String(s || '').replace(/[^A-Z_]/g, ''), text: s || '—' })); return c; }
  function tile(v, label, cls) {
    return el('div', { cls: 'tile' + (cls ? ' ' + cls : '') }, [el('span', { cls: 'v', text: show(v) }), el('span', { cls: 'l', text: label })]);
  }
  function fill(id, nodes) { var e = $(id); e.replaceChildren.apply(e, nodes); }
  function emptyRow(tbody, cols, msg) { var tr = tbody.insertRow(); var c = tr.insertCell(); c.colSpan = cols; c.textContent = msg; }
  function textW(s) { return String(s).length * 6.4; }

  function tipFor(container) {
    var t = container.querySelector('.tip');
    if (!t) { t = el('div', { cls: 'tip', role: 'status' }); t.hidden = true; container.appendChild(t); }
    return {
      show: function (text, x, y) {
        t.textContent = text; t.hidden = false;
        var w = container.clientWidth;
        t.style.left = Math.max(0, Math.min(x + 12, w - 230)) + 'px'; t.style.top = (y + 12) + 'px';
      },
      hide: function () { t.hidden = true; }
    };
  }
  function bindTip(node, tip, container, text) {
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label', text);
    node.appendChild(sv('title', {}, text));
    node.addEventListener('pointermove', function (ev) {
      var b = container.getBoundingClientRect(); tip.show(text, ev.clientX - b.left, ev.clientY - b.top);
    });
    node.addEventListener('pointerleave', tip.hide);
    node.addEventListener('focus', function () {
      var b = container.getBoundingClientRect(), n = node.getBoundingClientRect(); tip.show(text, n.left - b.left, n.bottom - b.top - 8);
    });
    node.addEventListener('blur', tip.hide);
  }

  function renderHeader() {
    var c = state.calc, m = state.manifest;
    $('takeaway').textContent = c.takeaway;
    $('meta').textContent = 'Snapshot ' + m.snapshot.replace('T', ' ') + ' (tracker changelog) · source commit ' + m.source_commit + ' · forecast ' + m.forecast.label;
    var k = c.kpi;
    fill('kpi-tiles', [
      tile(k.total, 'Executable tasks'), tile(k.done, 'Done or released', 'ok'),
      tile(k.technical, 'Implemented, QA pass or Director accepted, not yet done', 'ok'),
      tile(k.in_progress, 'In progress'), tile(k.hold, 'On hold (waits for a Director GO)', 'warn'),
      tile(k.blocked, 'Blocked', 'bad'), tile(k.pct_done + '%', 'Completion by task count (done ÷ executable)')
    ]);
    $('fc-label').textContent = m.forecast.label;
    var names = { opt: 'Optimistic', base: 'Base (P50)', cons: 'Conservative' };
    fill('fc-tiles', c.forecast.map(function (f) {
      return tile(fmtDate(f.launch), names[f.scenario] + ' · ' + m.forecast.label.toLowerCase(), f.scenario === 'cons' ? 'warn' : '');
    }));
    $('fc-note').textContent = m.forecast.note;
  }

  function renderLadder() {
    var box = $('ladder-chart'), L = state.calc.ladder;
    box.replaceChildren();
    var rows = L.rungs.map(function (g) { return { label: g.rung.replace(/_/g, ' '), v: g.at, reached: g.reached }; });
    rows.push({ label: 'NOT IMPLEMENTED YET', v: L.none, reached: null });
    var W = Math.max(300, box.clientWidth || 600), rowH = 20, gap = 6, lw = 0;
    rows.forEach(function (r) { lw = Math.max(lw, textW(r.label)); });
    var padL = Math.ceil(lw) + 10, padR = 120, H = rows.length * (rowH + gap);
    var max = Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([1]));
    var x = function (v) { return (W - padL - padR) * v / max; };
    var aria = 'Acceptance ladder, highest rung per executable task: ' + rows.map(function (r) { return r.label.toLowerCase() + ' ' + r.v; }).join(', ');
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': aria });
    var tip = tipFor(box);
    rows.forEach(function (r, i) {
      var y = i * (rowH + gap);
      svg.appendChild(sv('text', { x: padL - 8, y: y + rowH / 2 + 4, 'text-anchor': 'end' }, r.label));
      var bar = sv('rect', { x: padL, y: y, width: Math.max(r.v ? 2 : 0, x(r.v)), height: rowH, rx: 4, 'class': 'bar',
        style: { fill: r.reached === null ? 'var(--neutral)' : 'var(--series-1)' } });
      svg.appendChild(bar);
      bindTip(bar, tip, box, r.label + ': ' + r.v + ' tasks' + (r.reached !== null ? ' (' + r.reached + ' at this rung or higher)' : ''));
      svg.appendChild(sv('text', { x: padL + x(r.v) + 6, y: y + rowH / 2 + 4, 'class': 'val' },
        r.v + (r.reached !== null ? '  (≥ rung: ' + r.reached + ')' : '')));
    });
    box.appendChild(svg);
  }

  var WS_KEYS = [
    ['done', 'Done', 'var(--good)'], ['technical', 'Technical (not done)', 'var(--series-1)'], ['active', 'In progress', 'var(--series-7)'],
    ['hold_blocked', 'Hold / blocked', 'var(--warning)'], ['open', 'Planned / ready', 'var(--neutral)']
  ];
  function renderWs() {
    var box = $('ws-chart'), rows = state.calc.ws;
    box.replaceChildren();
    var W = Math.max(280, box.clientWidth || 500), rowH = 18, gap = 6, lw = 0;
    rows.forEach(function (r) { lw = Math.max(lw, textW(r.workstream)); });
    var padL = Math.ceil(lw) + 10, padR = 34, H = rows.length * (rowH + gap);
    var max = Math.max.apply(null, rows.map(function (r) { return r.total; }).concat([1]));
    var sx = function (v) { return (W - padL - padR) * v / max; };
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'Executable tasks per workstream split by status group: ' + rows.map(function (r) {
        return r.workstream + ' ' + r.total + ' (' + r.done + ' done)'; }).join(', ') });
    var tip = tipFor(box);
    rows.forEach(function (r, i) {
      var y = i * (rowH + gap), acc = 0;
      svg.appendChild(sv('text', { x: padL - 8, y: y + rowH / 2 + 4, 'text-anchor': 'end' }, r.workstream));
      WS_KEYS.forEach(function (k) {
        var v = r[k[0]]; if (!v) return;
        var x0 = padL + sx(acc), w = Math.max(1, sx(v) - 2);
        var seg = sv('rect', { x: x0, y: y, width: w, height: rowH, rx: 2, style: { fill: k[2] } });
        svg.appendChild(seg);
        bindTip(seg, tip, box, r.workstream + ': ' + k[1].toLowerCase() + ' ' + v + ' of ' + r.total);
        acc += v;
      });
      svg.appendChild(sv('text', { x: padL + sx(r.total) + 4, y: y + rowH / 2 + 4, 'class': 'val' }, String(r.total)));
    });
    box.appendChild(svg);
    fill('ws-legend', WS_KEYS.map(function (k) {
      var i = el('i'); i.style.background = k[2]; return el('span', {}, [i, k[1]]);
    }));
  }

  function renderGantt() {
    var box = $('gantt-chart'), rows = state.calc.gantt.filter(function (r) { return r.milestone !== '(none)'; });
    box.replaceChildren();
    var today = state.manifest.snapshot.slice(0, 10);
    $('gantt-note').textContent = 'Each bar runs from the earliest start to the latest finish of the milestone\'s scheduled tasks in the base scenario (provisional). ' +
      'The dashed line is the snapshot date (' + fmtDate(today) + ').';
    if (!rows.length) { box.textContent = 'No scheduled tasks in the base scenario.'; return; }
    var W = Math.max(300, box.clientWidth || 800), rowH = 18, gap = 6, padT = 22, lw = 0;
    rows.forEach(function (r) { lw = Math.max(lw, textW(r.milestone)); });
    var padL = Math.ceil(lw) + 10, padR = 12, H = padT + rows.length * (rowH + gap);
    var lo = Math.min(dayNum(today), Math.min.apply(null, rows.map(function (r) { return dayNum(r.start); })));
    var hi = Math.max.apply(null, rows.map(function (r) { return dayNum(r.finish); })) + 1;
    var x = function (d) { return padL + (W - padL - padR) * (d - lo) / Math.max(1, hi - lo); };
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Milestone timeline, base scenario: ' +
      rows.map(function (r) { return r.milestone + ' ' + fmtDate(r.start) + ' to ' + fmtDate(r.finish); }).join('; ') });
    // month ticks
    var d0 = new Date(lo * 864e5), months = [];
    for (var y = d0.getUTCFullYear(), mo = d0.getUTCMonth() + 1; ; mo++) {
      if (mo > 11) { mo = 0; y++; }
      var dn = Date.UTC(y, mo, 1) / 864e5;
      if (dn > hi) break;
      months.push({ d: dn, label: MONTHS[mo] + (mo === 0 ? ' ' + y : '') });
    }
    var step = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor((W - padL) / 64))));
    months.forEach(function (m, i) {
      svg.appendChild(sv('line', { x1: x(m.d), x2: x(m.d), y1: padT - 4, y2: H, style: { stroke: 'var(--line)' } }));
      if (i % step === 0) svg.appendChild(sv('text', { x: x(m.d), y: 12, 'text-anchor': 'middle' }, m.label));
    });
    var tip = tipFor(box);
    rows.forEach(function (r, i) {
      var yy = padT + i * (rowH + gap);
      svg.appendChild(sv('text', { x: padL - 8, y: yy + rowH / 2 + 4, 'text-anchor': 'end' }, r.milestone));
      var bar = sv('rect', { x: x(dayNum(r.start)), y: yy, width: Math.max(4, x(dayNum(r.finish) + 1) - x(dayNum(r.start))), height: rowH, rx: 4,
        style: { fill: 'var(--series-1)' } });
      svg.appendChild(bar);
      bindTip(bar, tip, box, r.milestone + ': ' + fmtDate(r.start) + ' to ' + fmtDate(r.finish) + ' (' + r.tasks + ' tasks)');
    });
    svg.appendChild(sv('line', { x1: x(dayNum(today)), x2: x(dayNum(today)), y1: padT - 4, y2: H,
      style: { stroke: 'var(--ink-2)', strokeDasharray: '4 3', strokeWidth: '1.5' } }));
    svg.appendChild(sv('text', { x: x(dayNum(today)) + 4, y: padT - 6, 'class': 'val' }, 'snapshot'));
    box.appendChild(svg);
  }

  function renderTables() {
    var c = state.calc, b;
    b = $('ms-body'); b.replaceChildren();
    c.ms.forEach(function (r) {
      var tr = b.insertRow();
      td(tr, r.milestone); td(tr, r.total, 'num'); td(tr, r.done, 'num'); td(tr, r.technical, 'num'); td(tr, r.active, 'num');
      td(tr, r.hold_blocked, 'num'); td(tr, r.pct + '%', 'num');
    });
    b = $('active-body'); b.replaceChildren();
    c.active.forEach(function (r) {
      var tr = b.insertRow(); td(tr, r.task_id, 'id'); titleTd(tr, r); td(tr, r.workstream); td(tr, r.milestone); td(tr, fmtDate(r.actual_start)); td(tr, r.acceptance_status);
    });
    if (!c.active.length) emptyRow(b, 6, 'Nothing in progress.');
    b = $('hold-body'); b.replaceChildren();
    c.hold.forEach(function (r) {
      var tr = b.insertRow(); td(tr, r.task_id, 'id'); titleTd(tr, r); chipTd(tr, r.status); td(tr, r.milestone); td(tr, r.blocker);
    });
    if (!c.hold.length) emptyRow(b, 5, 'Nothing on hold or blocked before launch.');
    var t = c.resTotal;
    fill('res-tiles', [
      tile(t.worker_h, 'Worker hours (summed agent time, not elapsed)'), tile(t.worker_runs, 'Worker runs'),
      tile(t.lock_h, 'Unity-lock hours (known runs)'), tile(t.unknown_runs, 'Worker runs with unknown duration')
    ]);
    $('res-note').textContent = 'Only measured runs are summed. Lead minutes and Director review minutes are not recorded (UNKNOWN). ' +
      'Token usage and worker identities are not published (D-087).';
    b = $('res-body'); b.replaceChildren();
    c.resByDate.forEach(function (r) {
      var tr = b.insertRow(); td(tr, r.date); td(tr, r.runs, 'num'); td(tr, r.worker_min, 'num'); td(tr, r.lock_min, 'num');
    });
  }

  function renderRegister() {
    var rows = filterRegister(state.data.tasks, state.filter), b = $('reg-body');
    b.replaceChildren();
    rows.forEach(function (r) {
      var tr = b.insertRow();
      td(tr, r.task_id, 'id'); titleTd(tr, r); chipTd(tr, r.status); td(tr, r.workstream); td(tr, r.milestone); td(tr, r.effort_base_h, 'num');
      td(tr, r.ladder ? r.ladder.replace(/_/g, ' ') : ''); td(tr, r.acceptance_status); td(tr, r.device_status); td(tr, r.decision_ref);
    });
    if (!rows.length) emptyRow(b, 10, 'No task matches the filters.');
    $('reg-count').textContent = rows.length + ' of ' + state.data.tasks.length + ' rows shown';
  }

  function setupFilters() {
    var mk = function (id, label, vals, key) {
      var s = $(id);
      s.replaceChildren.apply(s, [new win.Option(label, '')].concat(vals.map(function (v) { return new win.Option(v, v); })));
      s.addEventListener('change', function () { state.filter[key] = s.value; renderRegister(); });
    };
    mk('f-status', 'All statuses', distinct(state.data.tasks, 'status'), 'status');
    mk('f-ws', 'All workstreams', distinct(state.data.tasks, 'workstream'), 'ws');
    // deep links: ?q=...&status=...&ws=... pre-fill the register filters
    var qs = parseQuery(win.location.search || '');
    if (qs.q) { state.filter.q = qs.q; $('f-q').value = qs.q; }
    if (qs.status && distinct(state.data.tasks, 'status').indexOf(qs.status) >= 0) { state.filter.status = qs.status; $('f-status').value = qs.status; }
    if (qs.ws && distinct(state.data.tasks, 'workstream').indexOf(qs.ws) >= 0) { state.filter.ws = qs.ws; $('f-ws').value = qs.ws; }
    $('f-q').addEventListener('input', function (e) { state.filter.q = e.target.value; renderRegister(); });
    $('reg-export').addEventListener('click', function () {
      var cols = state.manifest.schema['tasks.csv'];
      download('tasks-filtered.csv', toCSV(cols, filterRegister(state.data.tasks, state.filter)));
    });
  }

  function download(name, text) {
    var blob = new win.Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = win.URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name });
    doc.body.appendChild(a); a.click(); a.remove();
    win.setTimeout(function () { win.URL.revokeObjectURL(url); }, 1000);
  }

  function renderSources() {
    var m = state.manifest, b = $('src-body');
    b.replaceChildren();
    m.files.forEach(function (f) {
      var tr = b.insertRow();
      td(tr, f.name); td(tr, f.rows, 'num');
      var h = tr.insertCell(); h.appendChild(el('code', { cls: 'hash', text: f.sha256 }));
      td(tr, m.snapshot.replace('T', ' ')); td(tr, m.source_commit);
      var c = tr.insertCell();
      var btn = el('button', { type: 'button', cls: 'dl', text: 'CSV', 'aria-label': 'Download ' + f.name });
      btn.addEventListener('click', function () { download(f.name, state.texts[f.name]); });
      c.appendChild(btn);
    });
    $('src-note').textContent = 'Public, sanitised snapshot (D-083, D-087): only allow-listed columns are published; free text is scrubbed of paths, branch names, ' +
      'commit ids and worker labels (shown as [worker]); token usage is never published. Snapshot = latest tracker changelog entry; source commit = last commit of the tracker source files' +
      (m.source_commit_time ? ' (' + m.source_commit_time + ')' : '') + '. Forecast: ' + m.forecast.label + '.';
    fill('src-schema', Object.keys(m.schema).sort().map(function (k) {
      return el('li', {}, [el('code', { text: k }), ': ' + m.schema[k].join(', ')]);
    }));
  }

  function renderCharts() { renderLadder(); renderWs(); renderGantt(); }

  function setupTheme() {
    var btn = $('theme-btn'), html = doc.documentElement, modes = ['auto', 'light', 'dark'], mode = 'auto';
    try { mode = win.localStorage.getItem('pm-theme') || 'auto'; } catch (e) { /* storage blocked */ }
    var qt = parseQuery(win.location.search || '').theme;
    if (qt === 'light' || qt === 'dark' || qt === 'auto') mode = qt;
    var apply = function () {
      if (mode === 'auto') html.removeAttribute('data-theme'); else html.setAttribute('data-theme', mode);
      btn.textContent = 'Theme: ' + mode;
      btn.setAttribute('aria-label', 'Colour theme: ' + (mode === 'auto' ? 'follow system' : mode) + '. Activate to change.');
    };
    apply();
    btn.addEventListener('click', function () {
      mode = modes[(modes.indexOf(mode) + 1) % modes.length];
      try { win.localStorage.setItem('pm-theme', mode); } catch (e) { /* ignore */ }
      apply();
    });
  }

  function loadData() {
    var emb = doc.getElementById('pm-embed');
    if (emb) {
      var d = JSON.parse(emb.textContent);
      return Promise.resolve({ manifest: d.manifest, texts: d.files });
    }
    return win.fetch('data/manifest.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('manifest ' + r.status);
      return r.json();
    }).then(function (manifest) {
      return Promise.all(manifest.files.map(function (f) {
        return win.fetch('data/' + f.name, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(f.name + ' ' + r.status); return r.text(); });
      })).then(function (txts) {
        var texts = {};
        manifest.files.forEach(function (f, i) { texts[f.name] = txts[i]; });
        return { manifest: manifest, texts: texts };
      });
    });
  }

  function datasetFromTexts(texts) {
    var d = {};
    Object.keys(texts).forEach(function (n) { d[n.replace(/\.csv$/, '')] = parseCSV(texts[n]).rows; });
    return d;
  }

  function boot(root) {
    win = root; doc = root.document;
    setupTheme();
    loadData().then(function (res) {
      state.manifest = res.manifest; state.texts = res.texts;
      state.data = datasetFromTexts(res.texts);
      state.calc = computeAll(state.data);
      renderHeader(); renderTables(); setupFilters(); renderRegister(); renderSources(); renderCharts();
      var t; win.addEventListener('resize', function () { win.clearTimeout(t); t = win.setTimeout(renderCharts, 150); });
      doc.documentElement.setAttribute('data-ready', '1');
    }).catch(function (e) {
      var p = $('takeaway');
      p.className = 'take err';
      p.textContent = 'The dataset could not be loaded (' + e.message + '). Serve this folder over HTTP, or open portable.html for local use.';
    });
  }

  return {
    parseCSV: parseCSV, toCSV: toCSV, kpi: kpi, ladder: ladder, forecast: forecast, msProgress: msProgress, wsStatus: wsStatus,
    ganttBase: ganttBase, resByDate: resByDate, resTotal: resTotal, activeRows: activeRows, holdRows: holdRows,
    filterRegister: filterRegister, distinct: distinct, parseQuery: parseQuery, takeaway: takeaway, computeAll: computeAll, datasetFromTexts: datasetFromTexts,
    fmtDate: fmtDate, isExec: isExec, RUNGS: RUNGS, boot: boot
  };
});
