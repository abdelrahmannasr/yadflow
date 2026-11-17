// yad map (E181) — the progress map page. Ported from the progress-map prototype: the same layout, motion
// and marks. Added in the same language: initials badges, the People lens, waiting rings, what moved, the
// single-person note. Every label is set with textContent; the data is read, never run.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  // ---- loading: the data baked into the file, or asked of the local server --------------------------
  function key() { return new URLSearchParams(location.search).get('t') || ''; }
  function load() {
    var inline = document.getElementById('yad-map-data');
    if (inline) { try { return Promise.resolve(JSON.parse(inline.textContent)); } catch { return Promise.resolve(null); } }
    return fetch('map.json?t=' + encodeURIComponent(key()), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  var current = null;   // the running build: { stop() }
  function show(D) {
    if (current) current.stop();
    if (!D || !Array.isArray(D.epics)) { document.body.classList.add('nodata'); return; }
    document.body.classList.remove('nodata');
    current = build(D);
  }
  load().then(show);
  // --live: the server says the record changed; read it again and draw the new picture in place.
  if (!document.getElementById('yad-map-data') && window.EventSource) {
    try {
      var es = new EventSource('events?t=' + encodeURIComponent(key()));
      es.addEventListener('status', function (ev) { try { if (JSON.parse(ev.data).live) $('live').hidden = false; } catch { /* ignore */ } });
      es.addEventListener('rebuilt', function () { load().then(function (D) { if (D) show(D); }); });
      es.onerror = function () { $('live').hidden = true; };
    } catch { /* no live stream */ }
  }

  function build(D) {
    var ac = new AbortController(), on = { signal: ac.signal }, alive = true;
    // ───────────────────────────────────────────────────────── constants ──
    var VIS = {
      live:    { short: 'In Production', label: 'In Production', rgb: '57,135,229', glow: '120,180,255' },
      merged:  { short: 'Waiting for release', label: 'Merged, waiting for release', rgb: '213,81,129', glow: '255,140,180' },
      unver:   { short: 'Shipped, unchecked', label: 'Shipped — release can’t be checked here', rgb: '213,81,129', glow: '255,140,180' },
      active:  { short: 'In progress', label: 'In progress', rgb: '201,133,0', glow: '255,196,77' },
      planned: { short: 'Not started', label: 'Not started', rgb: '147,160,191', glow: '147,160,191' },
      idle:    { short: 'Idle ' + D.staleDays + '+ days', label: 'Idle ' + D.staleDays + '+ days, never merged', rgb: '91,102,128', glow: '91,102,128' },
    };
    var ORDER = ['live', 'merged', 'unver', 'active', 'planned', 'idle'];
    var HUES = ['63,111,216', '47,158,143', '138,92,214', '192,86,125', '185,133,43', '75,155,209', '110,154,60', '199,106,59'];
    // CLUSTER_GAP grows when there are people to show: the owner and waiting badges sit on a pill's top edge.
    var R_RING = 74, XI = 172, BOW = 54, RH = 19, CLUSTER_GAP = (D.people && D.people.length) ? 19 : 13, STEP = 14, SPOKE_MAX = 12;
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    var fmtDate = function (d) { return d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
    var ago = function (d) { if (!d) return ''; var n = Math.floor((Date.now() - Date.parse(d)) / 864e5); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 60 ? n + ' days ago' : Math.round(n / 30) + ' months ago'; };
    var clip = function (s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    var liveRepos = D.repos.filter(function (r) { return r.available; });
    var mainRepo = D.repos.find(function (r) { return r.available && r.productionBranch; }) || liveRepos[0] || null;
    var waitRepos = liveRepos.filter(function (r) { return r.waitingCommits != null; });
    var waitingTotal = waitRepos.reduce(function (s, r) { return s + r.waitingCommits; }, 0);
    var visOf = function (o) { return (o.state === 'merged' && o.verified === false) ? 'unver' : o.state; };

    // People: by key. A role list for each item, read from its `roles`.
    var P = new Map((D.people || []).map(function (p) { return [p.key, p]; }));
    var nameOf = function (k) { var p = P.get(k); return p ? p.name : null; };
    var waitBy = new Map();   // epic -> [{ step, person }]
    (D.waiting || []).forEach(function (w) { if (!waitBy.has(w.epic)) waitBy.set(w.epic, []); waitBy.get(w.epic).push(w); });
    var moved = new Map((D.moved || []).map(function (m) { return [m.id, m]; }));
    var onePerson = new Set((D.notes && D.notes.onePerson) || []);
    function personKeys(n) {
      var r = n.ref.roles || {}, out = [];
      if (n.kind === 'story') { if (r.owner) out.push(r.owner); }
      else if (n.kind === 'task') { if (r.builder) out.push(r.builder); out.push.apply(out, r.reviewers || []); }
      else if (n.kind === 'branch') { if (r.builder) out.push(r.builder); }
      else if (n.kind === 'cluster' && n.clusterKind === 'epic') {
        if (r.owner) out.push(r.owner);
        (r.stepOwners || []).forEach(function (x) { out.push(x.person); });
        (r.approvers || []).forEach(function (x) { out.push(x.person); });
        (waitBy.get(n.ref.id) || []).forEach(function (w) { if (w.person) out.push(w.person); });
      }
      return out;
    }
    function rolesOf(n, k) {
      var r = n.ref.roles || {}, out = [];
      if (r.owner === k || (r.stepOwners || []).some(function (x) { return x.person === k; })) out.push('owner');
      if (r.builder === k) out.push('builder');
      if ((r.reviewers || []).indexOf(k) >= 0) out.push('reviewer');
      if ((r.approvers || []).some(function (x) { return x.person === k; })) out.push('approver');
      return out;
    }

    // ─────────────────────────────────────────────────────────── model ──
    var nodes = [], clusters = [];
    var taskBranch = new Set(D.tasks.map(function (t) { return t.repo + ':' + t.branch; }));
    var storyIds = new Set(D.stories.map(function (s) { return s.id; }));
    function bead(kind, ref) {
      var label = kind === 'story' ? ref.short : kind === 'task' ? ref.task : ref.name;
      var n = { kind: kind, ref: ref, label: label, state: ref.state, vis: visOf(ref), r: kind === 'story' ? 6.2 : kind === 'task' ? 3.9 : 4.3, lit: true, mid: kind + ':' + ref.id };
      n.people = personKeys(n);
      n.search = [label, ref.id, ref.title, ref.branch, ref.repo, ref.story].concat(n.people.map(nameOf)).filter(Boolean).join(' ').toLowerCase();
      return n;
    }
    var pyramid = function (arr, w) { var out = []; arr.slice().sort(function (a, b) { return w(b) - w(a); }).forEach(function (x, i) { if (i % 2) out.unshift(x); else out.push(x); }); return out; };

    var groupClusters = [];
    D.groups.forEach(function (g) {
      var mine = D.branches.filter(function (b) { return b.group === g.id; })
        .sort(function (a, b) { return ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || String(b.date).localeCompare(String(a.date)); });
      if (!mine.length) return;
      var h = { kind: 'cluster', clusterKind: 'group', ref: g, label: g.label, state: null, vis: null, spokes: [], lit: true, people: [], mid: 'group:' + g.id };
      var rows = Math.ceil(mine.length / SPOKE_MAX), per = Math.ceil(mine.length / rows);
      for (var i = 0; i < mine.length; i += per) h.spokes.push(mine.slice(i, i + per).map(function (b) { return bead('branch', b); }));
      h.search = g.label.toLowerCase();
      groupClusters.push(h);
    });
    var epicClusters = [];
    D.epics.forEach(function (e) {
      var h = { kind: 'cluster', clusterKind: 'epic', ref: e, label: clip(e.label, 26), state: e.state, vis: e.state, spokes: [], lit: true, mid: 'epic:' + e.id };
      D.stories.filter(function (x) { return x.epic === e.id; }).forEach(function (s) {
        var row = [bead('story', s)];
        D.tasks.filter(function (x) { return x.story === s.id; }).forEach(function (t) { row.push(bead('task', t)); });
        D.branches.filter(function (x) { return x.story === s.id && !taskBranch.has(x.id); }).forEach(function (b) { row.push(bead('branch', b)); });
        h.spokes.push(row);
      });
      var loose = D.branches.filter(function (b) { return b.epic === e.id && !taskBranch.has(b.id) && !(b.story && storyIds.has(b.story)); });
      if (loose.length) h.spokes.push(loose.map(function (b) { return bead('branch', b); }));
      h.people = personKeys(h);
      h.search = [e.id, e.label, e.title, e.type].concat(h.people.map(nameOf)).filter(Boolean).join(' ').toLowerCase();
      var waits = waitBy.get(e.id) || [];
      h.waitFor = waits.find(function (w) { return w.person; }) || null;
      epicClusters.push(h);
    });
    var longest = function (h) { return h.spokes.reduce(function (m, s) { return Math.max(m, s.length); }, 0) * 10 + h.spokes.length; };
    clusters.push.apply(clusters, groupClusters.concat(epicClusters));

    // ────────────────────────────────────────────────────────── layout ──
    function cubic(a, b, c, d, n) { var pts = []; for (var i = 0; i <= n; i++) { var t = i / n, m = 1 - t, k0 = m * m * m, k1 = 3 * m * m * t, k2 = 3 * m * t * t, k3 = t * t * t; pts.push({ x: k0 * a.x + k1 * b.x + k2 * c.x + k3 * d.x, y: k0 * a.y + k1 * b.y + k2 * c.y + k3 * d.y }); } return pts; }
    function polyline(pts) { var cum = new Float32Array(pts.length); for (var i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return { pts: pts, cum: cum, len: cum[cum.length - 1] || 0 }; }
    var trace = function (p, pts) { pts.forEach(function (q, k) { if (k) p.lineTo(q.x, q.y); else p.moveTo(q.x, q.y); }); };
    var clamp1 = function (v) { return Math.max(-1, Math.min(1, v)); };

    var core = { kind: 'core', x: 0, y: 0, r: 30, lit: true, label: 'Production', search: 'production', people: [], mid: 'core' };
    var ring = { kind: 'ring', x: 0, y: -R_RING, lit: true, label: 'Development', search: 'development', people: [], mid: 'ring' };
    var mctx = document.createElement('canvas').getContext('2d');
    var CLUSTER_FONT = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
    var bbox = { x0: -120, y0: -R_RING - 22, x1: 120, y1: R_RING + 30 };
    (function layout() {
      mctx.font = CLUSTER_FONT;
      clusters.forEach(function (h) {
        var all = [].concat.apply([], h.spokes);
        h.counts = {}; all.forEach(function (b) { h.counts[b.vis] = (h.counts[b.vis] || 0) + 1; });
        h.total = all.length; h.block = Math.max(h.spokes.length, 1) * RH; h.h = 26;
        h.frac = h.clusterKind === 'epic' ? (h.ref.storyCount ? h.ref.storiesShipped + '/' + h.ref.storyCount : '') : (h.counts.live || 0) + '/' + h.total;
        h.w = Math.ceil(mctx.measureText(h.label).width + (h.frac ? mctx.measureText(h.frac).width + 10 : 0) + 34);
      });
      var height = function (list) { return list.reduce(function (s, h) { return s + h.block + CLUSTER_GAP; }, -CLUSTER_GAP); };
      var left = groupClusters.slice(), right = [];
      epicClusters.slice().sort(function (a, b) { return b.block - a.block; }).forEach(function (e) { (height(right) <= height(left) ? right : left).push(e); });
      var weight = function (h) { return (h.clusterKind === 'group' ? 1e4 : 0) + longest(h); };
      var wings = [[-1, pyramid(left, weight)], [1, pyramid(right, weight)]];
      var maxW = Math.max.apply(null, clusters.map(function (h) { return h.w; }).concat([80])), XB = XI + maxW + 48;
      var Y = Math.max(height(left), height(right), 200) / 2;
      wings.forEach(function (wing) {
        var sg = wing[0], list = wing[1], y = -height(list) / 2;
        list.forEach(function (h) {
          h.side = sg; h.y = y + h.block / 2;
          var xin = XI - BOW * Math.pow(h.y / Y, 2); h.x = sg * (xin + h.w / 2);
          var al = clamp1(h.y / Y) * 1.15, rp = { x: sg * R_RING * Math.cos(al), y: R_RING * Math.sin(al) };
          var p0 = { x: sg * xin, y: h.y };
          var trunk = cubic(p0, { x: sg * (xin - (xin - R_RING) * 0.55), y: h.y }, { x: rp.x + sg * Math.cos(al) * 52, y: rp.y + Math.sin(al) * 52 }, rp, 26);
          h.trunk = new Path2D(); trace(h.trunk, trunk); h.links = new Path2D();
          var out = { x: sg * (xin + h.w), y: h.y };
          h.spokes.forEach(function (sp, j) {
            var yb = y + (j + 0.5) * RH, fan = clamp1(yb / Y) * 0.3, d = { x: sg * Math.cos(fan), y: Math.sin(fan) };
            var base = { x: sg * (XB - BOW * 0.6 * Math.pow(yb / Y, 2)), y: yb }, mx = (base.x + out.x) / 2;
            var toCluster = cubic(base, { x: mx, y: base.y }, { x: mx, y: out.y }, out, 16);
            trace(h.links, toCluster);
            sp.forEach(function (b, i) {
              b.x = base.x + d.x * i * STEP; b.y = base.y + d.y * i * STEP; b.cluster = h; b.spoke = sp; b.idx = i; b.side = sg;
              if (i) { h.links.moveTo(sp[i - 1].x, sp[i - 1].y); h.links.lineTo(b.x, b.y); }
              var back = []; for (var k = i; k >= 0; k--) back.push({ x: sp[k].x, y: sp[k].y });
              var toPill = back.concat(toCluster.slice(1));
              b.clusterAt = polyline(toPill).len;
              var pts = toPill.concat(trunk);
              if (b.state === 'live') pts.push({ x: 0, y: 0 });
              b.path = polyline(pts);
              nodes.push(b);
              bbox.x0 = Math.min(bbox.x0, b.x - 14); bbox.x1 = Math.max(bbox.x1, b.x + 14); bbox.y0 = Math.min(bbox.y0, b.y - 14); bbox.y1 = Math.max(bbox.y1, b.y + 14);
            });
          });
          bbox.y0 = Math.min(bbox.y0, h.y - 26); bbox.y1 = Math.max(bbox.y1, h.y + 26);
          bbox.x0 = Math.min(bbox.x0, h.x - h.w / 2 - 10); bbox.x1 = Math.max(bbox.x1, h.x + h.w / 2 + 10);
          nodes.push(h);
          y += h.block + CLUSTER_GAP;
        });
      });
      nodes.push(core, ring);
    })();
    var beads = nodes.filter(function (n) { return n.path; });

    // ───────────────────────────────────────────────────────── canvases ──
    var bg = $('bg'), fx = $('fx'), bctx = bg.getContext('2d'), ctx = fx.getContext('2d');
    var cam = { x: 0, y: 0, k: 1 };
    var W = 0, H = 0, DPR = 1, userMoved = false, dirty = true;
    var focus = null, pinned = null, filterVis = null, query = '', anyDim = false, lastT = 0, person = null, roleFilter = null;
    function fit() {
      var top = document.querySelector('header').offsetHeight - 10, bot = document.querySelector('footer').offsetHeight + 22, pad = 14;
      var bw = bbox.x1 - bbox.x0, bh = bbox.y1 - bbox.y0, room = W - (pinned && W > 900 ? 360 : 0);
      cam.k = Math.max(0.35, Math.min((room - pad * 2) / bw, (H - top - bot) / bh, 1.8));
      cam.x = room / 2 - (bbox.x0 + bbox.x1) / 2 * cam.k;
      cam.y = top + (H - top - bot) / 2 - (bbox.y0 + bbox.y1) / 2 * cam.k;
      userMoved = false; dirty = true;
    }
    function resize() {
      DPR = Math.min(2, window.devicePixelRatio || 1); W = window.innerWidth; H = window.innerHeight;
      [bg, fx].forEach(function (c) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); });
      if (!userMoved) fit();
      dirty = true; drawBg(lastT);
    }
    function zoomAt(sx, sy, f) {
      var k = Math.max(0.35, Math.min(5, cam.k * f)), wx = (sx - cam.x) / cam.k, wy = (sy - cam.y) / cam.k;
      cam.k = k; cam.x = sx - wx * k; cam.y = sy - wy * k; userMoved = true; dirty = true;
    }

    // ────────────────────────────────────────────────────── background ──
    // A slow field of dotted lines riding a wave. Decoration only; it carries no data.
    // The sky follows the brand (#564): the page's --bg is the brand's dark bg (the Product's, or yadflow's own
    // when it has none), set through PAGE_MAPS.map. Only a page served with no brand CSS at all keeps the
    // stylesheet's #040816, and then the prototype's two blues. A brand sky keeps a soft lift towards the bottom.
    var SKY = (function () {
      var v = '';
      try { v = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(); } catch (e) { v = ''; }
      return v && v.toLowerCase() !== '#040816' ? [v, v, true] : ['#030613', '#050c22', false];
    })();
    function drawBg(t) {
      var w = bg.width, h = bg.height, b = bctx;
      var g = b.createLinearGradient(0, 0, 0, h); g.addColorStop(0, SKY[0]); g.addColorStop(1, SKY[1]);
      b.fillStyle = g; b.fillRect(0, 0, w, h);
      if (SKY[2]) {
        var lift = b.createLinearGradient(0, 0, 0, h); lift.addColorStop(0, 'rgba(255,255,255,0)'); lift.addColorStop(1, 'rgba(255,255,255,0.035)');
        b.fillStyle = lift; b.fillRect(0, 0, w, h);
      }
      var S = Math.max(w, h) * 0.62, cx = w / 2, cy = h * 0.54, ca = Math.cos(-0.42), sa = Math.sin(-0.42);
      var LINES = 60, DOTS = 150, bk = [[], [], [], [], []];
      for (var i = 0; i < LINES; i++) {
        var u = (i / (LINES - 1) - 0.5) * 3.1;
        for (var j = 0; j < DOTS; j++) {
          var v = (j / (DOTS - 1) - 0.5) * 2.7;
          var z = Math.sin(u * 2.6 + t * 0.30) * Math.cos(v * 3.4 - t * 0.22) * 0.55 + Math.sin((u + v) * 4.6 + t * 0.42) * 0.3 + Math.sin(u * 8.3 - v * 6.1 + t * 0.7) * 0.1;
          var x = cx + (u * ca - v * sa) * S + z * 9 * DPR, y = cy + (u * sa + v * ca) * S * 0.5 - z * S * 0.045;
          if (x < -4 || x > w + 4 || y < -4 || y > h + 4) continue;
          bk[Math.max(0, Math.min(4, ((z + 0.95) / 1.9 * 5) | 0))].push(x, y);
        }
      }
      var cols = ['rgba(18,44,140,.30)', 'rgba(26,66,186,.42)', 'rgba(42,100,224,.56)', 'rgba(88,148,246,.72)', 'rgba(168,208,255,.88)'];
      for (var k = 0; k < 5; k++) { b.fillStyle = cols[k]; var a = bk[k], sz = (1.05 + k * 0.22) * DPR; for (var n = 0; n < a.length; n += 2) b.fillRect(a[n], a[n + 1], sz, sz); }
      var vx = cam.x * DPR, vy = cam.y * DPR, vr = Math.max(w, h) * 0.5;
      var vg = b.createRadialGradient(vx, vy, 0, vx, vy, vr); vg.addColorStop(0, 'rgba(3,6,19,.9)'); vg.addColorStop(0.55, 'rgba(3,6,19,.62)'); vg.addColorStop(1, 'rgba(3,6,19,0)');
      b.fillStyle = vg; b.fillRect(0, 0, w, h);
    }

    // ───────────────────────────────────────────────────────── particles ──
    var parts = [], motes = [], coreEnergy = 0;
    var flowing = beads.filter(function (b) { return b.state === 'live' || b.state === 'merged'; });
    var PERIOD = Math.max(2.6, flowing.length * 7.5 / 620);
    flowing.forEach(function (b) { b.next = Math.random() * PERIOD; });
    beads.forEach(function (b) { if (b.state === 'active') { b.next = Math.random() * 5; for (var i = 0; i < 3; i++) motes.push({ b: b, a: Math.random() * 6.28, w: (0.7 + Math.random() * 0.9) * (i % 2 ? 1 : -1), r: b.r + 4 + Math.random() * 5, ph: Math.random() * 6.28 }); } });
    clusters.forEach(function (h) { if (h.state === 'active' && !h.spokes.length) for (var i = 0; i < 4; i++) motes.push({ b: h, a: Math.random() * 6.28, w: 0.5 + Math.random() * 0.6, r: 0, ph: Math.random() * 6.28, pill: true }); });
    var waitingDots = waitingTotal ? Math.min(150, 14 + waitingTotal * 7) : 0;
    var swarm = Array.from({ length: waitingDots }, function () { return { a: Math.random() * 6.28, w: 0.22 + Math.random() * 0.3, r: R_RING + (Math.random() - 0.5) * 11 }; });
    function spawn(b, attempt) {
      parts.push({ b: b, s: 0, seg: 0, v: 46 + Math.random() * 34, off: (Math.random() - 0.5) * 5, ph: Math.random() * 6.28, phase: 0, x: b.x, y: b.y, px: b.x, py: b.y, life: 0,
        end: attempt ? b.clusterAt * (0.35 + Math.random() * 0.35) : b.path.len, attempt: attempt });
    }
    function place(p) {
      var pts = p.b.path.pts, cum = p.b.path.cum, i = p.seg;
      while (i < pts.length - 2 && cum[i + 1] < p.s) i++;
      p.seg = i;
      var a = pts[i], c = pts[i + 1] || a, d = (cum[i + 1] - cum[i]) || 1, f = Math.min(1, Math.max(0, (p.s - cum[i]) / d));
      var tx = (c.x - a.x) / d, ty = (c.y - a.y) / d, squeeze = Math.min(1, (p.end - p.s) / 60 + 0.15);
      var o = (p.off + Math.sin(p.s * 0.045 + p.ph) * 1.6) * (p.b.state === 'live' ? squeeze : 1);
      p.px = p.x; p.py = p.y; p.x = a.x + (c.x - a.x) * f - ty * o; p.y = a.y + (c.y - a.y) * f + tx * o;
    }
    function update(dt) {
      flowing.forEach(function (b) { b.next -= dt; if (b.next <= 0) { b.next = PERIOD * (0.55 + Math.random() * 0.9); spawn(b, false); } });
      beads.forEach(function (b) { if (b.state === 'active') { b.next -= dt; if (b.next <= 0) { b.next = 3.5 + Math.random() * 4; spawn(b, true); } } });
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i]; p.life += dt;
        if (p.phase === 0) {
          p.s += p.v * dt * (p.attempt ? 0.55 : 1);
          if (p.s >= p.end) {
            if (p.attempt) { parts.splice(i, 1); continue; }
            if (p.b.state === 'live') { coreEnergy = Math.min(1.5, coreEnergy + 0.07); parts.splice(i, 1); continue; }
            p.phase = 1; p.a = Math.atan2(p.y, p.x); p.r = R_RING + (Math.random() - 0.5) * 11; p.t = 4 + Math.random() * 5; p.w = 0.5 + Math.random() * 0.45;
          } else place(p);
        } else {
          p.t -= dt; p.a += p.w * dt; p.px = p.x; p.py = p.y; p.x = Math.cos(p.a) * p.r; p.y = Math.sin(p.a) * p.r;
          if (p.t <= 0) parts.splice(i, 1);
        }
      }
      motes.forEach(function (m) { m.a += m.w * dt; });
      swarm.forEach(function (s) { s.a += s.w * dt; });
      coreEnergy *= Math.pow(0.25, dt);
    }

    // ───────────────────────────────────────────────────────── drawing ──
    function touches(n) {
      if (!person) return true;
      if (!roleFilter) return (n.people || []).indexOf(person) >= 0;
      return rolesOf(n, person).indexOf(roleFilter) >= 0 || (n.kind === 'cluster' && (waitBy.get(n.ref.id) || []).some(function (w) { return w.person === person && roleFilter === 'owner'; }));
    }
    function relight() {
      var f = focus || pinned, q = query.trim().toLowerCase();
      anyDim = !!(f || filterVis || q || person);
      nodes.forEach(function (n) { n.lit = !anyDim; });
      if (f) {
        f.lit = true;
        if (f.path) { f.cluster.lit = true; core.lit = true; ring.lit = true; f.spoke.forEach(function (b) { if (b.idx <= f.idx) b.lit = true; }); }
        else if (f.kind === 'cluster') { [].concat.apply([], f.spokes).forEach(function (b) { b.lit = true; }); core.lit = ring.lit = true; }
        else if (f.kind === 'core') { ring.lit = true; nodes.forEach(function (n) { if (n.state === 'live') n.lit = true; }); }
        else if (f.kind === 'ring') { nodes.forEach(function (n) { if (n.state === 'merged') n.lit = true; }); }
      } else if (anyDim) {
        nodes.forEach(function (n) {
          var plain = n.kind !== 'core' && n.kind !== 'ring';
          n.lit = (!filterVis || n.vis === filterVis) && (!q || (n.search || '').indexOf(q) >= 0) && touches(n) && (plain || (!q && !filterVis && !person));
        });
        core.lit = ring.lit = true;
      }
      clusters.forEach(function (h) { h.anyLit = h.lit || h.spokes.some(function (s) { return s.some(function (b) { return b.lit; }); }); });
      dirty = true;
    }
    var rgba = function (v, a) { return 'rgba(' + VIS[v].rgb + ',' + a + ')'; };
    function pill(x, y, w, h) { var r = h / 2; ctx.beginPath(); ctx.moveTo(x - w / 2 + r, y - r); ctx.lineTo(x + w / 2 - r, y - r); ctx.arc(x + w / 2 - r, y, r, -Math.PI / 2, Math.PI / 2); ctx.lineTo(x - w / 2 + r, y + r); ctx.arc(x - w / 2 + r, y, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); }
    function dot(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); }
    // A person's badge: their colour, their initials in white; a dashed amber ring when a gate waits on them.
    function badge(k, x, y, r, a, waits, t) {
      var p = P.get(k); if (!p) return;
      if (waits) {
        var pulse = 0.55 + 0.45 * Math.sin(t * 2.4);
        ctx.lineWidth = 1.3; ctx.setLineDash([2.2, 1.8]); ctx.strokeStyle = 'rgba(255,196,77,' + (pulse * a) + ')'; dot(x, y, r + 2.6); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.fillStyle = 'rgba(4,8,22,' + a + ')'; dot(x, y, r + 1.1); ctx.fill();
      ctx.fillStyle = 'rgba(' + HUES[p.hue % HUES.length] + ',' + a + ')'; dot(x, y, r); ctx.fill();
      if (person === k) { ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(235,242,255,' + a + ')'; dot(x, y, r + 1.6); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,' + a + ')'; ctx.font = '700 ' + (r * 0.95).toFixed(1) + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.initials, x, y + 0.3);
    }

    function draw(t) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, fx.width, fx.height);
      ctx.setTransform(DPR * cam.k, 0, 0, DPR * cam.k, DPR * cam.x, DPR * cam.y);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';

      clusters.forEach(function (h) {
        var a = anyDim ? (h.anyLit ? 1 : 0.16) : 1, live = h.counts.live || 0, wait = (h.counts.merged || 0) + (h.counts.unver || 0);
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(130,165,255,' + (0.2 * a) + ')'; ctx.stroke(h.links);
        var share = h.total ? (live + wait) / h.total : 0, v = live >= wait && live ? 'live' : wait ? 'merged' : null;
        ctx.lineWidth = 1.2 + Math.min(3.2, Math.log2(1 + live + wait) * 0.55);
        ctx.strokeStyle = v ? rgba(v, (0.12 + 0.3 * share) * a) : 'rgba(130,165,255,' + (0.14 * a) + ')'; ctx.stroke(h.trunk);
      });

      var pulse = 1 + Math.sin(t * 1.4) * 0.04 + coreEnergy * 0.12;
      ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(150,180,255,' + (ring.lit ? 0.42 : 0.15) + ')'; dot(0, 0, R_RING); ctx.stroke();
      ctx.lineWidth = 9; ctx.strokeStyle = 'rgba(120,150,255,' + (ring.lit ? 0.06 : 0.02) + ')'; dot(0, 0, R_RING); ctx.stroke();
      var cg = ctx.createRadialGradient(0, 0, 0, 0, 0, 68 * pulse);
      cg.addColorStop(0, 'rgba(235,245,255,' + (core.lit ? 1 : 0.4) + ')'); cg.addColorStop(0.22, 'rgba(120,180,255,' + (core.lit ? 0.95 : 0.3) + ')');
      cg.addColorStop(0.5, 'rgba(57,135,229,.34)'); cg.addColorStop(1, 'rgba(57,135,229,0)');
      ctx.fillStyle = cg; dot(0, 0, 68 * pulse); ctx.fill();

      ctx.globalCompositeOperation = 'lighter';
      ['live', 'merged', 'active'].forEach(function (v) {
        ctx.beginPath();
        parts.forEach(function (p) { if (p.b.state !== v || (anyDim && !p.b.lit)) return; ctx.moveTo(p.px - (p.x - p.px) * 2.2, p.py - (p.y - p.py) * 2.2); ctx.lineTo(p.x, p.y); });
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(' + VIS[v].glow + ',' + (v === 'active' ? 0.5 : 0.78) + ')'; ctx.stroke();
        ctx.fillStyle = 'rgba(' + VIS[v].glow + ',.95)'; ctx.beginPath();
        parts.forEach(function (p) { if (p.b.state !== v || (anyDim && !p.b.lit)) return; ctx.moveTo(p.x + 1.3, p.y); ctx.arc(p.x, p.y, 1.3, 0, 6.2832); });
        ctx.fill();
      });
      ctx.fillStyle = 'rgba(' + VIS.merged.glow + ',' + (ring.lit ? 0.8 : 0.25) + ')'; ctx.beginPath();
      swarm.forEach(function (s) { var x = Math.cos(s.a) * s.r, y = Math.sin(s.a) * s.r; ctx.moveTo(x + 1.2, y); ctx.arc(x, y, 1.2, 0, 6.2832); });
      ctx.fill();
      ctx.fillStyle = 'rgba(' + VIS.active.glow + ',.85)'; ctx.beginPath();
      motes.forEach(function (m) {
        if (anyDim && !m.b.lit) return;
        var rx = m.pill ? m.b.w / 2 + 5 : m.r + Math.sin(t * 1.3 + m.ph) * 1.6, ry = m.pill ? m.b.h / 2 + 5 : rx;
        var x = m.b.x + Math.cos(m.a) * rx, y = m.b.y + Math.sin(m.a) * ry; ctx.moveTo(x + 1.1, y); ctx.arc(x, y, 1.1, 0, 6.2832);
      });
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      beads.forEach(function (n) {
        var a = n.lit ? 1 : 0.16, v = n.vis, r = n.r;
        if (n.kind === 'branch' && n.cluster.clusterKind === 'epic') {
          ctx.beginPath(); ctx.moveTo(n.x, n.y - r - 1); ctx.lineTo(n.x + r + 1, n.y); ctx.lineTo(n.x, n.y + r + 1); ctx.lineTo(n.x - r - 1, n.y); ctx.closePath();
          ctx.fillStyle = rgba(v, a); ctx.fill(); return;
        }
        if (v === 'live') { ctx.fillStyle = rgba(v, 0.2 * a); dot(n.x, n.y, r * 2.3); ctx.fill(); ctx.fillStyle = rgba(v, a); dot(n.x, n.y, r); ctx.fill(); ctx.fillStyle = 'rgba(215,232,255,' + (0.85 * a) + ')'; dot(n.x, n.y, r * 0.36); ctx.fill(); }
        else if (v === 'merged') { ctx.fillStyle = rgba(v, a); dot(n.x, n.y, r); ctx.fill(); }
        else if (v === 'unver') { ctx.lineWidth = 1.4; ctx.strokeStyle = rgba(v, a); dot(n.x, n.y, r - 0.6); ctx.stroke(); ctx.fillStyle = rgba(v, a); dot(n.x, n.y, Math.max(1.1, r * 0.38)); ctx.fill(); }
        else if (v === 'active') { var kk = 0.5 + 0.5 * Math.sin(t * 2.2 + n.x); ctx.fillStyle = rgba(v, (0.16 + 0.14 * kk) * a); dot(n.x, n.y, r * (1.35 + 0.3 * kk) + 1.5); ctx.fill(); ctx.fillStyle = rgba(v, a); dot(n.x, n.y, r); ctx.fill(); }
        else if (v === 'planned') { ctx.fillStyle = 'rgba(4,8,22,' + a + ')'; dot(n.x, n.y, r - 0.7); ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = rgba(v, 0.9 * a); ctx.stroke(); }
        else { ctx.fillStyle = rgba(v, a); dot(n.x, n.y, r * 0.72); ctx.fill(); }
      });
      // What moved since the last saved map: a white halo for the first seconds.
      if (moved.size && t < 6) {
        var fade = 1 - t / 6, ph = 0.5 + 0.5 * Math.sin(t * 5);
        nodes.forEach(function (n) {
          if (!moved.has(n.mid)) return;
          ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(255,255,255,' + (0.85 * fade * (0.5 + 0.5 * ph)) + ')';
          if (n.path) { dot(n.x, n.y, n.r + 5 + ph * 2); ctx.stroke(); }
          else if (n.kind === 'cluster') { pill(n.x, n.y, n.w + 8 + ph * 3, n.h + 8 + ph * 3); ctx.stroke(); }
        });
      }
      var f = focus || pinned;
      if (f && f.path) { ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(235,242,255,.95)'; dot(f.x, f.y, f.r + 4); ctx.stroke(); }

      ctx.font = '600 9.5px system-ui, -apple-system, "Segoe UI", sans-serif'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3;
      beads.forEach(function (n) {
        if (n.kind !== 'story') return;
        var a = n.lit ? 0.95 : 0.2, x = n.x - n.side * 11;
        ctx.textAlign = n.side > 0 ? 'right' : 'left'; ctx.strokeStyle = 'rgba(4,8,22,' + a + ')'; ctx.strokeText(n.label, x, n.y + 0.5);
        ctx.fillStyle = 'rgba(214,224,246,' + a + ')'; ctx.fillText(n.label, x, n.y + 0.5);
      });
      // Initials badges, once close enough to read: a story's owner on the bead's inner shoulder (the outer
      // side is where its tasks and branches run, the story number sits further in).
      var show = Math.max(0, Math.min(1, (cam.k - 0.7) / 0.2));
      if (show > 0) beads.forEach(function (n) {
        if (n.kind !== 'story' || !n.ref.roles || !n.ref.roles.owner) return;
        badge(n.ref.roles.owner, n.x - n.side * 5.4, n.y - 5.6, 4.4, (n.lit ? 1 : 0.2) * show, false, t);
      });

      ctx.font = CLUSTER_FONT; ctx.textBaseline = 'middle';
      clusters.forEach(function (h) {
        var a = anyDim ? (h.anyLit ? 1 : 0.22) : 1, hot = f === h;
        pill(h.x, h.y, h.w, h.h); ctx.fillStyle = 'rgba(7,13,34,' + (0.94 * a) + ')'; ctx.fill();
        ctx.lineWidth = hot ? 2 : 1.2; ctx.strokeStyle = hot ? 'rgba(235,242,255,.95)' : h.vis ? rgba(h.vis, 0.95 * a) : 'rgba(150,180,255,' + (0.5 * a) + ')';
        if (h.vis === 'planned') ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = CLUSTER_FONT; ctx.textBaseline = 'middle';
        ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(234,240,255,' + a + ')'; ctx.fillText(h.label, h.x - h.w / 2 + 12, h.y + 0.5);
        if (h.frac) { ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(170,183,214,' + a + ')'; ctx.fillText(h.frac, h.x + h.w / 2 - 12, h.y + 0.5); }
        if (h.total) {
          var x = h.x - h.w / 2 + 12; var bw = h.w - 24, y = h.y + h.h / 2 + 4;
          ORDER.forEach(function (v) { var c = h.counts[v]; if (!c) return; var w = Math.max(2.5, bw * c / h.total - 1.5); ctx.fillStyle = rgba(v, (v === 'planned' || v === 'idle' ? 0.55 : 0.95) * a); ctx.fillRect(x, y, w, 2.6); x += w + 1.5; });
        }
        if (h.clusterKind === 'epic' && show > 0) {
          if (h.ref.roles && h.ref.roles.owner) badge(h.ref.roles.owner, h.x - h.w / 2 + 11, h.y - h.h / 2 - 1, 5.6, a * show, false, t);
          if (h.waitFor) badge(h.waitFor.person, h.x + h.w / 2 - 11, h.y - h.h / 2 - 1, 5.6, a * show, true, t);
        }
      });

      ctx.textAlign = 'center'; ctx.font = '700 10.5px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(234,240,255,' + (core.lit ? 0.96 : 0.4) + ')'; ctx.fillText('P R O D U C T I O N', 0, R_RING + 17);
      ctx.font = '700 9.5px system-ui, -apple-system, "Segoe UI", sans-serif';
      var rl = 'DEVELOPMENT' + (waitRepos.length ? ' · ' + waitingTotal + ' waiting' : '');
      ring.w = ctx.measureText(rl).width + 20; ring.h = 18;
      pill(ring.x, ring.y, ring.w, ring.h); ctx.fillStyle = 'rgba(7,13,34,.96)'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = (focus || pinned) === ring ? 'rgba(235,242,255,.95)' : 'rgba(' + VIS.merged.rgb + ',' + (ring.lit ? 0.85 : 0.3) + ')'; ctx.stroke();
      ctx.fillStyle = 'rgba(234,240,255,' + (ring.lit ? 0.95 : 0.4) + ')'; ctx.fillText(rl, ring.x, ring.y + 0.5);
    }

    // ─────────────────────────────────────────────────────── describing ──
    var stepWord = function (s) { return String(s || '').replace(/_/g, ' ').replace(/-/g, ' '); };
    function describe(n) {
      var d = { kind: '', title: '', vis: n.vis, stateText: '', desc: '', rows: [], who: [], note: '', notes: [], link: null, kids: [] };
      var r = n.ref;
      if (n.kind === 'core') {
        d.kind = 'The goal'; d.title = 'Production'; d.vis = 'live'; d.stateText = 'What users get';
        D.repos.filter(function (x) { return x.available && x.production; }).forEach(function (p) {
          d.rows.push([p.name, 'branch “' + p.productionBranch + '”' + (p.productionGuessed ? ' (guessed — set map.production in product.json)' : '') + ', last updated ' + fmtDate(p.production.date) + ' (' + ago(p.production.date) + ')' + (nameOf(p.production.by) ? ' by ' + nameOf(p.production.by) : '')]);
        });
        var miss = D.repos.filter(function (x) { return !x.available; }).map(function (x) { return x.name; });
        if (miss.length) d.note = 'Not on this machine, so not checked: ' + miss.join(', ') + '.';
        d.kids = nodes.filter(function (x) { return x.path && x.state === 'live'; });
      } else if (n.kind === 'ring') {
        d.kind = 'The gate before Production'; d.title = 'Development'; d.vis = 'merged';
        d.stateText = waitRepos.length ? waitingTotal + ' ' + (waitingTotal === 1 ? 'commit' : 'commits') + ' waiting for release' : 'Waiting room';
        d.desc = 'Finished work lands here first. It reaches Production at the next release.';
        D.repos.filter(function (x) { return x.available && x.integration; }).forEach(function (p) {
          d.rows.push([p.name, 'branch “' + p.integrationBranch + '”' + (p.waitingCommits != null ? ', ' + p.waitingCommits + ' waiting' : '') + ', last change ' + fmtDate(p.integration.date) + ' (' + ago(p.integration.date) + ')' + (nameOf(p.integration.by) ? ' by ' + nameOf(p.integration.by) : '')]);
        });
        var direct = D.repos.filter(function (x) { return x.available && x.productionAhead; }).map(function (p) { return p.name + ' ' + p.productionAhead; });
        if (direct.length) d.note = 'Production also holds commits that are not in Development (work merged straight to Production): ' + direct.join(', ') + '.';
        d.kids = nodes.filter(function (x) { return x.path && x.state === 'merged'; });
      } else if (n.kind === 'cluster' && n.clusterKind === 'epic') {
        d.kind = 'Epic' + (r.type ? ' · ' + r.type : ''); d.title = r.id; d.stateText = r.stateLabel; d.desc = r.title || '';
        var done = r.steps.filter(function (s) { return ['done', 'satisfied', 'skipped'].indexOf(s.status) >= 0; }).length;
        d.rows.push(['Planning', r.steps.length ? done + ' of ' + r.steps.length + ' steps closed, now at “' + stepWord(r.currentStep) + '”' : '—']);
        d.rows.push(['Stories', r.storyCount ? r.storiesShipped + ' of ' + r.storyCount + ' shipped' : 'none written yet']);
        if (r.taskCount) d.rows.push(['Tasks shipped', String(r.taskCount)]);
        if (r.repos && r.repos.length) d.rows.push(['Repos', r.repos.join(', ')]);
        if (r.createdAt) d.rows.push(['Created', fmtDate(r.createdAt)]);
        if (r.parent) d.rows.push(['Follows', r.parent]);
        var ro = r.roles || {};
        if (ro.owner) d.who.push(['Owner', [ro.owner]]);
        var byStep = {};
        (ro.stepOwners || []).forEach(function (x) { d.who.push(['Owns ' + stepWord(x.step), [x.person]]); });
        (ro.approvers || []).forEach(function (x) { (byStep[x.step] = byStep[x.step] || []).push(x.person); });
        Object.keys(byStep).forEach(function (s) { d.who.push(['Approved ' + stepWord(s).replace(/ review$/, ''), byStep[s]]); });
        (waitBy.get(r.id) || []).forEach(function (w) { d.notes.push(['wait', 'Waiting for ' + (nameOf(w.person) || 'someone (no owner recorded)') + ' — ' + stepWord(w.step) + '.']); });
        if (onePerson.has(r.id)) d.notes.push(['one', 'Every part of this epic so far is from one person.']);
        if (!r.onMain) d.note = 'Still being written on branch “' + r.sourceBranch + '”; not in this checkout yet.';
        d.kids = [].concat.apply([], n.spokes);
      } else if (n.kind === 'cluster') {
        d.kind = 'Branch group'; d.title = r.label; d.vis = null; d.desc = 'Branches that are not tied to an epic, grouped by their name.';
        ORDER.forEach(function (v) { if (n.counts[v]) d.rows.push([VIS[v].label, String(n.counts[v])]); });
        d.kids = [].concat.apply([], n.spokes);
      } else if (n.kind === 'story') {
        d.kind = 'Story'; d.title = r.id; d.stateText = r.stateLabel; d.desc = r.title || '';
        if (r.roles && r.roles.owner) d.who.push(['Owner', [r.roles.owner]]);
        if (r.repos.length) d.rows.push(['Repos', r.repos.join(', ')]);
        Object.keys(r.build || {}).forEach(function (repo) { var b = r.build[repo]; var k = b.steps.filter(function (s) { return s.status === 'done'; }).length; d.rows.push(['Build · ' + repo, k + ' of ' + b.steps.length + ' steps done, at “' + stepWord(b.currentStep) + '”']); });
        d.rows.push(['Tasks shipped', r.taskCount ? r.taskCount + ' (' + r.tasksLive + ' in Production)' : 'none yet']);
        if (r.state === 'merged' && r.verified === false) d.note = 'Some of its code lives in a repo that is not on this machine, so Production could not be checked.';
        d.kids = n.spoke.filter(function (b) { return b !== n; });
      } else if (n.kind === 'task') {
        d.kind = 'Task'; d.title = r.story + ' · ' + r.task;
        d.stateText = r.state === 'live' ? (r.via ? 'In Production (delivered on its own branch)' : 'Shipped and in Production') : r.verified ? 'Shipped, waiting in Development for release' : 'Shipped (per yadflow record)';
        d.rows.push(['Repo', r.repo]); if (r.branch) d.rows.push(['Branch', r.branch]);
        if (r.shippedAt) d.rows.push(['Shipped', fmtDate(r.shippedAt) + ' (' + ago(r.shippedAt) + ')']);
        if (r.roles && r.roles.builder) d.who.push(['Built by', [r.roles.builder]]);
        if (r.roles && r.roles.reviewers.length) d.who.push(['Reviewed by', r.roles.reviewers]);
        d.note = r.note || ''; if (/^https?:\/\//.test(r.pr || '')) d.link = { href: r.pr, text: 'Open the pull request' };
      } else {
        d.kind = 'Branch · ' + r.repo; d.title = r.name;
        d.stateText = r.state === 'live' ? 'Merged into Production' : r.state === 'merged' ? 'Merged into Development, waiting for release'
          : r.state === 'active' ? 'Not merged yet — ' + (r.ahead == null ? '?' : r.ahead) + ' ' + (r.ahead === 1 ? 'commit' : 'commits') + ' still to deliver' : 'Idle — no commits for ' + r.ageDays + ' days, never merged (' + (r.ahead == null ? '?' : r.ahead) + ' ' + (r.ahead === 1 ? 'commit' : 'commits') + ' left behind)';
        d.rows.push(['Last commit', fmtDate(r.date) + ' (' + ago(r.date) + ')']);
        if (r.roles && r.roles.builder) d.who.push(['Built by', [r.roles.builder]]);
        if (r.epic) d.rows.push(['Epic', r.epic]);
      }
      var mv = moved.get(n.mid);
      if (mv) d.notes.push(['one', mv.from ? 'Moved since ' + fmtDate(D.since) + ': ' + (VIS[mv.from] ? VIS[mv.from].short : mv.from) + ' → ' + (VIS[mv.to] ? VIS[mv.to].short : mv.to) + '.' : 'New since ' + fmtDate(D.since) + '.']);
      return d;
    }
    function avatar(k) { var p = P.get(k); var a = el('span', 'av h' + (p ? p.hue % 8 : 0), p ? p.initials : '?'); a.setAttribute('aria-hidden', 'true'); return a; }
    function fill(box, n, full) {
      var d = describe(n); box.textContent = '';
      box.append(el('div', 't-kind', d.kind), el('div', 't-title', d.title));
      if (d.stateText) { var s = el('div', 't-state'); if (d.vis) s.append(el('span', 'mk ' + d.vis)); s.append(el('span', '', d.stateText)); box.append(s); }
      if (d.desc) box.append(el('p', 't-desc', full ? d.desc : clip(d.desc, 150)));
      if (d.rows.length || d.who.length) {
        var dl = el('dl', 'rows');
        d.who.forEach(function (w) { var dd = el('dd'); w[1].forEach(function (k) { var span = el('span', 'who'); span.append(avatar(k), el('span', '', nameOf(k) || '—')); dd.append(span); }); dl.append(el('dt', '', w[0]), dd); });
        d.rows.forEach(function (row) { dl.append(el('dt', '', row[0]), el('dd', '', row[1])); });
        box.append(dl);
      }
      if (d.note) box.append(el('p', 'note', d.note));
      d.notes.forEach(function (x) { box.append(el('p', 'note ' + x[0], x[1])); });
      if (!full) return;
      if (d.link) { var p = el('p'), a = el('a', '', d.link.text); a.href = d.link.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; p.append(a); box.append(p); }
      if (d.kids.length) {
        box.append(el('h2', '', 'Contains (' + d.kids.length + ')')); var ul = el('ul', 'kids');
        d.kids.slice(0, 220).forEach(function (k) { var li = el('li'), b = el('button'); b.append(el('span', 'mk ' + k.vis), el('span', '', (k.kind === 'task' ? k.ref.story.replace(/^.*-(S\d+)$/, '$1') + ' ' : '') + k.label + (k.kind === 'story' && k.ref.title ? ' — ' + k.ref.title : ''))); b.title = describe(k).stateText; b.onclick = function () { pin(k); }; li.append(b); ul.append(li); });
        box.append(ul);
      }
    }

    // ───────────────────────────────────────────────────── interaction ──
    var tip = $('tip'), panel = $('panel');
    function hit(sx, sy) {
      var x = (sx - cam.x) / cam.k, y = (sy - cam.y) / cam.k, best = null, bd = Math.max(13, 11 / cam.k);
      beads.forEach(function (n) { var dd = Math.hypot(n.x - x, n.y - y) - n.r; if (dd < bd) { bd = dd; best = n; } });
      if (best && bd < 3) return best;
      for (var i = 0; i < clusters.length; i++) { var h = clusters[i]; if (Math.abs(x - h.x) <= h.w / 2 + 2 && Math.abs(y - h.y) <= h.h / 2 + 4) return h; }
      if (ring.w && Math.abs(x - ring.x) <= ring.w / 2 + 2 && Math.abs(y - ring.y) <= ring.h / 2 + 3) return ring;
      if (best) return best;
      if (Math.hypot(x, y) < 46 || (Math.abs(x) < 70 && Math.abs(y - R_RING - 17) < 9)) return core;
      if (Math.abs(Math.hypot(x, y) - R_RING) < 7) return ring;
      return null;
    }
    function showTip(n, sx, sy) {
      if (!n) { tip.style.display = 'none'; return; }
      fill(tip, n, false); tip.style.display = 'block';
      var r = tip.getBoundingClientRect(), right = panel.style.display === 'block' ? 372 : 12;
      tip.style.left = Math.max(8, Math.min(sx + 16, W - r.width - right)) + 'px';
      tip.style.top = Math.max(8, sy + 18 + r.height > H - 8 ? sy - r.height - 14 : sy + 18) + 'px';
    }
    function pin(n) {
      var was = !!pinned; pinned = n; panel.style.display = n ? 'block' : 'none';
      if (was !== !!n && !userMoved) fit();
      if (n) { fill(panel, n, true); var x = el('button', 'x', 'Close'); x.onclick = function () { pin(null); }; panel.prepend(x); panel.scrollTop = 0; }
      relight();
    }
    var drag = null;
    fx.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; fx.setPointerCapture(e.pointerId); }, on);
    fx.addEventListener('pointermove', function (e) {
      if (drag) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (drag.moved || Math.hypot(dx, dy) > 4) { drag.moved = true; cam.x = drag.cx + dx; cam.y = drag.cy + dy; userMoved = true; dirty = true; fx.classList.add('drag'); showTip(null); }
        return;
      }
      var n = hit(e.clientX, e.clientY);
      if (n !== focus) { focus = n; relight(); }
      fx.classList.toggle('hot', !!n); showTip(n, e.clientX, e.clientY);
    }, on);
    fx.addEventListener('pointerup', function (e) { var d = drag; drag = null; fx.classList.remove('drag'); if (d && !d.moved) { focus = hit(e.clientX, e.clientY); pin(focus); showTip(null); } }, on);
    fx.addEventListener('pointerleave', function () { if (!drag) { focus = null; relight(); showTip(null); } }, on);
    fx.addEventListener('wheel', function (e) { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); showTip(null); }, { passive: false, signal: ac.signal });
    fx.addEventListener('dblclick', fit, on);
    $('bIn').addEventListener('click', function () { zoomAt(W / 2, H / 2, 1.3); }, on);
    $('bOut').addEventListener('click', function () { zoomAt(W / 2, H / 2, 1 / 1.3); }, on);
    $('bFit').addEventListener('click', fit, on);
    var paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var bPause = $('bPause');
    var setPaused = function (p) { paused = p; bPause.setAttribute('aria-pressed', String(p)); bPause.textContent = p ? 'Play' : 'Pause'; };
    bPause.addEventListener('click', function () { setPaused(!paused); }, on);
    var q = $('q'); query = q.value;
    q.addEventListener('input', function (e) { query = e.target.value; relight(); if (listOpen) renderList(); }, on);
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (listOpen) toggleList(false); else if (!$('people').hidden) togglePeople(false); else pin(null); } }, on);
    window.addEventListener('resize', resize, on);

    // ──────────────────────────────────────────────────── the People lens ──
    var bPeople = $('bPeople'), pop = $('people'), plist = $('plist'), rolesBox = $('roles');
    function togglePeople(open) { pop.hidden = !open; bPeople.setAttribute('aria-expanded', String(open)); }
    bPeople.hidden = !(D.people && D.people.length);
    bPeople.addEventListener('click', function () { togglePeople(pop.hidden); }, on);
    $('pClear').addEventListener('click', function () { person = null; roleFilter = null; renderPeople(); relight(); }, on);
    var ROLES = [['owner', 'Owner'], ['builder', 'Builder'], ['reviewer', 'Reviewer'], ['approver', 'Approver']];
    function renderPeople() {
      rolesBox.textContent = ''; plist.textContent = '';
      ROLES.forEach(function (r) {
        var b = el('button', '', r[1]); b.type = 'button'; b.setAttribute('aria-pressed', String(roleFilter === r[0]));
        b.onclick = function () { roleFilter = roleFilter === r[0] ? null : r[0]; renderPeople(); relight(); };
        rolesBox.append(b);
      });
      (D.people || []).filter(function (p) { return !roleFilter || p.roles.indexOf(roleFilter) >= 0; }).forEach(function (p) {
        var li = el('li'), b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(person === p.key));
        b.append(avatar(p.key), el('span', '', p.name + (p.ambiguous ? ' (matches more than one member)' : '')), el('span', 'role', p.roles.join(' · ')));
        b.onclick = function () { person = person === p.key ? null : p.key; renderPeople(); relight(); };
        li.append(b); plist.append(li);
      });
    }
    renderPeople();

    // ──────────────────────────────────────────────── header + legend ──
    (function chrome() {
      var when = function (d) { return d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'unknown'; };
      var name = D.product && D.product.name ? D.product.name : 'Product';
      document.title = name + ' Progress Map';
      $('title').textContent = name + ' · Road to Production';
      var latest = liveRepos.map(function (r) { return r.fetchedAt; }).filter(Boolean).sort().pop() || (D.product && D.product.fetchedAt) || D.generatedAt;
      $('asof').textContent = 'Hover for details · click to pin · data from ' + when(latest) + (D.product && D.product.behind ? ' · this checkout is ' + D.product.behind + ' behind origin' : '');
      $('anon').hidden = !D.anonymous;
      var mb = $('moved');
      mb.hidden = !(D.moved && D.moved.length);
      if (D.moved && D.moved.length) {
        mb.textContent = D.moved.length + ' moved since ' + fmtDate(D.since);
        mb.onclick = function () {
          panel.style.display = 'block'; panel.textContent = '';
          var x = el('button', 'x', 'Close'); x.onclick = function () { pin(null); };
          panel.append(x, el('div', 't-kind', 'What moved'), el('div', 't-title', 'Since ' + fmtDate(D.since)));
          var ul = el('ul', 'kids');
          nodes.filter(function (n) { return moved.has(n.mid); }).forEach(function (n) { var li = el('li'), b = el('button'); b.append(el('span', 'mk ' + (n.vis || 'planned')), el('span', '', n.kind === 'cluster' ? n.ref.id : n.label + (n.kind === 'story' && n.ref.title ? ' — ' + n.ref.title : ''))); b.onclick = function () { pin(n); }; li.append(b); ul.append(li); });
          panel.append(ul);
        };
      }
      var tiles = $('tiles'); tiles.textContent = '';
      var tile = function (k, v, small, s, segs) {
        var t = el('div', 'tile glass'); t.append(el('div', 'k', k)); var vv = el('div', 'v', v); if (small) vv.append(' ', el('small', '', small)); t.append(vv);
        if (segs) { var m = el('div', 'meter'); var tot = segs.reduce(function (a, x) { return a + x[1]; }, 0) || 1; segs.forEach(function (sg) { if (!sg[1]) return; var i = el('i'); i.style.flex = String(sg[1] / tot); i.style.background = 'rgb(' + VIS[sg[0]].rgb + ')'; i.title = VIS[sg[0]].label + ': ' + sg[1]; m.append(i); }); t.append(m); }
        if (s) t.append(el('div', 's', s)); tiles.append(t);
      };
      var S = D.summary, cnt = function (list) { return ORDER.map(function (v) { return [v, list.filter(function (x) { return visOf(x) === v; }).length]; }); };
      var WORD = { live: 'in Production', merged: 'waiting', unver: 'unchecked', active: 'in progress', planned: 'not started', idle: 'idle' };
      var words = function (segs) { return segs.filter(function (x) { return x[1]; }).map(function (x) { return x[1] + ' ' + WORD[x[0]]; }).join(' · '); };
      var segs = cnt(D.epics); tile('Epics', String(S.epics.total), '', words(segs), segs);
      segs = cnt(D.stories); tile('Stories shipped', String(S.stories.shipped), 'of ' + S.stories.total, words(segs), segs);
      segs = cnt(D.tasks); var tl = segs[0][1], un = D.tasks.filter(function (t) { return t.verified === false; }).length;
      var gone = Array.from(new Set(D.tasks.filter(function (t) { return t.verified === false && !liveRepos.some(function (r) { return r.name === t.repo; }); }).map(function (t) { return t.repo; })));
      tile('Shipped tasks in Production', String(tl), 'of ' + S.tasks.total, un ? (gone.length ? un + ' can’t be checked: ' + gone.join(', ') + ' isn’t on this machine' : un + ' can’t be checked yet (hover one to see why)') : words(segs), segs);
      if (liveRepos.length) {
        var one = liveRepos.length === 1; segs = cnt(D.branches);
        var per = liveRepos.map(function (r) { var m = D.branches.filter(function (b) { return b.repo === r.name; }); return r.name + ' ' + m.filter(function (b) { return b.state === 'live'; }).length + '/' + m.length; }).join(' · ');
        tile(one ? liveRepos[0].name + ' branches in Production' : 'Branches in Production', String(segs[0][1]), 'of ' + D.branches.length, one ? words(segs.slice(1)) : per, segs);
        if (waitRepos.length) tile('Waiting in Development', String(waitingTotal), waitingTotal === 1 ? 'commit' : 'commits',
          one ? (mainRepo && mainRepo.production ? 'Production last updated ' + fmtDate(mainRepo.production.date) : '') : waitRepos.map(function (r) { return r.name + ' ' + r.waitingCommits; }).join(' · '));
      }
      var lg = $('legend'); lg.textContent = '';
      ORDER.forEach(function (v) {
        var c = beads.filter(function (b) { return b.vis === v; }).length + clusters.filter(function (h) { return h.vis === v; }).length; if (!c) return;
        var b = el('button'); b.setAttribute('aria-pressed', 'false'); b.title = VIS[v].label + ' — click to show only these';
        b.append(el('span', 'mk ' + v), el('span', '', VIS[v].short), el('span', 'n', String(c)));
        b.onclick = function () { filterVis = filterVis === v ? null : v; lg.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b && !!filterVis)); }); relight(); if (listOpen) renderList(); };
        lg.append(b);
      });
    })();

    // ───────────────────────────────────────────────────────── list view ──
    var listOpen = false, list = $('list');
    function whoText(n) { return n.people.map(nameOf).filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(', '); }
    function renderList() {
      var qq = query.trim().toLowerCase(); list.textContent = '';
      var bar = el('div', 'bar'), close = el('button', 'x', 'Back to map'); close.onclick = function () { toggleList(false); };
      bar.append(el('h2', '', 'Everything on the map'), el('span', '', (filterVis ? VIS[filterVis].label + ' only. ' : '') + (qq ? 'Matching “' + qq + '”.' : '') + (person ? ' ' + nameOf(person) + ' only.' : '')), close); list.append(bar);
      var tb = el('table'), hr = el('tr'); ['Item', 'Type', 'Status', 'Who', 'Last activity'].forEach(function (h) { hr.append(el('th', '', h)); }); tb.append(hr);
      var shown = 0;
      clusters.forEach(function (h) {
        var rows = [].concat.apply([], h.spokes).filter(function (n) { return (!filterVis || n.vis === filterVis) && (!qq || n.search.indexOf(qq) >= 0 || h.search.indexOf(qq) >= 0) && touches(n); });
        if (!rows.length && ((filterVis && h.vis !== filterVis) || (qq && h.search.indexOf(qq) < 0) || (person && !touches(h)))) return;
        var dh = describe(h), tr = el('tr', 'cluster'), td = el('td'); if (h.vis) td.append(el('span', 'mk ' + h.vis)); td.append(h.clusterKind === 'epic' ? h.ref.id : h.label);
        tr.append(td, el('td', '', dh.kind), el('td', '', dh.stateText || h.total + ' branches'), el('td', '', whoText(h)), el('td', '', h.ref.createdAt ? 'created ' + fmtDate(h.ref.createdAt) : '')); tb.append(tr);
        rows.forEach(function (n) {
          var d = describe(n), r = n.ref, row = el('tr'), c = el('td'); c.append(el('span', 'mk ' + n.vis), n.kind === 'story' ? r.id + ' — ' + clip(r.title || '', 90) : d.title);
          var when = fmtDate(r.date || r.shippedAt);
          row.append(c, el('td', '', d.kind.split(' · ')[0]), el('td', '', d.stateText), el('td', '', whoText(n)), el('td', '', when === '—' ? '' : when)); tb.append(row); shown++;
        });
      });
      list.append(tb); if (!shown) list.append(el('p', '', 'Nothing matches.'));
    }
    function toggleList(o) { listOpen = o; list.style.display = o ? 'block' : 'none'; if (o) renderList(); }
    $('bList').addEventListener('click', function () { toggleList(true); }, on);

    // ───────────────────────────────────────────────────────────── loop ──
    for (var i = 0; i < 420; i++) update(1 / 30);
    setPaused(paused); resize(); relight();
    var prev = performance.now(), frame = 0;
    function tick(now) {
      if (!alive) return;
      var dt = Math.min(0.05, (now - prev) / 1000); prev = now;
      if (!paused) { lastT += dt; update(dt); if (frame++ % 2 === 0) drawBg(lastT); draw(lastT); }
      else if (dirty) { drawBg(lastT); draw(lastT); }
      dirty = false; requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    window.__map = { nodes: nodes, clusters: clusters, cam: cam, D: D };
    return { stop: function () { alive = false; ac.abort(); pin(null); togglePeople(false); toggleList(false); } };
  }
})();
