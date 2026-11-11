/* =========================================================================
   408 考点演化图谱 · 力导向图引擎
   纯 Canvas 2D，无依赖。
   - 物理模拟：节点斥力 + 连线弹簧 + 归属锚点 + 碰撞分离
   - 交互：拖拽节点 / 拖拽画布 / 滚轮缩放 / 点击展开知识点
   - 视觉：连线流光、脉冲圈、按科目着色、悬停降噪
   ========================================================================= */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;
  var FONT = '"PingFang SC","Microsoft YaHei","HarmonyOS Sans SC",system-ui,sans-serif';
  var MONO = '"JetBrains Mono","SFMono-Regular",Consolas,ui-monospace,monospace';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function ForceGraph(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = options || {};
    this.dpr = Math.min(global.devicePixelRatio || 1, 2);
    this.width = 0;
    this.height = 0;

    this.nodes = [];
    this.byId = {};
    this.links = [];

    this.view = { x: 0, y: 0, scale: 1 };
    this.alpha = 1;
    this.hover = null;
    this.selected = null;
    this.highlight = null;
    this.highlightChapters = null;
    this.filter = null;
    this.insets = { left: 0, right: 0, top: 0, bottom: 0 };
    this.pulses = [];
    this.flows = [];

    this.handlers = { hover: [], click: [], dblclick: [], view: [] };
    this._raf = null;
    this._frame = 0;
    this._t0 = performance.now();
    this._pointer = { down: false, node: null, moved: false, x: 0, y: 0, vx: 0, vy: 0 };
    this._pan = { active: false, x: 0, y: 0, vx: 0, vy: 0 };
    this._tween = null;

    this._bind();
    this._resize();
  }

  ForceGraph.prototype.on = function (name, fn) {
    if (!this.handlers[name]) this.handlers[name] = [];
    this.handlers[name].push(fn);
    return this;
  };

  ForceGraph.prototype._emit = function (name, payload) {
    (this.handlers[name] || []).forEach(function (fn) { fn(payload); });
  };

  /* ---------------------------------------------------------------- 数据 */

  /**
   * @param {Array} hubs     科目枢纽 [{id,name,score,color}]
   * @param {Array} chapters 章节 [{id,name,sub,heat,choice,comp,points:[{name,heat}],dagy}]
   */
  ForceGraph.prototype.load = function (hubs, chapters) {
    var rnd = mulberry32(408);
    var self = this;
    this.nodes = [];
    this.links = [];
    this.byId = {};

    var hubNodes = hubs.map(function (h, i) {
      var angle = (i / hubs.length) * TAU + Math.PI / 4;
      var n = self._node({
        id: 'hub:' + h.id, type: 'hub', sub: h.id, label: h.name,
        short: h.short, score: h.score, color: h.color, heat: 0,
        r: 34, x: Math.cos(angle) * 300, y: Math.sin(angle) * 200,
        homeK: 0.5, fixed: true
      });
      n.anchorAngle = angle;
      return n;
    });

    var bySub = {};
    hubNodes.forEach(function (n) { bySub[n.sub] = n; });

    var chapterNodes = chapters.map(function (c, idx) {
      var hub = bySub[c.sub];
      var sibs = chapters.filter(function (x) { return x.sub === c.sub; });
      var i = sibs.indexOf(c);
      var spread = Math.PI * (sibs.length > 6 ? 1.2 : 1.0);
      var base = hub.anchorAngle;
      var a = base - spread / 2 + (sibs.length === 1 ? 0 : spread * (i / (sibs.length - 1)));
      var radius = 118 + (i % 3) * 24;
      var n = self._node({
        id: 'ch:' + c.id, type: 'chapter', sub: c.sub, label: c.name,
        color: hub.color, heat: c.heat, choice: c.choice, comp: c.comp,
        chapterId: c.id, r: 4 + Math.sqrt(c.heat) * 0.62,
        x: hub.x + Math.cos(a) * radius + (rnd() - 0.5) * 20,
        y: hub.y + Math.sin(a) * radius + (rnd() - 0.5) * 20,
        homeK: 0.028,
        points: c.points
      });
      self.links.push({ s: hub, t: n, kind: 'hub', dist: 120 });
      hub._deg = (hub._deg || 0) + 1;
      return n;
    });

    this.hubs = hubNodes;
    this.chapters = chapterNodes;
    this._fitInitial();
  };

  ForceGraph.prototype._node = function (o) {
    var n = {
      id: o.id, type: o.type, sub: o.sub, label: o.label, short: o.short,
      color: o.color, heat: o.heat || 0, choice: o.choice, comp: o.comp,
      chapterId: o.chapterId, points: o.points,
      r: o.r || 6, x: o.x, y: o.y, vx: 0, vy: 0,
      hx: o.x, hy: o.y, homeK: o.homeK || 0.03,
      fade: 0, targetFade: 1, expanded: false, _deg: 0, hidden: false,
      fixed: !!o.fixed
    };
    this.nodes.push(n);
    this.byId[n.id] = n;
    return n;
  };

  /* ------------------------------------------------------------ 展开/收起 */

  ForceGraph.prototype.expand = function (chapterId, opts) {
    var node = this.byId['ch:' + chapterId];
    if (!node || node.expanded) return false;
    var pts = node.points || [];
    var self = this;
    node.expanded = true;

    pts.forEach(function (p, i) {
      var heat = p[1] === null || p[2] === null ? 0 : p[1] + p[2] * 5;
      var ring = Math.floor(i / 8);
      var ang = (i % 8) / 8 * TAU + ring * 0.42;
      var rad = 68 + ring * 36;
      var n = self._node({
        id: 'pt:' + chapterId + ':' + i,
        type: 'point', sub: node.sub, label: p[0],
        color: node.color, heat: heat, choice: p[1], comp: p[2],
        chapterId: chapterId, parent: node,
        r: 3.2 + Math.sqrt(heat) * 0.5,
        x: node.x + Math.cos(ang) * rad,
        y: node.y + Math.sin(ang) * rad,
        homeK: 0.13
      });
      n.hx = node.x + Math.cos(ang) * rad;
      n.hy = node.y + Math.sin(ang) * rad;
      self.links.push({ s: node, t: n, kind: 'pt', dist: rad * 0.9 });
    });

    this.alpha = 1;
    if (!opts || opts.silent !== true) this._emit('expand', { chapterId: chapterId });
    return true;
  };

  ForceGraph.prototype.collapse = function (chapterId) {
    var node = this.byId['ch:' + chapterId];
    if (!node || !node.expanded) return false;
    node.expanded = false;
    var self = this;
    this.nodes.forEach(function (n) {
      if (n.type === 'point' && n.chapterId === chapterId) n.targetFade = 0;
    });
    this.links = this.links.filter(function (l) {
      return !(l.t.type === 'point' && l.t.chapterId === chapterId);
    });
    this._gc = true;
    this.alpha = 1;
    this._emit('collapse', { chapterId: chapterId });
    return true;
  };

  ForceGraph.prototype.toggle = function (chapterId) {
    var node = this.byId['ch:' + chapterId];
    if (!node) return false;
    return node.expanded ? this.collapse(chapterId) : this.expand(chapterId);
  };

  ForceGraph.prototype.collapseAll = function () {
    var self = this;
    this.chapters.forEach(function (c) { if (c.expanded) self.collapse(c.chapterId); });
  };

  /* ------------------------------------------------------------- 状态控制 */

  ForceGraph.prototype.setHighlight = function (ids, chapterIds) {
    this.highlight = ids && ids.length ? ids.slice() : null;
    this.highlightChapters = chapterIds && chapterIds.length ? chapterIds.slice() : null;
    this.alpha = Math.max(this.alpha, 0.35);
  };

  ForceGraph.prototype.setFilter = function (sub) {
    this.filter = sub || null;
    this.alpha = Math.max(this.alpha, 0.35);
  };

  ForceGraph.prototype.pulse = function (nodeId) {
    var n = this.byId[nodeId];
    if (!n) return;
    this.pulses.push({ x: n.x, y: n.y, r: n.r, t: 0, color: n.color, max: n.type === 'hub' ? 150 : 90 });
  };

  /* 预留出标题区、面板区和底部控制条的可用矩形 */
  ForceGraph.prototype._area = function () {
    var i = this.insets || { left: 0, right: 0, top: 0, bottom: 0 };
    return {
      x: i.left, y: i.top,
      w: Math.max(240, this.width - i.left - i.right),
      h: Math.max(240, this.height - i.top - i.bottom)
    };
  };

  ForceGraph.prototype.focus = function (nodeId, zoom) {
    var n = this.byId[nodeId];
    if (!n) return;
    var z = zoom || 1.25;
    var a = this._area();
    this.animateView(a.x + a.w / 2 - n.x * z, a.y + a.h / 2 - n.y * z, z, 520);
  };

  ForceGraph.prototype.animateView = function (x, y, scale, dur) {
    if (this.instant || !dur) {
      this.view.x = x; this.view.y = y; this.view.scale = scale;
      return;
    }
    var self = this;
    var from = { x: this.view.x, y: this.view.y, s: this.view.scale };
    var t0 = performance.now();
    if (this._tween) cancelAnimationFrame(this._tween);
    function step(t) {
      var k = clamp((t - t0) / (dur || 420), 0, 1);
      var e = easeOut(k);
      self.view.x = lerp(from.x, x, e);
      self.view.y = lerp(from.y, y, e);
      self.view.scale = lerp(from.s, scale, e);
      if (k < 1) self._tween = requestAnimationFrame(step);
      else self._tween = null;
    }
    this._tween = requestAnimationFrame(step);
  };

  ForceGraph.prototype.fit = function (ids, padding, opts) {
    var list = this.nodes.filter(function (n) {
      return n.fade > 0.4 && (!ids || ids.indexOf(n.id) >= 0);
    });
    if (!list.length) return;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(function (n) {
      x0 = Math.min(x0, n.x - n.r); x1 = Math.max(x1, n.x + n.r);
      y0 = Math.min(y0, n.y - n.r); y1 = Math.max(y1, n.y + n.r);
    });
    var pad = padding === undefined ? 24 : padding;
    var area = this._area();
    var aw = area.w - pad * 2, ah = area.h - pad * 2;
    // 右侧额外留出章节文字标签的位置，避免为最长标签整体缩图
    var labelRoom = 150;
    var s = clamp(Math.min(aw / Math.max(1, x1 - x0 + labelRoom), ah / Math.max(1, y1 - y0 + 40)), 0.4, 1.6);
    var tx = area.x + area.w / 2 - ((x0 + x1) / 2) * s;
    var ty = area.y + area.h / 2 - ((y0 + y1) / 2) * s;
    this._lastFit = { tx: tx, ty: ty, s: s };
    if (opts && opts.instant) {
      this.view.x = tx; this.view.y = ty; this.view.scale = s;
      return;
    }
    this.animateView(tx, ty, s, 560);
  };

  ForceGraph.prototype._fitInitial = function () {
    this._resize();  // 首次测量可能早于样式生效，这里再量一次
    for (var i = 0; i < 3000; i++) this._tick(1 / 60);
    this.fit(null, 18, { instant: true });
    // 从 92% 的取景轻轻推进，避免首帧出现被裁切的画面
    var t = this._lastFit;
    var a = this._area();
    var cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    var midX = (cx - t.tx) / t.s, midY = (cy - t.ty) / t.s;
    this.view.scale = t.s * 0.92;
    this.view.x = cx - midX * this.view.scale;
    this.view.y = cy - midY * this.view.scale;
    this.animateView(t.tx, t.ty, t.s, 900);
    this.alpha = 0.5;
  };

  /* ------------------------------------------------------------- 物理模拟 */

  ForceGraph.prototype._tick = function (dt) {
    var nodes = this.nodes;
    var i, j, n, m, dx, dy, d2, d, f;

    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      n.fade += (n.targetFade - n.fade) * 0.16;
      if (n.hidden) continue;
      n.fx = 0; n.fy = 0;
      // 锚点
      n.fx += (n.hx - n.x) * n.homeK;
      n.fy += (n.hy - n.y) * n.homeK;
    }

    // 斥力
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (n.hidden) continue;
      for (j = i + 1; j < nodes.length; j++) {
        m = nodes[j];
        if (m.hidden) continue;
        dx = m.x - n.x; dy = m.y - n.y;
        d2 = dx * dx + dy * dy;
        if (d2 > 90000 || d2 < 1) continue;
        d = Math.sqrt(d2);
        var power = (n.type === 'point' && m.type === 'point') ? 340 : ((n.type === 'point' || m.type === 'point') ? 520 : 1900);
        f = power / d2;
        var ux = dx / d, uy = dy / d;
        n.fx -= ux * f; n.fy -= uy * f;
        m.fx += ux * f; m.fy += uy * f;
      }
    }

    // 连线弹簧
    for (i = 0; i < this.links.length; i++) {
      var l = this.links[i];
      var a = l.s, b = l.t;
      if (a.hidden || b.hidden) continue;
      dx = b.x - a.x; dy = b.y - a.y;
      d = Math.sqrt(dx * dx + dy * dy) || 1;
      var k = l.kind === 'pt' ? 0.035 : 0.02;
      f = (d - l.dist) * k;
      dx /= d; dy /= d;
      a.fx += dx * f; a.fy += dy * f;
      b.fx -= dx * f; b.fy -= dy * f;
    }

    // 碰撞分离
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (n.hidden) continue;
      for (j = i + 1; j < nodes.length; j++) {
        m = nodes[j];
        if (m.hidden) continue;
        dx = m.x - n.x; dy = m.y - n.y;
        d2 = dx * dx + dy * dy;
        var min = n.r + m.r + (n.type === 'point' && m.type === 'point' ? 12 : 26);
        if (d2 > min * min || d2 < 0.01) continue;
        d = Math.sqrt(d2);
        var push = (min - d) / d * 0.5;
        n.x -= dx * push * 0.5; n.y -= dy * push * 0.5;
        m.x += dx * push * 0.5; m.y += dy * push * 0.5;
      }
    }

    // 积分
    var damp = 0.82;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (n.hidden) continue;
      n.vx = (n.vx + n.fx * dt * 60) * damp;
      n.vy = (n.vy + n.fy * dt * 60) * damp;
      if (n.pinned || n.fixed) { n.vx = 0; n.vy = 0; n.x = n.hx; n.y = n.hy; continue; }
      n.x += clamp(n.vx, -14, 14);
      n.y += clamp(n.vy, -14, 14);
    }
  };

  /* --------------------------------------------------------------- 渲染 */

  ForceGraph.prototype._resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(320, rect.width);
    this.height = Math.max(320, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this._inited) {
      this.view.x = this.width / 2;
      this.view.y = this.height / 2;
      this._inited = true;
    }
  };

  ForceGraph.prototype._isDim = function (n) {
    if (this.filter && n.sub !== this.filter) return true;
    if (this.highlight) {
      if (this.highlight.indexOf(n.id) >= 0) return false;
      if (this.highlightChapters && n.chapterId && this.highlightChapters.indexOf(n.chapterId) >= 0) return false;
      return true;
    }
    return false;
  };

  ForceGraph.prototype.draw = function (ts) {
    var ctx = this.ctx;
    var W = this.width, H = this.height;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var hover = this.hover;
    var focusSet = null;
    if (hover) {
      focusSet = [hover.id];
      this.links.forEach(function (l) {
        if (l.s === hover) focusSet.push(l.t.id);
        if (l.t === hover) focusSet.push(l.s.id);
      });
    }

    ctx.save();
    ctx.translate(this.view.x, this.view.y);
    ctx.scale(this.view.scale, this.view.scale);

    var t = (ts - this._t0) / 1000;
    var self = this;

    /* 连线 */
    for (var i = 0; i < this.links.length; i++) {
      var l = this.links[i];
      var a = l.s, b = l.t;
      if (a.hidden || b.hidden) continue;
      var alpha = 0.16;
      if (l.kind === 'pt') alpha = 0.10;
      if (focusSet && (focusSet.indexOf(a.id) >= 0 && focusSet.indexOf(b.id) >= 0)) alpha = 0.75;
      else if (this.highlight && (this.highlight.indexOf(a.id) >= 0 || this.highlight.indexOf(b.id) >= 0)) alpha = 0.4;
      else if (this._isDim(a) || this._isDim(b)) alpha *= 0.18;

      var grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, this._rgba(a.color, alpha));
      grad.addColorStop(1, this._rgba(b.color, alpha * 0.7));
      ctx.strokeStyle = grad;
      ctx.lineWidth = (l.kind === 'hub' ? 0.9 : 0.6) / this.view.scale + 0.2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    /* 连线上流动的光点（仅科目主干） */
    for (i = 0; i < this.links.length; i++) {
      var lk = this.links[i];
      if (lk.kind !== 'hub' || lk.s.hidden || lk.t.hidden) continue;
      var p = ((t * 0.28 + i * 0.137) % 1);
      var px = lerp(lk.s.x, lk.t.x, p);
      var py = lerp(lk.s.y, lk.t.y, p);
      var fa = (0.55 * Math.sin(p * Math.PI)) * (this._isDim(lk.t) ? 0.12 : 1);
      ctx.fillStyle = this._rgba(lk.t.color, fa);
      ctx.beginPath();
      ctx.arc(px, py, 1.7, 0, TAU);
      ctx.fill();
    }

    /* 节点：知识点 -> 章节 -> 枢纽 */
    var order = ['point', 'chapter', 'hub'];
    for (var oi = 0; oi < order.length; oi++) {
      for (i = 0; i < this.nodes.length; i++) {
        var n = this.nodes[i];
        if (n.type !== order[oi] || n.hidden) continue;
        if (n.type === 'point' && n.fade < 0.05) continue;
        this._drawNode(n, t, focusSet);
      }
    }

    /* 脉冲圈 */
    for (i = this.pulses.length - 1; i >= 0; i--) {
      var pu = this.pulses[i];
      pu.t += 0.02;
      if (pu.t >= 1) { this.pulses.splice(i, 1); continue; }
      var rr = pu.r + pu.max * easeOut(pu.t);
      ctx.strokeStyle = this._rgba(pu.color, (1 - pu.t) * 0.55);
      ctx.lineWidth = 1.6 / this.view.scale;
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, rr, 0, TAU);
      ctx.stroke();
    }

    ctx.restore();
  };

  ForceGraph.prototype._rgba = function (hex, a) {
    var h = hex || '#22d3ee';
    if (h.charAt(0) !== '#') return h;
    var v = h.slice(1);
    if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
    var num = parseInt(v, 16);
    return 'rgba(' + ((num >> 16) & 255) + ',' + ((num >> 8) & 255) + ',' + (num & 255) + ',' + a + ')';
  };

  ForceGraph.prototype._drawNode = function (n, t, focusSet) {
    var ctx = this.ctx;
    var dim = this._isDim(n);
    var hot = focusSet && focusSet.indexOf(n.id) >= 0;
    var base = n.fade * (dim ? 0.22 : 1);
    var color = n.color;

    if (n.type === 'hub') {
      var breathe = 1 + Math.sin(t * 1.1 + n.x * 0.01) * 0.035;
      var grd = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 96);
      grd.addColorStop(0, this._rgba(color, 0.20 * base));
      grd.addColorStop(0.5, this._rgba(color, 0.06 * base));
      grd.addColorStop(1, this._rgba(color, 0));
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 96, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = this._rgba(color, 0.42 * base);
      ctx.lineWidth = 1 / this.view.scale;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * breathe, 0, TAU);
      ctx.stroke();

      ctx.strokeStyle = this._rgba(color, 0.5 * base);
      ctx.setLineDash([2 / this.view.scale, 5 / this.view.scale]);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 10, t * 0.35, t * 0.35 + Math.PI * 1.45);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(6,11,20,0.92)';
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = this._rgba(color, 0.75 * base);
      ctx.lineWidth = 1.4 / this.view.scale;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 13px ' + FONT;
      ctx.fillStyle = this._rgba('#eaf4ff', base);
      ctx.fillText(n.short || n.label, n.x, n.y - 5);
      ctx.font = '500 9px ' + MONO;
      ctx.fillStyle = this._rgba(color, 0.85 * base);
      ctx.fillText(n.score + ' 分', n.x, n.y + 11);
      return;
    }

    if (n.type === 'chapter') {
      var r = n.r * 1.9;
      if (hot || n.expanded) {
        ctx.shadowColor = this._rgba(color, 0.8);
        ctx.shadowBlur = 16;
      }
      ctx.fillStyle = this._rgba(color, (hot || n.expanded ? 0.95 : 0.42) * base);
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;

      if (hot) {
        ctx.strokeStyle = this._rgba(color, 0.45);
        ctx.lineWidth = 1.2 / this.view.scale;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 7, 0, TAU);
        ctx.stroke();
      }

      if (this.width > 720 || this.view.scale > 0.62) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = '500 12px ' + FONT;
        ctx.shadowColor = 'rgba(3,6,12,0.95)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = 'rgba(226,238,252,' + (0.94 * base) + ')';
        ctx.fillText(n.label, n.x + r + 7, n.y + 0.5);
        ctx.shadowBlur = 0;
      }

      if (n.expanded) {
        ctx.font = '500 9px ' + MONO;
        ctx.fillStyle = this._rgba(color, 0.9 * base);
        ctx.fillText('▾ ' + (n.points || []).length, n.x + r + 7, n.y + 14);
      }
      return;
    }

    /* 知识点 */
    var pr = n.r;
    var showLabel = hot || this.view.scale > 1.32 || this.selected === n.id;
    ctx.fillStyle = this._rgba(color, (hot ? 1 : 0.72) * base);
    ctx.beginPath();
    ctx.arc(n.x, n.y, pr, 0, TAU);
    ctx.fill();
    if (hot) {
      ctx.strokeStyle = this._rgba(color, 0.6);
      ctx.lineWidth = 1 / this.view.scale;
      ctx.beginPath();
      ctx.arc(n.x, n.y, pr + 3.5, 0, TAU);
      ctx.stroke();
    }
    if (showLabel) {
      var parent = n.parent || { x: n.x };
      var right = n.x >= parent.x;
      ctx.textAlign = right ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      ctx.font = '500 10.5px ' + FONT;
      ctx.shadowColor = 'rgba(3,6,12,0.95)';
      ctx.shadowBlur = 5;
      ctx.fillStyle = 'rgba(203,220,240,' + (0.95 * base) + ')';
      ctx.fillText(n.label, n.x + (right ? pr + 5 : -pr - 5), n.y);
      ctx.shadowBlur = 0;
    }
  };

  /* --------------------------------------------------------------- 主循环 */

  ForceGraph.prototype.start = function () {
    var self = this;
    var last = 0;
    function loop(ts) {
      self._raf = requestAnimationFrame(loop);
      if (ts - last < 22) return;
      var dt = Math.min(0.05, (ts - last) / 1000) || 0.016;
      last = ts;

      // 视图补间
      if (self._tween) { /* animateView 自己驱动 */ }

      if (self.alpha > 0.012) {
        self._tick(dt);
        self.alpha *= 0.988;
      }
      // 知识点淡出后回收
      if (self._gc) {
        self.nodes = self.nodes.filter(function (n) {
          return !(n.type === 'point' && n.targetFade === 0 && n.fade < 0.04);
        });
        var alive = {};
        self.nodes.forEach(function (n) { alive[n.id] = 1; });
        self.links = self.links.filter(function (l) { return alive[l.s.id] && alive[l.t.id]; });
        self._gc = self.nodes.some(function (n) { return n.type === 'point' && n.targetFade === 0; });
      }
      self.draw(ts);
    }
    this._raf = requestAnimationFrame(loop);
  };

  ForceGraph.prototype.stop = function () {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  };

  /* --------------------------------------------------------------- 交互 */

  ForceGraph.prototype._hit = function (mx, my) {
    var v = this.view;
    var wx = (mx - v.x) / v.scale;
    var wy = (my - v.y) / v.scale;
    var best = null, bd = Infinity;
    for (var i = this.nodes.length - 1; i >= 0; i--) {
      var n = this.nodes[i];
      if (n.hidden || n.fade < 0.3) continue;
      if (this.filter && n.sub !== this.filter) continue;
      var d = Math.hypot(n.x - wx, n.y - wy);
      var hitR = (n.type === 'hub' ? n.r : (n.type === 'chapter' ? n.r * 1.9 : n.r)) + 10 / v.scale;
      if (d < hitR && d < bd) { bd = d; best = n; }
    }
    return best;
  };

  ForceGraph.prototype._bind = function () {
    var self = this;
    var canvas = this.canvas;

    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', function (e) {
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var n = self._hit(mx, my);
      canvas.setPointerCapture(e.pointerId);
      self._pointer = { down: true, node: n, moved: false, x: e.clientX, y: e.clientY, sx: mx, sy: my };
      if (n) {
        n.pinned = true;
        self.selected = n.id;
        self.alpha = 1;
      } else {
        self._pan = { active: true, x: e.clientX, y: e.clientY };
      }
      canvas.style.cursor = n ? 'grabbing' : 'grabbing';
    });

    canvas.addEventListener('pointermove', function (e) {
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var p = self._pointer;

      if (p.down && p.node) {
        p.moved = true;
        var v = self.view;
        p.node.x = (mx - v.x) / v.scale;
        p.node.y = (my - v.y) / v.scale;
        p.node.hx = p.node.x;
        p.node.hy = p.node.y;
        self.alpha = Math.max(self.alpha, 0.6);
        return;
      }
      if (p.down && self._pan.active) {
        var dx = e.clientX - self._pan.x;
        var dy = e.clientY - self._pan.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
        self.view.x += dx;
        self.view.y += dy;
        self._pan.x = e.clientX;
        self._pan.y = e.clientY;
        self._emit('view', self.view);
        return;
      }

      var hit = self._hit(mx, my);
      if (hit !== self.hover) {
        self.hover = hit;
        canvas.style.cursor = hit ? 'pointer' : 'grab';
        self._emit('hover', hit);
      }
    });

    function release(e) {
      var p = self._pointer;
      if (p.node && p.node.pinned) {
        p.node.pinned = false; // 松手后保留原位作为新锚点
      }
      if (p.down && !p.moved) {
        if (p.node) self._emit('click', p.node);
        else {
          self.selected = null;
          self._emit('click', null);
        }
      }
      p.down = false;
      p.node = null;
      self._pan.active = false;
      canvas.style.cursor = 'grab';
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    canvas.addEventListener('dblclick', function (e) {
      var rect = canvas.getBoundingClientRect();
      var n = self._hit(e.clientX - rect.left, e.clientY - rect.top);
      if (n) self._emit('dblclick', n);
      else self.fit(null, 90);
    });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var v = self.view;
      var wx = (mx - v.x) / v.scale, wy = (my - v.y) / v.scale;
      var next = clamp(v.scale * Math.exp(-e.deltaY * 0.0014), 0.35, 3.4);
      v.x = mx - wx * next;
      v.y = my - wy * next;
      v.scale = next;
      self._emit('view', v);
    }, { passive: false });

    if (global.ResizeObserver) {
      var ro = new ResizeObserver(function () { self._resize(); });
      ro.observe(canvas.parentNode || canvas);
    }
    global.addEventListener('resize', function () { self._resize(); });
  };

  global.ForceGraph = ForceGraph;
})(window);
