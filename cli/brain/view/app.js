// The project brain's page (E177). It only DRAWS: what to show, the colours, sizes and filters all come
// from the view model built by cli/brain-view.mjs. Every name comes from a file anyone can edit, so text is
// only ever set with textContent — never innerHTML.
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
  function notice(parts) {
    var n = $('notice');
    clear(n);
    if (!parts) { n.hidden = true; return; }
    parts.forEach(function (p) { n.appendChild(p); });
    n.hidden = false;
  }

  // The model: inline in the file written by --html, or from the server, which needs the page's key.
  function load() {
    var inline = document.getElementById('yad-brain-data');
    if (inline) return Promise.resolve(JSON.parse(inline.textContent));
    var key = new URLSearchParams(location.search).get('t') || '';
    return fetch('graph.json?t=' + encodeURIComponent(key), { cache: 'no-store' }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(String(body.error || 'the brain could not be read') + (body.hint ? ' — ' + body.hint : ''));
        return body;
      });
    });
  }

  var FADED = 'rgba(148, 163, 184, 0.45)';
  var EDGE = 'rgba(71, 85, 105, 0.6)';
  var EDGE_INFERRED = 'rgba(100, 116, 139, 0.3)';

  // Label colours come from the page's theme (style.css), so a label is light on the dark theme and dark on the
  // light one. Sigma's own default is black text, and a white box on hover.
  function theme() {
    var css = getComputedStyle(document.documentElement);
    var get = function (name, fallback) { return (css.getPropertyValue(name) || '').trim() || fallback; };
    return { text: get('--text', '#0f172a'), panel: get('--panel', '#ffffff'), line: get('--line', '#e2e8f0') };
  }
  function drawHover(context, d, s) {
    if (!d.label) return; // a faded node has no label: no empty box
    var t = theme();
    var size = s.labelSize;
    context.font = s.labelWeight + ' ' + size + 'px ' + s.labelFont;
    var w = context.measureText(d.label || '').width;
    var x = d.x + d.size + 3; // where sigma draws the plain label, so it does not move on hover
    var y = d.y;
    context.fillStyle = t.panel;
    context.strokeStyle = t.line;
    context.lineWidth = 1;
    context.beginPath();
    if (context.roundRect) context.roundRect(x - 6, y - size / 2 - 5, w + 12, size + 10, 6); else context.rect(x - 6, y - size / 2 - 5, w + 12, size + 10);
    context.fill(); context.stroke();
    context.fillStyle = t.text;
    context.fillText(d.label || '', x, y + size / 3);
  }

  function start(model) {
    var nodes = model.nodes;
    var edges = model.edges;
    var outOf = nodes.map(function () { return []; });
    var into = nodes.map(function () { return []; });
    edges.forEach(function (e, k) { outOf[e.s].push(k); into[e.t].push(k); });

    var state = { work: true, code: true, allCode: false, filter: null, selected: null, near: null, found: null };

    // ---- the header
    var c = model.counts;
    var built = model.meta.builtAt ? new Date(model.meta.builtAt).toLocaleString() : 'an unknown time';
    $('summary').textContent = c.nodes + ' nodes (' + c.work + ' work, ' + c.code + ' code) · ' + c.edges + ' links · built ' + built;
    if (model.meta.codeBehind && model.meta.codeBehind.length) {
      $('fresh').textContent = 'The code moved in ' + model.meta.codeBehind.join(', ') + ' since this was built. Run yad brain build for a current picture.';
      $('fresh').hidden = false;
    }

    // ---- the key
    model.legend.forEach(function (k) {
      var li = el('li');
      var dot = el('span', null, 'dot');
      dot.style.background = k.colour;
      li.appendChild(dot);
      li.appendChild(el('span', k.legend));
      $('legend').appendChild(li);
    });

    // ---- the filters
    function fill(select, list) {
      list.forEach(function (f, i) {
        var o = el('option', f.label === f.id.replace(/^\w+:/, '') ? f.label : f.label + ' (' + f.id.replace(/^\w+:/, '') + ')');
        o.value = String(i);
        select.appendChild(o);
      });
    }
    fill($('f-epic'), model.filters.epics);
    fill($('f-story'), model.filters.stories);
    fill($('f-repo'), model.filters.repos);

    function shown(i) {
      var n = nodes[i];
      if (n.layer === 'work' && !state.work) return false;
      if (n.layer === 'code' && !state.code) return false;
      if (!state.allCode && !n.inDefault) return false;
      if (state.filter && !state.filter.has(i)) return false;
      return true;
    }

    // ---- the graph: every node that can be shown without "all the code", or every node with it
    var Graph = graphology.MultiDirectedGraph || graphology;
    var graph = null;
    var renderer = null;
    function build() {
      graph = new Graph();
      nodes.forEach(function (n, i) {
        if (!state.allCode && !n.inDefault) return;
        graph.addNode(String(i), { label: n.label, size: n.size, color: n.colour, x: 0, y: 0 });
      });
      edges.forEach(function (e, k) {
        if (graph.hasNode(String(e.s)) && graph.hasNode(String(e.t))) {
          graph.addEdgeWithKey(String(k), String(e.s), String(e.t), { size: e.confidence === 'EXTRACTED' ? 1 : 0.6, color: e.confidence === 'EXTRACTED' ? EDGE : EDGE_INFERRED });
        }
      });
      // The same brain draws the same picture: a circle to start from, then a fixed number of layout steps.
      graphologyLibrary.layout.circular.assign(graph);
      var order = graph.order;
      if (order > 1) {
        var settings = graphologyLibrary.layoutForceAtlas2.inferSettings(graph);
        settings.barnesHutOptimize = order > 800;
        graphologyLibrary.layoutForceAtlas2.assign(graph, { iterations: order < 500 ? 300 : order < 2000 ? 150 : 60, settings: settings });
      }
    }

    function neighbourSet(i) {
      var s = new Set([i]);
      outOf[i].forEach(function (k) { s.add(edges[k].t); });
      into[i].forEach(function (k) { s.add(edges[k].s); });
      return s;
    }

    function draw() {
      if (renderer) { renderer.kill(); renderer = null; }
      try {
        renderer = new Sigma(graph, $('graph'), {
          defaultEdgeType: 'arrow',
          labelRenderedSizeThreshold: 7,
          labelColor: { color: theme().text },
          labelFont: getComputedStyle(document.body).fontFamily,
          defaultDrawNodeHover: drawHover,
          zIndex: true,
          nodeReducer: function (key, data) {
            var i = Number(key);
            var res = Object.assign({}, data);
            if (!shown(i)) { res.hidden = true; return res; }
            // A faded node is never highlighted: sigma would draw an empty label box for it.
            if (state.selected !== null && !state.near.has(i)) { res.color = FADED; res.label = ''; res.zIndex = 0; return res; }
            if (state.selected !== null) { res.zIndex = 1; res.forceLabel = true; if (i === state.selected) res.highlighted = true; }
            if (state.found && state.found.has(i)) { res.highlighted = true; res.forceLabel = true; }
            return res;
          },
          edgeReducer: function (key, data) {
            var e = edges[Number(key)];
            var res = Object.assign({}, data);
            if (!shown(e.s) || !shown(e.t)) { res.hidden = true; return res; }
            if (state.selected !== null && e.s !== state.selected && e.t !== state.selected) res.hidden = true;
            return res;
          },
        });
      } catch {
        notice([el('strong', 'This browser cannot draw the graph. '), el('span', 'It needs WebGL, which is turned off or not available here. Search and the details panel still work.')]);
        return;
      }
      renderer.on('clickNode', function (ev) { if (!justDragged) select(Number(ev.node)); });
      renderer.on('clickStage', function () { if (!justDragged) select(null); });
      // Press and hold a node to drag it: it is selected at once, so its links stay lit while it moves, and the
      // camera holds still (no pan, no re-fit) until the button is let go.
      var dragged = null;
      var justDragged = false;
      renderer.on('downNode', function (ev) {
        // The left button only: sigma never reports a right or middle button's release, so such a drag would
        // never end.
        var o = ev.event.original;
        if (o && o.button !== undefined && o.button !== 0) return;
        dragged = ev.node;
        renderer.getContainer().style.cursor = 'grabbing';
        justDragged = false;
        if (!renderer.getCustomBBox()) renderer.setCustomBBox(renderer.getBBox());
        if (state.selected !== Number(ev.node)) select(Number(ev.node));
      });
      renderer.on('moveBody', function (ev) {
        if (dragged === null) return;
        // The button came up where no mouseup reached the page (the window lost focus): the drag is over.
        if (ev.event.original.buttons === 0 && !('touches' in ev.event.original)) { drop(); return; }
        var at = renderer.viewportToGraph(ev.event);
        graph.mergeNodeAttributes(dragged, { x: at.x, y: at.y });
        justDragged = true;
        ev.preventSigmaDefault();
        if (ev.event.original.cancelable) ev.event.original.preventDefault();
        ev.event.original.stopPropagation();
      });
      var drop = function () {
        if (dragged === null) return;
        dragged = null;
        renderer.getContainer().style.cursor = '';
        // The click that follows a drag must not select or clear anything.
        setTimeout(function () { justDragged = false; }, 0);
      };
      renderer.on('enterNode', function () { renderer.getContainer().style.cursor = 'grab'; });
      renderer.on('leaveNode', function () { if (dragged === null) renderer.getContainer().style.cursor = ''; });
      renderer.on('upNode', drop);
      renderer.on('upStage', drop);
      renderer.getMouseCaptor().on('mouseup', drop);
    }

    function refresh() { if (renderer) renderer.refresh(); }

    function focus(i) {
      if (!renderer || !graph.hasNode(String(i))) return;
      var d = renderer.getNodeDisplayData(String(i));
      if (d) renderer.getCamera().animate({ x: d.x, y: d.y, ratio: 0.35 }, { duration: 400 });
    }

    // ---- the details panel
    function row(dl, name, value) {
      if (value === undefined || value === null || value === '') return;
      dl.appendChild(el('dt', name));
      dl.appendChild(el('dd', value));
    }
    function linkList(title, ks, other) {
      var box = $('details');
      if (!ks.length) return;
      box.appendChild(el('h3', title + ' (' + ks.length + ')'));
      var ul = el('ul', null, 'links');
      ks.slice(0, 150).forEach(function (k) {
        var e = edges[k];
        var j = other(e);
        var n = nodes[j];
        var li = el('li');
        var b = el('button');
        b.type = 'button';
        b.appendChild(el('span', e.relation + (e.confidence === 'EXTRACTED' ? '' : ' · ' + e.confidence.toLowerCase()) + ' ', 'rel' + (e.confidence === 'EXTRACTED' ? '' : ' inferred')));
        b.appendChild(el('span', n.label));
        b.appendChild(el('span', ' ' + n.kind, 'rel'));
        b.addEventListener('click', function () { select(j, true); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      if (ks.length > 150) ul.appendChild(el('li', '… and ' + (ks.length - 150) + ' more', 'muted'));
      box.appendChild(ul);
    }
    function select(i, move) {
      // A node outside the drawn graph (code the work does not name): draw all the code first, when that is
      // small enough to do without asking.
      if (i !== null && graph && !graph.hasNode(String(i)) && !state.allCode && nodes.length <= model.warnAbove) {
        $('all-code').checked = true;
        state.allCode = true;
        build();
        draw();
      }
      state.selected = i;
      state.near = i === null ? null : neighbourSet(i);
      var box = $('details');
      clear(box);
      if (i === null) {
        box.appendChild(el('p', 'Click a node to see what it is and what it links to.', 'muted'));
        refresh();
        return;
      }
      var n = nodes[i];
      var kind = model.legend.find(function (k) { return k.kind === n.kind; });
      box.appendChild(el('span', kind ? kind.legend : n.kind, 'chip'));
      box.appendChild(el('h2', n.label));
      var dl = el('dl');
      row(dl, 'Id', n.id);
      row(dl, 'Repo', n.repo);
      row(dl, 'File', n.file ? n.file + (n.at ? ' ' + n.at : '') : null);
      row(dl, 'Step', n.step);
      row(dl, 'Status', n.status);
      row(dl, 'Type', n.type);
      row(dl, 'About', n.summary);
      box.appendChild(dl);
      if (n.missing) box.appendChild(el('p', 'A task declares this file, but the code graph does not hold it.', 'banner warn'));
      if (!shown(i)) box.appendChild(el('p', 'This node is hidden by the current filters or the "Show" choices.', 'muted small'));
      linkList('Links out', outOf[i], function (e) { return e.t; });
      linkList('Links in', into[i], function (e) { return e.s; });
      refresh();
      if (move) focus(i);
    }

    // ---- search
    $('search').addEventListener('input', function () {
      var q = this.value.trim().toLowerCase();
      var list = $('results');
      clear(list);
      if (!q) { state.found = null; refresh(); return; }
      // Best first: a label that IS the text, then one that starts with it, then one that holds it, then an id
      // or a file that holds it; the work items before the code at each level.
      var scored = [];
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var label = String(n.label).toLowerCase();
        var rank = label === q ? 0 : label.indexOf(q) === 0 ? 1 : label.indexOf(q) !== -1 ? 2
          : n.id.toLowerCase().indexOf(q) !== -1 || (n.file && n.file.toLowerCase().indexOf(q) !== -1) ? 3 : -1;
        if (rank !== -1) scored.push([rank * 2 + (n.layer === 'work' ? 0 : 1), i]);
      }
      scored.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
      var hits = scored.slice(0, 200).map(function (x) { return x[1]; });
      state.found = new Set(hits);
      hits.slice(0, 20).forEach(function (j) {
        var li = el('li');
        var b = el('button');
        b.type = 'button';
        b.appendChild(el('span', nodes[j].label));
        b.appendChild(el('span', ' ' + nodes[j].kind, 'rel'));
        b.addEventListener('click', function () { select(j, true); });
        li.appendChild(b);
        list.appendChild(li);
      });
      if (!hits.length) list.appendChild(el('li', 'Nothing matches.', 'muted'));
      else if (scored.length > 20) list.appendChild(el('li', scored.length + ' match; the best 20 are listed', 'muted small'));
      refresh();
    });

    // ---- the "Show" choices and the filters
    $('layer-work').addEventListener('change', function () { state.work = this.checked; refresh(); });
    $('layer-code').addEventListener('change', function () { state.code = this.checked; refresh(); });
    function drawAllCode(on) {
      state.allCode = on;
      build();
      draw();
      // A selected node the smaller view does not hold is let go, rather than drawing all the code again
      // (review 1: unticking "All the code" undid itself).
      select(state.selected !== null && graph.hasNode(String(state.selected)) ? state.selected : null);
    }
    $('all-code').addEventListener('change', function () {
      var box = this;
      if (box.checked && nodes.length > model.warnAbove) {
        box.checked = false;
        var go = el('button', 'Draw all ' + nodes.length + ' nodes', 'button');
        go.type = 'button';
        go.addEventListener('click', function () { notice(null); box.checked = true; drawAllCode(true); });
        var no = el('button', 'Keep the smaller view', 'button');
        no.type = 'button';
        no.addEventListener('click', function () { notice(null); });
        notice([el('p', 'The whole brain has ' + nodes.length + ' nodes. Drawing them all can make this tab slow for a while.'), go, el('span', ' '), no]);
        return;
      }
      drawAllCode(box.checked);
    });
    var selects = { epics: $('f-epic'), stories: $('f-story'), repos: $('f-repo') };
    Object.keys(selects).forEach(function (kind) {
      selects[kind].addEventListener('change', function () {
        Object.keys(selects).forEach(function (other) { if (other !== kind) selects[other].value = ''; });
        state.filter = this.value === '' ? null : new Set(model.filters[kind][Number(this.value)].nodes);
        select(null);
        if (renderer) renderer.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1 }, { duration: 300 });
      });
    });
    $('reset').addEventListener('click', function () {
      Object.keys(selects).forEach(function (k) { selects[k].value = ''; });
      state.filter = null;
      select(null);
    });

    build();
    draw();
    // The system switched between light and dark while the page is open: change the label colour in place, so the
    // camera stays where the person left it (the hover box reads the theme each time it draws).
    try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (renderer) renderer.setSetting('labelColor', { color: theme().text }); }); } catch { /* an old browser keeps its first colours */ }
  }

  load().then(start, function (err) {
    $('summary').textContent = 'The brain could not be loaded.';
    notice([el('strong', 'Nothing to draw. '), el('span', err && err.message ? err.message : String(err))]);
  });
})();
