/* --- AGY-CONTEXT-MONITOR HUD START --- */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') { return; }
  if (window.__agyCtxHudInstalled) { return; }
  window.__agyCtxHudInstalled = true;

  var HOST_ID = 'agy-ctx-hud-host';
  var POLL_MS = 1000;
  var DOCK_MS = 1500;
  var OFFLINE_AFTER_MS = 20000;
  var RING_PX = 16;
  var RING_R = 6.5;
  var RING_STROKE = 1.5;
  var TRACK_COLOR = 'rgba(255,255,255,0.22)';
  var CIRC = 2 * Math.PI * RING_R;
  var C_TEAL = '#4fa3a3';
  var C_AMBER = '#d9a13b';
  var C_RED = '#e5534b';
  var C_OFF = '#6e7681';
  var MIC_RE = /mic|voice|speech|dictat|\u9ea6\u514b\u98ce|\u8bed\u97f3/i;
  var STOP_RE = /stop|record|\u505c\u6b62|\u5f55\u5236|\u5f55\u97f3/i;

  var fsNode = null;
  var pathNode = null;
  var ipcRenderer = null;
  try {
    if (typeof require === 'function') {
      try { fsNode = require('fs'); } catch (e) { fsNode = null; }
      try { pathNode = require('path'); } catch (e) { pathNode = null; }
      try {
        var electron = require('electron');
        ipcRenderer = electron && electron.ipcRenderer ? electron.ipcRenderer : null;
      } catch (e) { ipcRenderer = null; }
    }
  } catch (e) {
    fsNode = null;
    ipcRenderer = null;
  }

  function statusPath() {
    try {
      var env = (typeof process !== 'undefined' && process && process.env) ? process.env : {};
      var base = env.LOCALAPPDATA || null;
      if (!base && env.APPDATA) { base = env.APPDATA.replace(/Roaming$/i, 'Local'); }
      if (!base && env.USERPROFILE) { base = env.USERPROFILE + '\\AppData\\Local'; }
      if (!base || !pathNode) { return null; }
      return pathNode.join(base, 'agy-context-monitor', 'status.json');
    } catch (e) { return null; }
  }
  var STATUS_FILE = statusPath();

  function readStatusRaw() {
    if (ipcRenderer && typeof ipcRenderer.sendSync === 'function') {
      try {
        var viaIpc = ipcRenderer.sendSync('agy-ctx-read-status');
        if (viaIpc) { return String(viaIpc); }
      } catch (e) {}
    }
    if (fsNode && STATUS_FILE) {
      try { return fsNode.readFileSync(STATUS_FILE, 'utf8'); } catch (e) {}
    }
    return '';
  }

  function readStatus() {
    try {
      var raw = readStatusRaw();
      if (!raw) { return { offline: true }; }
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') { return { offline: true }; }
      var t = Date.parse(d.updatedAt);
      if (isNaN(t) || (Date.now() - t) > OFFLINE_AFTER_MS) { return { offline: true }; }
      return { offline: false, data: d };
    } catch (e) { return { offline: true }; }
  }

  function ringColor(pct, compression) {
    if (compression) { return C_AMBER; }
    if (pct >= 80) { return C_RED; }
    if (pct >= 50) { return C_AMBER; }
    return C_TEAL;
  }

  function shortSrc(s) {
    if (!s) { return '--'; }
    var str = String(s);
    var parts = str.split('.');
    var tail = parts.length > 1 ? parts.slice(-2).join('.') : parts[0];
    if (tail.length > 34) { tail = tail.slice(0, 15) + '...' + tail.slice(-15); }
    return tail;
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function labelText(el) {
    if (!el || !el.getAttribute) { return ''; }
    var s = '';
    try {
      s += ' ' + (el.getAttribute('aria-label') || '');
      s += ' ' + (el.getAttribute('title') || '');
      s += ' ' + (el.getAttribute('data-tooltip') || '');
      s += ' ' + (el.getAttribute('data-tip') || '');
      var lb = el.getAttribute('aria-labelledby') || '';
      if (lb) {
        var ids = lb.split(/\s+/);
        for (var i = 0; i < ids.length; i++) {
          if (!ids[i]) { continue; }
          var ref = document.getElementById(ids[i]);
          if (ref && ref.textContent) { s += ' ' + ref.textContent; }
        }
      }
    } catch (e) {}
    return s;
  }

  function inBottomBand(rect) {
    if (!rect) { return false; }
    var h = window.innerHeight || 800;
    var w = window.innerWidth || 1200;
    if (rect.width <= 0 || rect.height <= 0) { return false; }
    if (rect.bottom < h * 0.6) { return false; }
    if (rect.left > w || rect.right < 0 || rect.top > h || rect.bottom < 0) { return false; }
    return true;
  }

  function eachDocument(fn) {
    var docs = [document];
    try {
      var frames = document.querySelectorAll('iframe, webview');
      for (var i = 0; i < frames.length; i++) {
        try {
          var d = frames[i].contentDocument;
          if (d && d !== document) { docs.push(d); }
        } catch (e) {}
      }
    } catch (e) {}
    for (var j = 0; j < docs.length; j++) {
      try { fn(docs[j]); } catch (e2) {}
    }
  }

  function visibleButtons() {
    var out = [];
    eachDocument(function (doc) {
      var list;
      try { list = doc.querySelectorAll('button, [role="button"]'); }
      catch (e) { return; }
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        var r;
        try { r = el.getBoundingClientRect(); } catch (e) { continue; }
        if (!inBottomBand(r)) { continue; }
        if (r.width < 12 || r.width > 64 || r.height < 12 || r.height > 64) { continue; }
        out.push(el);
      }
    });
    return out;
  }

  function findComposerRoot() {
    var candidates = [];
    eachDocument(function (doc) {
      var inputs;
      try { inputs = doc.querySelectorAll('textarea, input, [contenteditable="true"]'); }
      catch (e) { return; }
      for (var i = 0; i < inputs.length; i++) {
        var r;
        try { r = inputs[i].getBoundingClientRect(); } catch (e) { continue; }
        if (r.width <= 0 || r.height <= 0) { continue; }
        var h = window.innerHeight || 800;
        if (r.top < h * 0.45) { continue; }
        candidates.push(inputs[i]);
      }
    });
    var target = candidates[candidates.length - 1] || null;
    if (!target) { return null; }
    var node = target;
    var h2 = window.innerHeight || 800;
    for (var d = 0; d < 8 && node && node !== document.body; d++) {
      var rr;
      try { rr = node.getBoundingClientRect(); } catch (e) { break; }
      if (rr.width > 280 && rr.bottom >= h2 * 0.8) { return node; }
      node = node.parentElement;
    }
    return (target && target.parentElement) ? target.parentElement : null;
  }

  function isReddish(el) {
    if (!el) { return false; }
    var nodes = [el];
    try { if (el.firstElementChild) { nodes.push(el.firstElementChild); } } catch (e) {}
    for (var i = 0; i < nodes.length; i++) {
      var cs = null;
      try { cs = window.getComputedStyle(nodes[i]); } catch (e) { continue; }
      if (!cs) { continue; }
      var bg = cs.backgroundColor || '';
      var m = bg.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      if (m) {
        var r = +m[1], g = +m[2], b = +m[3];
        if (r >= 170 && g <= 125 && b <= 125) { return true; }
      }
      var bd = cs.borderColor || cs.color || '';
      var m2 = bd.match(/\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (m2) {
        var r2 = +m2[1], g2 = +m2[2], b2 = +m2[3];
        if (r2 >= 170 && g2 <= 125 && b2 <= 125) { return true; }
      }
    }
    return false;
  }

  function findAnchor() {
    // Strategy 1: aria/title match in bottom band.
    try {
      var btns = visibleButtons();
      var hits = [];
      for (var i = 0; i < btns.length; i++) {
        if (MIC_RE.test(labelText(btns[i]))) { hits.push(btns[i]); }
      }
      if (hits.length) {
        hits.sort(function (a, b) {
          var ra = a.getBoundingClientRect();
          var rb = b.getBoundingClientRect();
          if (rb.top !== ra.top) { return rb.top - ra.top; }
          return rb.left - ra.left;
        });
        return hits[0];
      }
    } catch (e) {}

    // Strategy 2: icon button immediately LEFT of a small red stop/record control.
    try {
      var all = visibleButtons();
      var stops = [];
      for (var s = 0; s < all.length; s++) {
        var t = labelText(all[s]);
        if (STOP_RE.test(t) || isReddish(all[s])) { stops.push(all[s]); }
      }
      if (stops.length) {
        stops.sort(function (a, b) {
          return b.getBoundingClientRect().left - a.getBoundingClientRect().left;
        });
        var stop = stops[0];
        var sr = stop.getBoundingClientRect();
        var parent = stop.parentElement;
        var pool = (parent ? parent.querySelectorAll('button, [role="button"]') : all);
        var best = null;
        var bestLeft = -Infinity;
        for (var k = 0; k < pool.length; k++) {
          var c = pool[k];
          if (c === stop) { continue; }
          var cr;
          try { cr = c.getBoundingClientRect(); } catch (e2) { continue; }
          if (cr.width < 14 || cr.width > 44 || cr.height < 14 || cr.height > 44) { continue; }
          if (Math.abs(cr.top - sr.top) > 28) { continue; }
          if (cr.left < sr.left && cr.left > bestLeft) { bestLeft = cr.left; best = c; }
        }
        if (best) { return best; }
      }
    } catch (e) {}

    // Strategy 3: rightmost cluster of ~20-32px icon buttons in bottom composer.
    try {
      var root = findComposerRoot();
      var scope = root || document;
      var qsa = scope.querySelectorAll('button, [role="button"]');
      var icons = [];
      for (var j = 0; j < qsa.length; j++) {
        var el = qsa[j];
        var rr2;
        try { rr2 = el.getBoundingClientRect(); } catch (e3) { continue; }
        if (!inBottomBand(rr2)) { continue; }
        if (rr2.width < 16 || rr2.width > 40 || rr2.height < 16 || rr2.height > 40) { continue; }
        icons.push(el);
      }
      if (icons.length) {
        icons.sort(function (a, b) {
          return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
        });
        var rightmost = icons[icons.length - 1].getBoundingClientRect().right;
        var cluster = [];
        for (var m = icons.length - 1; m >= 0; m--) {
          var mr = icons[m].getBoundingClientRect();
          if (rightmost - mr.left > 140) { break; }
          cluster.unshift(icons[m]);
        }
        if (cluster.length) { return cluster[0]; }
        return icons[icons.length - 1];
      }
    } catch (e) {}

    return null;
  }

  function styleAsToolbarChip(host) {
    host.style.position = 'static';
    host.style.left = 'auto';
    host.style.top = 'auto';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.style.display = 'inline-flex';
    host.style.alignItems = 'center';
    host.style.justifyContent = 'center';
    host.style.flex = '0 0 auto';
    host.style.alignSelf = 'center';
    host.style.margin = '0 4px';
    host.style.padding = '0';
    host.style.background = 'transparent';
    host.style.border = 'none';
    host.style.boxShadow = 'none';
    host.style.zIndex = 'auto';
    host.style.pointerEvents = 'auto';
    host.style.verticalAlign = 'middle';
  }

  function fmtTokens(n) {
    var v = Number(n);
    if (!isFinite(v) || v < 0) { return '--'; }
    if (v >= 1000) {
      var k = v / 1000;
      var s = (k >= 100 ? String(Math.round(k)) : String(Math.round(k * 10) / 10).replace(/\.0$/, ''));
      return s + 'k';
    }
    try { return Math.round(v).toLocaleString('en-US'); }
    catch (e) { return String(Math.round(v)); }
  }

  function build() {
    if (document.getElementById(HOST_ID)) { return; }
    var host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-agy-hud', '1');
    styleAsToolbarChip(host);
    host.style.display = 'none';

    var sh;
    try { sh = host.attachShadow({ mode: 'closed' }); }
    catch (e) { return; }

    var css = [
      '.chip{pointer-events:auto;position:relative;display:inline-flex;align-items:center;gap:6px;',
      'background:transparent;border:none;box-shadow:none;padding:0;margin:0;',
      'cursor:default;user-select:none;-webkit-user-select:none;font-family:system-ui,Segoe UI,Arial,sans-serif;}',
      '.ring{position:relative;width:' + RING_PX + 'px;height:' + RING_PX + 'px;flex:0 0 auto;',
      'display:inline-flex;align-items:center;justify-content:center;background:transparent;}',
      '.svg{display:block;width:' + RING_PX + 'px;height:' + RING_PX + 'px;transform:rotate(-90deg);}',
      '.tip{position:absolute;left:50%;transform:translateX(-50%);bottom:' + (RING_PX + 10) + 'px;',
      'display:none;min-width:170px;max-width:250px;white-space:nowrap;text-align:center;',
      'background:rgba(28,28,28,0.96);border:none;border-radius:12px;',
      'padding:10px 12px;color:#d7d7d7;font-size:12px;line-height:1.7;',
      'cursor:default;z-index:10;}',
      '.tip.on{display:block;}',
      '.t-title{font-weight:500;font-size:12px;color:#efefef;margin-bottom:2px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:226px;}',
      '.t-line{white-space:nowrap;text-align:center;}',
      '.t-warn{color:#e8b93e;font-weight:600;white-space:normal;word-break:break-word;text-align:center;}'
    ].join('');

    var style = document.createElement('style');
    style.textContent = css;

    var chip = document.createElement('div');
    chip.className = 'chip';
    chip.setAttribute('tabindex', '0');

    var ring = document.createElement('div');
    ring.className = 'ring';

    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'svg');
    svg.setAttribute('width', String(RING_PX));
    svg.setAttribute('height', String(RING_PX));
    svg.setAttribute('viewBox', '0 0 ' + RING_PX + ' ' + RING_PX);
    var track = document.createElementNS(NS, 'circle');
    track.setAttribute('cx', String(RING_PX / 2));
    track.setAttribute('cy', String(RING_PX / 2));
    track.setAttribute('r', String(RING_R));
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', TRACK_COLOR);
    track.setAttribute('stroke-width', String(RING_STROKE));
    var prog = document.createElementNS(NS, 'circle');
    prog.setAttribute('cx', String(RING_PX / 2));
    prog.setAttribute('cy', String(RING_PX / 2));
    prog.setAttribute('r', String(RING_R));
    prog.setAttribute('fill', 'none');
    prog.setAttribute('stroke', C_OFF);
    prog.setAttribute('stroke-width', String(RING_STROKE));
    prog.setAttribute('stroke-linecap', 'round');
    prog.setAttribute('stroke-dasharray', String(CIRC));
    prog.setAttribute('stroke-dashoffset', String(CIRC));
    svg.appendChild(track);
    svg.appendChild(prog);

    var tip = document.createElement('div');
    tip.className = 'tip';

    ring.appendChild(svg);
    chip.appendChild(ring);
    chip.appendChild(tip);
    sh.appendChild(style);
    sh.appendChild(chip);

    chip.addEventListener('mouseenter', function () { tip.classList.add('on'); });
    chip.addEventListener('mouseleave', function () { tip.classList.remove('on'); });
    chip.addEventListener('focus', function () { tip.classList.add('on'); });
    chip.addEventListener('blur', function () { tip.classList.remove('on'); });

    function textLine(str, warn) {
      var p = document.createElement('div');
      p.className = warn ? 't-warn' : 't-line';
      p.textContent = str;
      return p;
    }

    function render() {
      var st = readStatus();
      while (tip.firstChild) { tip.removeChild(tip.firstChild); }
      if (st.offline) {
        prog.setAttribute('stroke', C_OFF);
        prog.setAttribute('stroke-dashoffset', String(CIRC));
        var t0 = document.createElement('div');
        t0.className = 't-title';
        t0.textContent = '\u80cc\u666f\u4fe1\u606f\u7a97\u53e3\uff1a';
        tip.appendChild(t0);
        tip.appendChild(textLine('\u79bb\u7ebf\uff0c\u672a\u8bfb\u53d6\u5230\u72b6\u6001', false));
        return;
      }
      var d = st.data;
      if (d.state && d.state !== 'live') {
        prog.setAttribute('stroke', C_OFF);
        prog.setAttribute('stroke-dashoffset', String(CIRC));
        var tw = document.createElement('div');
        tw.className = 't-title';
        tw.textContent = '\u80cc\u666f\u4fe1\u606f\u7a97\u53e3\uff1a';
        tip.appendChild(tw);
        var waitMsg = '\u7b49\u5f85\u8bed\u8a00\u670d\u52a1\u5668';
        if (d.state === 'waiting-ag' || d.state === 'no-install') waitMsg = '\u7b49\u5f85 Antigravity';
        else if (d.state === 'no-session') waitMsg = '\u6682\u65e0\u4f1a\u8bdd';
        tip.appendChild(textLine(waitMsg, false));
        return;
      }
      var pct = Number(d.usagePercent);
      if (!isFinite(pct) && isFinite(Number(d.contextUsed)) && isFinite(Number(d.contextLimit)) && Number(d.contextLimit) > 0) {
        pct = (Number(d.contextUsed) / Number(d.contextLimit)) * 100;
      }
      if (!isFinite(pct)) { pct = 0; }
      pct = clamp(pct, 0, 100);
      var comp = d.compressionDetected === true;
      var rewind = d.rewindDetected === true;
      var col = ringColor(pct, comp);
      prog.setAttribute('stroke', col);
      prog.setAttribute('stroke-dashoffset', String(CIRC * (1 - pct / 100)));
      var n = Math.round(pct);

      var title = document.createElement('div');
      title.className = 't-title';
      title.textContent = '\u80cc\u666f\u4fe1\u606f\u7a97\u53e3\uff1a';
      tip.appendChild(title);
      tip.appendChild(textLine(n + '% \u5df2\u7528\uff08\u5269\u4f59 ' + (100 - n) + '%\uff09', false));
      var usedFmt = fmtTokens(d.contextUsed);
      var limitFmt = fmtTokens(d.contextLimit);
      var detail = '\u5df2\u7528 ' + usedFmt + ' \u6807\u8bb0\uff0c\u5171 ' + limitFmt;
      if (usedFmt === '--' && limitFmt === '--') {
        detail = String(d.contextLabel || d.remainingLabel || '--');
      }
      tip.appendChild(textLine(detail, false));
      if (comp) { tip.appendChild(textLine('\u6ce8\u610f\uff1a\u68c0\u6d4b\u5230\u4e0a\u4e0b\u6587\u538b\u7f29', true)); }
      else if (rewind) { tip.appendChild(textLine('\u6ce8\u610f\uff1a\u68c0\u6d4b\u5230\u4e0a\u4e0b\u6587\u56de\u7ed5', true)); }
    }

    function dock() {
      var anchor = null;
      try { anchor = findAnchor(); } catch (e) { anchor = null; }
      if (!anchor || !anchor.parentNode) {
        host.style.display = 'none';
        return false;
      }
      styleAsToolbarChip(host);
      try {
        if (host.parentNode !== anchor.parentNode || host.nextSibling !== anchor) {
          anchor.parentNode.insertBefore(host, anchor);
        }
      } catch (e) { return false; }
      if (host.style.display === 'none') { styleAsToolbarChip(host); }
      return true;
    }

    render();
    window.setInterval(render, POLL_MS);

    dock();
    window.setInterval(dock, DOCK_MS);

    var pending = false;
    function scheduleDock() {
      if (pending) { return; }
      pending = true;
      var run = function () {
        pending = false;
        try { dock(); } catch (e) {}
      };
      try {
        if (typeof window.requestAnimationFrame === 'function') { window.requestAnimationFrame(run); }
        else { window.setTimeout(run, 0); }
      } catch (e) { run(); }
    }

    try {
      var mo = new MutationObserver(function () { scheduleDock(); });
      mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch (e) {}
  }

  if (document.body) { build(); }
  else { document.addEventListener('DOMContentLoaded', build, { once: true }); }
})();
/* --- AGY-CONTEXT-MONITOR HUD END --- */
