// The Observatory — `yad brain view --live` (E178).
//
// The brain is a night sky. Each thing the agent does — a file read, a search, an edit, a command — arrives
// as an event already matched to the brain's nodes by cli/brain-activity.mjs; this page only draws it: a comet
// from the last node touched to the next, a pulse where it lands, and a heat that fades, so the sky slowly
// shows where the agent has worked. Every name comes from files anyone can edit, so text is only ever set
// with textContent.
/* global graphology, graphologyLibrary, Sigma */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  var OPS = {
    read: { colour: '#38bdf8', verb: 'Reading', rgb: [56, 189, 248] },
    search: { colour: '#fbbf24', verb: 'Searching', rgb: [251, 191, 36] },
    edit: { colour: '#f472b6', verb: 'Editing', rgb: [244, 114, 182] },
    run: { colour: '#a78bfa', verb: 'Running', rgb: [167, 139, 250] },
  };
  var OP_NAMES = ['read', 'search', 'edit', 'run'];
  var YAD_RGB = [52, 211, 153];
  var SKY = [10, 16, 40];
  var HALF_LIFE = 90000;          // heat halves every 90 s
  var SESSION_GAP = 20 * 60000;   // a quiet 20 min starts a new session window
  var IDLE_AFTER = 60000;
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SESSION_HUES = ['#38bdf8', '#f472b6', '#fbbf24', '#a78bfa', '#34d399', '#fb923c'];

  // ---- colour helpers
  function hexRgb(h) { var n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, k) { return [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * k); }); }
  function rgb(c, alpha) { return alpha === undefined ? 'rgb(' + c.join(',') + ')' : 'rgba(' + c.join(',') + ',' + alpha + ')'; }

  // ---- the model: inline in a replay file, or from the server
  function key() { return new URLSearchParams(location.search).get('t') || ''; }
  function load() {
    var inline = document.getElementById('yad-brain-data');
    if (inline) return Promise.resolve(JSON.parse(inline.textContent));
    return fetch('graph.json?t=' + encodeURIComponent(key()), { cache: 'no-store' }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(String(body.error || 'the brain could not be read') + (body.hint ? '. ' + body.hint : ''));
        return body;
      });
    });
  }

  function start(model) {
    var nodes = model.nodes;
    var edges = model.edges;
    var replayOnly = Array.isArray(model.replay);

    // ---- the plan: each declared file's tasks
    var plan = Array.isArray(model.plan) ? model.plan : [];
    var tasksOfFile = new Map();
    plan.forEach(function (p, i) { p.files.forEach(function (f) { if (!tasksOfFile.has(f)) tasksOfFile.set(f, []); tasksOfFile.get(f).push(i); }); });

    // ---- the sky: every node when the brain is small enough, else the work and the code it names
    var all = nodes.length <= model.warnAbove;
    var Graph = graphology.MultiDirectedGraph || graphology;
    var graph = new Graph();
    var rest = nodes.map(function (n) {
      var base = hexRgb(n.colour || '#94a3b8');
      return n.layer === 'work' ? mix(base, SKY, 0.25) : mix(base, SKY, n.inDefault ? 0.5 : 0.7);
    });
    nodes.forEach(function (n, i) {
      if (!all && !n.inDefault) return;
      graph.addNode(String(i), { label: n.label, size: n.layer === 'work' ? n.size * 1.05 : Math.max(1.6, n.size * (n.inDefault ? 0.75 : 0.5)), color: rgb(rest[i]), x: 0, y: 0 });
    });
    edges.forEach(function (e, k) {
      if (graph.hasNode(String(e.s)) && graph.hasNode(String(e.t))) {
        graph.addEdgeWithKey(String(k), String(e.s), String(e.t), { size: 0.4, color: nodes[e.s].layer === 'work' && nodes[e.t].layer === 'work' ? '#2a3561' : '#151d3d' });
      }
    });
    graphologyLibrary.layout.circular.assign(graph);
    if (graph.order > 1) {
      var settings = graphologyLibrary.layoutForceAtlas2.inferSettings(graph);
      settings.barnesHutOptimize = graph.order > 800;
      settings.scalingRatio = (settings.scalingRatio || 1) * 1.6;
      graphologyLibrary.layoutForceAtlas2.assign(graph, { iterations: graph.order < 500 ? 320 : graph.order < 2000 ? 160 : 70, settings: settings });
    }
    // A node outside the drawn sky that the agent touches is placed beside a neighbour that is drawn.
    function ensureNode(i) {
      var k = String(i);
      if (graph.hasNode(k)) return true;
      var near = null;
      edges.forEach(function (e) { if (near === null && e.t === i && graph.hasNode(String(e.s))) near = e.s; if (near === null && e.s === i && graph.hasNode(String(e.t))) near = e.t; });
      if (near === null) return false;
      var a = graph.getNodeAttributes(String(near));
      graph.addNode(k, { label: nodes[i].label, size: 2.4, color: rgb(rest[i]), x: a.x + (Math.random() - 0.5) * 30, y: a.y + (Math.random() - 0.5) * 30 });
      return true;
    }

    // ---- the state of the sky at a moment, rebuilt by replaying events
    var events = [];
    var S;
    var heatOn = true;
    function freshState() {
      return { heat: new Map(), counts: { read: 0, search: 0, edit: 0, run: 0 }, fileState: new Map(), touched: new Set(), unmapped: new Set(),
        outsidePlan: new Map(), task: null, tentative: false, lastNode: null, trail: [], last: null, lastAt: 0, named: [] };
    }
    S = freshState();
    var session = '';      // '' = every session
    var sessionsSeen = new Map();
    var mode = replayOnly ? 'replay' : 'live';   // 'live' | 'replay'
    var playhead = null;   // ms, while replaying
    var playing = false;
    var speed = 1;
    var span = 'session';

    function clock() { return mode === 'live' ? Date.now() : (playhead || 0); }
    function heatOf(i, at) {
      var h = S.heat.get(i);
      if (!h) return null;
      var k = Math.pow(0.5, Math.max(0, at - h.at) / HALF_LIFE);
      return { read: h.read * k, search: h.search * k, edit: h.edit * k, run: h.run * k, at: h.at, total: (h.read + h.search + h.edit + h.run) * k };
    }
    function addHeat(i, op, w, at) {
      var h = heatOf(i, at) || { read: 0, search: 0, edit: 0, run: 0 };
      h[op] += w;
      S.heat.set(i, { read: h.read, search: h.search, edit: h.edit, run: h.run, at: at });
    }

    // Apply one event to the state; with `animate`, also fly a comet to it.
    function apply(ev, animate) {
      if (session && ev.s !== session) return;
      // After a quiet stretch the plan starts over: last week's task is not today's (review 2).
      // After a quiet stretch every panel starts over — the plan, the counts, what was touched — so they all
      // cover the same time as the timeline's "This session" (review 3). The heat has faded by then anyway.
      if (S.lastAt && ev.t - S.lastAt > SESSION_GAP) { var heat = S.heat; S = freshState(); S.heat = heat; }
      S.counts[ev.op] += 1;
      S.last = ev;
      S.lastAt = ev.t;
      ev.hits.forEach(function (h) {
        S.touched.add(h.path);
        addHeat(h.node, ev.op, 1, ev.t);
        h.code.forEach(function (c) { addHeat(c, ev.op, 0.35, ev.t); });
        var n = nodes[h.node];
        if (n && n.kind === 'file') {
          var was = S.fileState.get(h.node);
          if (ev.op === 'edit' || !was) S.fileState.set(h.node, ev.op === 'edit' ? 'edit' : 'read');
          // THE TASK IN HAND follows EDITS only — reading around is not changing course (review 2). An edit to
          // a file the task's own story declares moves to that file's task; an edit to a file only ANOTHER
          // story declares is flagged as outside the plan, then followed (the agent has changed course); an
          // edit to a file no task declares is flagged. The first edit to a declared file picks the task.
          if (ev.op === 'edit') {
            var tasks = tasksOfFile.get(h.node) || [];
            var sameStory = S.task === null ? -1 : tasks.findIndex(function (t) { return plan[t].story === plan[S.task].story; });
            // A first pick from a file several stories declare is TENTATIVE: the next edit settles the story,
            // and moving then is not leaving the plan (review 3).
            var settling = S.tentative && sameStory === -1 && tasks.length;
            if (!tasks.length || (S.task !== null && sameStory === -1 && !settling)) S.outsidePlan.set(h.path, (S.outsidePlan.get(h.path) || 0) + 1);
            if (sameStory !== -1) { S.task = tasks[sameStory]; S.tentative = false; }
            else if (tasks.length) {
              S.task = tasks[0];
              S.tentative = !settling && new Set(tasks.map(function (t) { return plan[t].story; })).size > 1;
            }
          }
        }
        if (animate) launch(S.lastNode, h.node, ev);
        // Only the few nodes touched last carry a label, so the sky never fills with text.
        S.named = S.named.filter(function (x) { return x !== h.node; }).concat([h.node]).slice(-4);
        S.trail.push({ node: h.node, op: ev.op });
        if (S.trail.length > 12) S.trail.shift();
        S.lastNode = h.node;
      });
      // A searched folder: the files under it glow softly, and the strongest few pulse.
      (ev.areas || []).forEach(function (a, ai) {
        a.nodes.forEach(function (n, k) {
          addHeat(n, ev.op, 0.3, ev.t);
          if (animate && ai === 0 && k < 6 && ensureNode(n)) pulse(n, OPS[ev.op].rgb, 0.7, k * 70);
        });
      });
      ev.outside.forEach(function (p) {
        S.touched.add(p);
        S.unmapped.add(p);
        if (ev.op === 'edit') S.outsidePlan.set(p, (S.outsidePlan.get(p) || 0) + 1);
      });
      // A command lands on the task in hand: the pulse shows the agent is still at work there.
      if (!ev.hits.length && !(ev.areas && ev.areas.length) && animate) {
        var at = S.task !== null ? plan[S.task].task : S.lastNode;
        if (at !== null && at !== undefined) pulse(at, ev.yad ? YAD_RGB : OPS[ev.op].rgb, 1.3);
      }
    }
    // ---- the effects layer: comets, pulses, the trail
    var fx = $('fx');
    var ctx = fx.getContext('2d');
    var comets = [];
    var pulses = [];
    var renderer = null;
    function launch(from, to, ev) {
      if (!ensureNode(to)) return;
      var colour = ev.yad ? YAD_RGB : OPS[ev.op].rgb;
      if (REDUCED) { pulse(to, colour, 1); return; }
      if (from !== null && from !== to && graph.hasNode(String(from))) comets.push({ from: from, to: to, colour: colour, start: performance.now(), dur: 650 });
      pulse(to, colour, 1, from !== null && from !== to ? 520 : 0);
      follow(to);
      loop();
    }
    function pulse(node, colour, scale, delay) {
      if (!graph.hasNode(String(node))) return;
      pulses.push({ node: node, colour: colour, start: performance.now() + (delay || 0), dur: REDUCED ? 1 : 1200, scale: scale || 1 });
      loop();
    }
    function at(node) {
      var a = graph.getNodeAttributes(String(node));
      return renderer.graphToViewport({ x: a.x, y: a.y });
    }
    function sizeFx() {
      var r = fx.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      fx.width = Math.max(1, Math.round(r.width * dpr));
      fx.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function ease(x) { return 1 - Math.pow(1 - x, 3); }
    function drawFx(now) {
      var r = fx.getBoundingClientRect();
      ctx.clearRect(0, 0, r.width, r.height);
      if (!renderer) return false;
      ctx.globalCompositeOperation = 'lighter';
      // The trail: the last hops, faint, so the path stays readable.
      for (var i = 1; i < S.trail.length; i++) {
        var a = S.trail[i - 1];
        var b = S.trail[i];
        if (!graph.hasNode(String(a.node)) || !graph.hasNode(String(b.node)) || a.node === b.node) continue;
        var pa = at(a.node);
        var pb = at(b.node);
        ctx.strokeStyle = rgb(OPS[b.op].rgb, 0.05 + 0.18 * (i / S.trail.length));
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }
      var busy = false;
      comets = comets.filter(function (c) {
        var k = (now - c.start) / c.dur;
        if (k >= 1) return false;
        busy = true;
        var p0 = at(c.from);
        var p1 = at(c.to);
        var head = ease(Math.max(0, k));
        for (var j = 0; j < 24; j++) {
          var t = head - j * 0.022;
          if (t < 0) break;
          var x = p0.x + (p1.x - p0.x) * t;
          var y = p0.y + (p1.y - p0.y) * t;
          var alpha = (1 - j / 24) * 0.55;
          ctx.fillStyle = rgb(c.colour, alpha);
          ctx.beginPath(); ctx.arc(x, y, Math.max(0.6, 3.2 * (1 - j / 24)), 0, Math.PI * 2); ctx.fill();
        }
        var hx = p0.x + (p1.x - p0.x) * head;
        var hy = p0.y + (p1.y - p0.y) * head;
        var g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 16);
        g.addColorStop(0, rgb([255, 255, 255], 0.95));
        g.addColorStop(0.25, rgb(c.colour, 0.75));
        g.addColorStop(1, rgb(c.colour, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(hx, hy, 16, 0, Math.PI * 2); ctx.fill();
        return true;
      });
      pulses = pulses.filter(function (p) {
        var k = (now - p.start) / p.dur;
        if (k < 0) { busy = true; return true; }
        if (k >= 1 || !graph.hasNode(String(p.node))) return false;
        busy = true;
        var c = at(p.node);
        var radius = (6 + 42 * ease(k)) * p.scale;
        ctx.strokeStyle = rgb(p.colour, 0.85 * (1 - k));
        ctx.lineWidth = 2 * (1 - k) + 0.5;
        ctx.beginPath(); ctx.arc(c.x, c.y, radius, 0, Math.PI * 2); ctx.stroke();
        var g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 22 * p.scale);
        g.addColorStop(0, rgb(p.colour, 0.5 * (1 - k)));
        g.addColorStop(1, rgb(p.colour, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(c.x, c.y, 22 * p.scale, 0, Math.PI * 2); ctx.fill();
        return true;
      });
      ctx.globalCompositeOperation = 'source-over';
      return busy;
    }
    // One loop for everything that moves: effects every frame, the heat's fade a few times a second, and
    // replay. It stops when nothing moves.
    var looping = false;
    var lastRefresh = 0;
    var lastFrame = 0;
    function loop() {
      if (looping) return;
      looping = true;
      lastFrame = performance.now();
      window.requestAnimationFrame(frame);
    }
    function frame(now) {
      var dt = now - lastFrame;
      lastFrame = now;
      if (playing && mode === 'replay') advance(dt);
      var busy = drawFx(now);
      var warm = heatOn && S.heat.size && clock() - S.lastAt < HALF_LIFE * 6;
      if (renderer && (busy || warm) && now - lastRefresh > (busy ? 60 : 250)) { renderer.refresh({ skipIndexation: true }); lastRefresh = now; }
      if (busy || playing || (warm && mode === 'live')) window.requestAnimationFrame(frame);
      else { looping = false; if (renderer) renderer.refresh({ skipIndexation: true }); drawFx(now); }
    }

    // ---- sigma
    function reducer(nodeKey, data) {
      var i = Number(nodeKey);
      var res = Object.assign({}, data);
      if (!nodes[i]) return res;
      if (nodes[i].layer !== 'work') res.label = '';
      if (!heatOn) return res;
      var h = heatOf(i, clock());
      if (!h || h.total < 0.03) return res;
      var hot = OP_NAMES.reduce(function (best, op) { return h[op] > h[best] ? op : best; }, 'read');
      var k = Math.min(1, 0.3 + h.total * 0.45);
      res.color = rgb(mix(rest[i], OPS[hot].rgb, k));
      res.size = data.size * (1 + Math.min(1.8, h.total * 0.55));
      res.zIndex = 2;
      if (S.named.indexOf(i) !== -1 && clock() - h.at < 20000) { res.label = nodes[i].label; res.forceLabel = true; }
      return res;
    }
    function edgeReducer(edgeKey, data) {
      if (!heatOn) return data;
      var e = edges[Number(edgeKey)];
      var a = heatOf(e.s, clock());
      var b = heatOf(e.t, clock());
      if (!a || !b || a.total < 0.2 || b.total < 0.2) return data;
      return Object.assign({}, data, { color: rgb(mix([21, 29, 61], [150, 170, 240], Math.min(0.75, 0.2 + (a.total + b.total) * 0.12))), size: 0.9 });
    }
    // Labels on a dark sky: light text, and a dark pill on hover instead of sigma's white box.
    function drawHover(context, d, s) {
      var size = s.labelSize;
      context.font = s.labelWeight + ' ' + size + 'px ' + s.labelFont;
      var w = context.measureText(d.label || '').width;
      var x = d.x + d.size + 4;
      var y = d.y;
      context.fillStyle = 'rgba(10,16,36,0.92)';
      context.strokeStyle = 'rgba(173,190,255,0.25)';
      context.lineWidth = 1;
      context.beginPath();
      if (context.roundRect) context.roundRect(x - 6, y - size / 2 - 5, w + 12, size + 10, 6); else context.rect(x - 6, y - size / 2 - 5, w + 12, size + 10);
      context.fill(); context.stroke();
      context.fillStyle = '#e6ecff';
      context.fillText(d.label || '', x, y + size / 3);
    }
    try {
      renderer = new Sigma(graph, $('graph'), {
        nodeReducer: reducer,
        edgeReducer: edgeReducer,
        zIndex: true,
        labelColor: { color: '#c9d3f2' },
        labelSize: 12,
        labelWeight: '500',
        labelFont: getComputedStyle(document.body).fontFamily,
        labelRenderedSizeThreshold: 9,
        defaultDrawNodeHover: drawHover,
        stagePadding: 40,
      });
    } catch {
      $('empty').hidden = false;
      $('empty-title').textContent = 'This browser cannot draw the sky';
      $('empty-hint').textContent = 'It needs WebGL, which is turned off here. The Now card, the plan and the timeline still work.';
    }

    // ---- follow the agent
    var followOn = true;
    var lastFollow = 0;
    var userMoving = false;
    function follow(node) {
      if (!followOn || !renderer || userMoving) return;
      var t = performance.now();
      if (t - lastFollow < 900) return;
      lastFollow = t;
      var d = renderer.getNodeDisplayData(String(node));
      if (d) renderer.getCamera().animate({ x: d.x, y: d.y, ratio: Math.min(renderer.getCamera().ratio, 0.75) }, { duration: REDUCED ? 0 : 700 });
    }
    function setFollow(on, why) {
      followOn = on;
      $('t-follow').setAttribute('aria-pressed', String(on));
      if (why) toast(why);
    }
    var sky = $('graph');
    ['wheel', 'mousedown', 'touchstart'].forEach(function (type) {
      sky.addEventListener(type, function () {
        if (followOn) setFollow(false, 'Follow paused while you look around. Press F to follow again.');
      }, { passive: true });
    });
    var toastTimer = null;
    function toast(text) {
      var t = $('toast');
      t.textContent = text;
      t.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
    }
    $('t-follow').addEventListener('click', function () { setFollow(!followOn); });
    $('t-heat').addEventListener('click', function () {
      heatOn = !heatOn;
      this.setAttribute('aria-pressed', String(heatOn));
      if (renderer) renderer.refresh();
    });
    $('t-fit').addEventListener('click', function () { if (renderer) renderer.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }, { duration: 500 }); });

    // ---- inspecting a node
    if (renderer) {
      renderer.on('clickNode', function (ev) { inspect(Number(ev.node)); });
      renderer.on('clickStage', function () { $('inspect').hidden = true; });
    }
    function inspect(i) {
      var box = $('inspect');
      clear(box);
      var n = nodes[i];
      box.appendChild(el('strong', n.label));
      if (n.file || n.kind === 'file') box.appendChild(el('div', (n.repo ? n.repo + '/' : '') + (n.file || n.label) + (n.at ? ' ' + n.at : ''), 'ipath'));
      else box.appendChild(el('div', n.id, 'ipath'));
      var h = S.heat.get(i);
      var row = el('div', null, 'icounts');
      var touches = 0;
      events.forEach(function (ev) { if ((!session || ev.s === session) && ev.t <= clock() && ev.hits.some(function (x) { return x.node === i; })) touches += 1; });
      row.appendChild(el('span', touches ? 'Touched ' + touches + (touches === 1 ? ' time' : ' times') + ' in this window' : 'Not touched in this window'));
      box.appendChild(row);
      if (!h) box.appendChild(el('div', n.kind === 'code' ? 'A code symbol Graphify found.' : 'Part of the plan.', 'quiet small'));
      var d = renderer.getNodeDisplayData(String(i));
      var p = d ? renderer.framedGraphToViewport({ x: d.x, y: d.y }) : { x: 40, y: 40 };
      var r = $('graph').getBoundingClientRect();
      box.style.left = Math.min(r.width - 330, Math.max(8, p.x + 14)) + 'px';
      box.style.top = Math.min(r.height - 120, Math.max(8, p.y - 10)) + 'px';
      box.hidden = false;
    }

    // ---- the panels
    function ago(ms) {
      var s = Math.max(0, Math.round(ms / 1000));
      if (s < 60) return s + ' s ago';
      var m = Math.round(s / 60);
      if (m < 60) return m + ' min ago';
      return Math.round(m / 60) + ' h ago';
    }
    function nowText(ev) {
      if (!ev) return null;
      var verb = OPS[ev.op].verb;
      var target;
      if (ev.op === 'run') target = ev.yad ? 'yad ' + ev.yad : 'a shell command';
      else if (ev.hits.length) target = ev.hits[0].path;
      else if (ev.areas && ev.areas.length) target = ev.areas[0].path + '/';
      else if (ev.outside.length) target = ev.outside[0];
      else target = ev.op === 'search' ? 'the repo' : 'a file outside the repos';
      return { verb: verb, target: target, more: Math.max(0, ev.hits.length + (ev.areas || []).length + ev.outside.length - 1) };
    }
    var lastSaid = 0;
    function paintNow() {
      var t = nowText(S.last);
      if (!t) {
        $('now-op').textContent = 'Waiting';
        $('now-op').style.color = '';
        $('now-path').textContent = mode === 'live' ? 'for the agent\'s first move' : 'for the first event';
        $('now-path').classList.add('is-quiet');
        paintWhen();
        return;
      }
      var op = $('now-op');
      op.textContent = t.verb;
      op.style.color = S.last.yad ? rgb(YAD_RGB) : OPS[S.last.op].colour;
      $('now-path').textContent = t.target + (t.more ? '  and ' + t.more + ' more' : '');
      $('now-path').classList.remove('is-quiet');
      paintWhen();
      if (performance.now() - lastSaid > 2000) { $('now-say').textContent = t.verb + ' ' + t.target; lastSaid = performance.now(); }
    }
    function paintWhen() {
      if (!S.last) { $('now-when').textContent = ''; return; }
      $('now-when').textContent = mode === 'live' ? ago(Date.now() - S.last.t) : new Date(S.last.t).toLocaleTimeString();
    }
    function paintCounts() {
      OP_NAMES.forEach(function (op) { $('n-' + op).textContent = String(S.counts[op]); paintSpark(op); });
    }
    function paintSpark(op) {
      var c = $('sp-' + op);
      var r = c.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      var g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      var end = clock();
      var buckets = new Array(30).fill(0);
      events.forEach(function (ev) {
        if (ev.op !== op || ev.t > end || (session && ev.s !== session)) return;
        var b = Math.floor((end - ev.t) / 20000);
        if (b < 30) buckets[29 - b] += 1;
      });
      var max = Math.max(1, Math.max.apply(null, buckets));
      var w = r.width / 30;
      g.fillStyle = rgb(OPS[op].rgb, 0.18);
      g.fillRect(0, r.height - 1, r.width, 1);
      buckets.forEach(function (v, i) {
        if (!v) return;
        var h = Math.max(2, (v / max) * (r.height - 2));
        g.fillStyle = rgb(OPS[op].rgb, 0.35 + 0.65 * (i / 30));
        g.fillRect(i * w + 1, r.height - h, Math.max(1, w - 2), h);
      });
    }
    function paintPlan() {
      var box = $('plan-task');
      clear(box);
      if (S.task === null) {
        box.appendChild(el('p', plan.length ? 'When the agent touches a file a task declares, that task shows here with its files.' : 'No task in this brain declares files yet. Specs with a Files line per task fill this in.', 'quiet'));
        $('where-story').textContent = S.last ? 'Working' : 'No task yet';
        $('where-task').textContent = '';
      } else {
        var p = plan[S.task];
        var story = p.story !== null ? nodes[p.story].label : '';
        box.appendChild(el('p', story, 'story'));
        box.appendChild(el('p', nodes[p.task].label, 'task'));
        var edited = p.files.filter(function (f) { return S.fileState.get(f) === 'edit'; }).length;
        var meter = el('div', null, 'meter');
        var fill = el('span');
        fill.style.width = (p.files.length ? (100 * edited / p.files.length) : 0) + '%';
        meter.appendChild(fill);
        box.appendChild(meter);
        box.appendChild(el('p', edited + ' of ' + p.files.length + ' declared files edited', 'meter-l'));
        var ul = el('ul', null, 'files');
        p.files.forEach(function (f) {
          var st = S.fileState.get(f);
          var li = el('li', null, st === 'edit' ? 'is-edit' : st === 'read' ? 'is-read' : 'is-none');
          li.appendChild(el('span', st === 'edit' ? '✓' : st === 'read' ? '◐' : '○', 'st'));
          li.appendChild(el('span', nodes[f].label));
          li.title = st === 'edit' ? 'Edited' : st === 'read' ? 'Read, not edited yet' : 'Not touched yet';
          ul.appendChild(li);
        });
        box.appendChild(ul);
        $('where-story').textContent = story;
        $('where-task').textContent = nodes[p.task].label;
      }
      var out = $('plan-out-list');
      clear(out);
      S.outsidePlan.forEach(function (n, p) { out.appendChild(el('li', p + (n > 1 ? '  ×' + n : ''))); });
      $('plan-out').hidden = !S.outsidePlan.size;
      $('touched-n').textContent = String(S.touched.size);
      var un = $('unmapped-list');
      clear(un);
      S.unmapped.forEach(function (p) { un.appendChild(el('li', p)); });
      $('unmapped-n').textContent = String(S.unmapped.size);
      $('unmapped').hidden = !S.unmapped.size;
    }
    function paintMode() {
      var dot = $('pulse');
      var idle = mode === 'live' && (!S.last || Date.now() - S.last.t > IDLE_AFTER);
      dot.className = 'pulse ' + (mode === 'replay' ? 'is-replay' : idle ? 'is-idle' : 'is-live');
      $('mode').textContent = mode === 'replay' ? (replayOnly ? 'Replay' : 'Replaying') : idle ? 'Live, quiet' : 'Live';
      $('r-live').classList.toggle('is-on', mode === 'live');
      $('r-live').hidden = replayOnly;
      $('r-play').textContent = playing ? 'Pause' : 'Play';
    }
    function paintEmpty() {
      if (!renderer) return;
      var none = !events.length;
      $('empty').hidden = !none;
    }
    function paintAll() { paintNow(); paintCounts(); paintPlan(); paintMode(); paintEmpty(); paintRiver(); }

    // ---- sessions
    function noteSession(ev) {
      if (!ev.s || sessionsSeen.has(ev.s)) return;
      sessionsSeen.set(ev.s, sessionsSeen.size);
      var o = el('option', 'Session ' + sessionsSeen.size + ' (' + (ev.h === 'cursor' ? 'Cursor' : 'Claude Code') + ', from ' + new Date(ev.t).toLocaleTimeString() + ')');
      o.value = ev.s;
      o.style.color = SESSION_HUES[(sessionsSeen.size - 1) % SESSION_HUES.length];
      $('session').appendChild(o);
      $('sessions').hidden = sessionsSeen.size < 2;
    }
    $('session').addEventListener('change', function () { session = this.value; rebuild(mode === 'live' ? Infinity : playhead); });

    // ---- the river: the timeline
    var river = $('river');
    var rctx = river.getContext('2d');
    function windowOf() {
      var end = mode === 'live' ? Date.now() : Math.max(playhead || 0, events.length ? events[events.length - 1].t : 0);
      if (mode === 'live') end = Date.now();
      else if (events.length) end = Math.max(end, events[events.length - 1].t);
      var shown = shownEvents();
      var startT = shown.length ? shown[0].t : end - 600000;
      if (span === 'session' && shown.length) {
        for (var i = shown.length - 1; i > 0; i--) { if (shown[i].t - shown[i - 1].t > SESSION_GAP) { startT = shown[i].t; break; } }
      }
      if (end - startT < 60000) startT = end - 60000;
      var pad = (end - startT) * 0.02;
      return { from: startT - pad, to: end + pad };
    }
    function paintRiver() {
      var r = river.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      river.width = Math.max(1, Math.round(r.width * dpr));
      river.height = Math.max(1, Math.round(r.height * dpr));
      rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rctx.clearRect(0, 0, r.width, r.height);
      var w = windowOf();
      var lane = r.height / 4;
      OP_NAMES.forEach(function (op, li) {
        rctx.fillStyle = 'rgba(173,190,255,0.04)';
        rctx.fillRect(0, li * lane + 2, r.width, lane - 4);
      });
      var cut = clock();
      events.forEach(function (ev) {
        if (ev.t < w.from || ev.t > w.to) return;
        var x = ((ev.t - w.from) / (w.to - w.from)) * r.width;
        var li = OP_NAMES.indexOf(ev.op);
        var dim = (session && ev.s !== session) || ev.t > cut;
        rctx.fillStyle = rgb(ev.yad ? YAD_RGB : OPS[ev.op].rgb, dim ? 0.18 : 0.9);
        rctx.fillRect(Math.round(x), li * lane + 5, 2, lane - 10);
      });
      var px = ((cut - w.from) / (w.to - w.from)) * r.width;
      if (px >= 0 && px <= r.width) {
        rctx.fillStyle = mode === 'live' ? 'rgba(52,211,153,0.9)' : 'rgba(251,191,36,0.95)';
        rctx.fillRect(Math.round(px) - 1, 0, 2, r.height);
      }
      $('river-from').textContent = new Date(w.from).toLocaleTimeString();
      $('river-to').textContent = mode === 'live' ? 'now' : new Date(w.to).toLocaleTimeString();
    }
    function timeAt(clientX) {
      var r = river.getBoundingClientRect();
      var w = windowOf();
      return w.from + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (w.to - w.from);
    }
    var dragging = false;
    river.addEventListener('pointerdown', function (e) { dragging = true; river.setPointerCapture(e.pointerId); scrubTo(timeAt(e.clientX)); });
    river.addEventListener('pointermove', function (e) {
      if (dragging) scrubTo(timeAt(e.clientX));
      tip(e);
    });
    river.addEventListener('pointerup', function () { dragging = false; });
    river.addEventListener('pointerleave', function () { $('river-tip').hidden = true; });
    function tip(e) {
      var t = timeAt(e.clientX);
      var best = null;
      events.forEach(function (ev) { if (!best || Math.abs(ev.t - t) < Math.abs(best.t - t)) best = ev; });
      var box = $('river-tip');
      var w = windowOf();
      if (!best || Math.abs(best.t - t) > (w.to - w.from) / 60) { box.hidden = true; return; }
      var nt = nowText(best);
      clear(box);
      box.appendChild(el('b', nt.verb + ' '));
      box.appendChild(document.createTextNode(nt.target + '  ' + new Date(best.t).toLocaleTimeString()));
      var r = river.getBoundingClientRect();
      box.style.left = Math.min(r.width - 120, Math.max(120, e.clientX - r.left)) + 'px';
      box.hidden = false;
    }

    // ---- replay
    function rebuild(until) {
      S = freshState();
      comets = []; pulses = [];
      events.forEach(function (ev) { if (ev.t <= until) apply(ev, false); });
      if (renderer) renderer.refresh();
      paintAll();
      loop();
    }
    function scrubTo(t) {
      mode = 'replay';
      playing = false;
      playhead = t;
      rebuild(t);
    }
    // The events this view shows: every session, or the one picked.
    function shownEvents() { return session ? events.filter(function (ev) { return ev.s === session; }) : events; }
    function advance(dt) {
      var from = playhead;
      var to = playhead + dt * speed;
      // A quiet stretch is skipped: replay jumps to just before the next event, so it never plays dead air.
      var next = shownEvents().find(function (ev) { return ev.t > from; });
      if (next && next.t - from > 2500) { from = next.t - 600; to = from + dt * speed; }
      var launched = 0;
      events.forEach(function (ev) {
        if (ev.t > from && ev.t <= to) { apply(ev, launched < 4); launched += 1; }
      });
      playhead = to;
      if (launched) { paintNow(); paintCounts(); paintPlan(); }
      paintRiver();
      var shown = shownEvents();
      var last = shown.length ? shown[shown.length - 1].t : 0;
      if (playhead >= last) {
        playing = false;
        if (!replayOnly) goLive(); else paintMode();
      }
    }
    function play() {
      var shown = shownEvents();
      if (!shown.length) return;
      if (mode === 'live' || playhead === null || playhead >= shown[shown.length - 1].t) {
        var w = windowOf();
        var first = shown.find(function (ev) { return ev.t >= w.from; });
        mode = 'replay';
        playhead = (first ? first.t : w.from) - 400;
        rebuild(playhead);
      }
      playing = !playing;
      paintMode();
      loop();
    }
    function goLive() {
      mode = 'live';
      playing = false;
      playhead = null;
      rebuild(Infinity);
    }
    function step(dir) {
      var list = shownEvents();
      if (!list.length) return;
      var t = mode === 'live' ? Date.now() : playhead;
      var target = null;
      if (dir < 0) { for (var i = list.length - 1; i >= 0; i--) if (list[i].t < t - 1) { target = list[i]; break; } }
      else { for (var j = 0; j < list.length; j++) if (list[j].t > t + 1) { target = list[j]; break; } }
      if (!target) return;
      mode = 'replay';
      playing = false;
      playhead = target.t;
      rebuild(target.t);
      target.hits.forEach(function (h) { pulse(h.node, OPS[target.op].rgb, 1); follow(h.node); });
    }
    $('r-play').addEventListener('click', play);
    $('r-live').addEventListener('click', goLive);
    Array.prototype.forEach.call(document.querySelectorAll('.speed'), function (b) {
      b.addEventListener('click', function () {
        speed = Number(b.getAttribute('data-speed'));
        Array.prototype.forEach.call(document.querySelectorAll('.speed'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.span'), function (b) {
      b.addEventListener('click', function () {
        span = b.getAttribute('data-span');
        Array.prototype.forEach.call(document.querySelectorAll('.span'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        paintRiver();
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.target && e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
      if (e.key === ' ') { e.preventDefault(); play(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'f' || e.key === 'F') setFollow(!followOn, followOn ? 'Follow paused.' : 'Following the agent.');
      else if (e.key === 'l' || e.key === 'L') { if (!replayOnly) goLive(); }
      else if (e.key === 'h' || e.key === 'H') $('t-heat').click();
    });

    // ---- events in
    function take(ev) {
      noteSession(ev);
      events.push(ev);
      if (mode !== 'live') { paintRiver(); return; }
      apply(ev, true);
      paintAll();
    }
    function takeBacklog(list) {
      events = list.slice().sort(function (a, b) { return a.t - b.t; });
      events.forEach(noteSession);
      if (mode === 'live') rebuild(Infinity); else rebuild(playhead);
    }
    if (replayOnly) {
      takeBacklog(model.replay);
      $('mode').textContent = 'Replay';
      if (!events.length) { $('empty-title').textContent = 'Nothing was recorded'; $('empty-hint').textContent = 'This replay file holds no activity. Record some with "activity": true, then write the file again.'; }
      else { mode = 'replay'; playhead = events[events.length - 1].t; rebuild(playhead); }
    } else {
      var source = new EventSource('events?t=' + encodeURIComponent(key()));
      source.addEventListener('status', function (m) {
        var st = JSON.parse(m.data);
        if (!st.activity) {
          $('empty-title').textContent = 'The activity record is off';
          var hint = $('empty-hint');
          clear(hint);
          hint.appendChild(document.createTextNode('Set '));
          hint.appendChild(el('code', '"activity": true'));
          hint.appendChild(document.createTextNode(' in .sdlc/product.json, run '));
          hint.appendChild(el('code', 'yad check --fix'));
          hint.appendChild(document.createTextNode(', then start the agent.'));
        }
        if (st.brain && model.meta.inputs && st.brain !== model.meta.inputs) $('rebuilt').hidden = false;
      });
      source.addEventListener('backlog', function (m) { takeBacklog(JSON.parse(m.data)); });
      source.addEventListener('activity', function (m) { take(JSON.parse(m.data)); });
      source.addEventListener('rebuilt', function () { $('rebuilt').hidden = false; });
      source.addEventListener('error', function () { $('mode').textContent = 'Reconnecting'; });
      source.addEventListener('open', function () { paintMode(); });
    }

    // ---- the clock ticks the "s ago" and the idle state
    setInterval(function () { paintWhen(); paintMode(); if (mode === 'live') { OP_NAMES.forEach(paintSpark); paintRiver(); } }, 1000);
    window.addEventListener('resize', function () { sizeFx(); paintAll(); drawFx(performance.now()); });
    if (renderer) renderer.on('afterRender', function () { if (!looping) drawFx(performance.now()); });
    sizeFx();
    paintAll();
  }

  // ---- the stars: drawn once, behind everything
  function stars() {
    var c = document.getElementById('stars');
    var dpr = window.devicePixelRatio || 1;
    c.width = Math.round(window.innerWidth * dpr);
    c.height = Math.round(window.innerHeight * dpr);
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var count = Math.round((window.innerWidth * window.innerHeight) / 5200);
    for (var i = 0; i < count; i++) {
      var x = rnd() * window.innerWidth;
      var y = rnd() * window.innerHeight;
      var r = rnd() < 0.92 ? rnd() * 0.8 + 0.2 : rnd() * 1.4 + 0.8;
      g.fillStyle = 'rgba(214,224,255,' + (0.15 + rnd() * 0.55) + ')';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }
  stars();
  window.addEventListener('resize', stars);

  load().then(start, function (err) {
    $('mode').textContent = 'Not connected';
    $('empty').hidden = false;
    $('empty-title').textContent = 'The brain could not be loaded';
    $('empty-hint').textContent = err && err.message ? err.message : String(err);
  });
})();
