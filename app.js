/* ==========================================================================
   408 考点演化图谱 · 交互与渲染
   ========================================================================== */
(function () {
  'use strict';

  var D = window.DATA;
  var YEARS = D.YEARS;
  var SUB = {}, CH = {}, CH_BY_SUB = {};
  D.SUBJECTS.forEach(function (s) { SUB[s.id] = s; CH_BY_SUB[s.id] = []; });
  D.CHAPTERS.forEach(function (c) { CH[c.id] = c; CH_BY_SUB[c.sub].push(c); });

  var MAX_HEAT = D.CHAPTERS.reduce(function (m, c) { return Math.max(m, c.heat); }, 0);
  var TOTAL_POINTS = D.CHAPTERS.reduce(function (n, c) { return n + c.points.length; }, 0);

  var LAYOUT = {
    core: { x: 640, y: 360 },
    W: 1280, H: 720,
    hubR: 46,
    nodeW: 192,
    nodeH: 30,
    step: 40,
    quad: {
      ds: { hx: 248, hy: 190, side: 'right', nx: 372 },
      co: { hx: 1032, hy: 190, side: 'left', nx: 716 },
      os: { hx: 248, hy: 530, side: 'right', nx: 372 },
      net: { hx: 1032, hy: 530, side: 'left', nx: 716 }
    }
  };

  /* ------------------------------ 工具 ------------------------------ */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function heatOf(p) {
    if (p[1] === null || p[2] === null) return null;
    return p[1] + p[2] * 5;
  }
  function $(id) { return document.getElementById(id); }

  var TIP = document.createElement('div');
  TIP.id = 'tip';
  document.body.appendChild(TIP);

  function showTip(html, evt) {
    TIP.innerHTML = html;
    TIP.classList.add('show');
    moveTip(evt);
  }
  function moveTip(evt) {
    var pad = 16;
    var w = TIP.offsetWidth, h = TIP.offsetHeight;
    var x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
    TIP.style.left = x + 'px';
    TIP.style.top = y + 'px';
  }
  function hideTip() { TIP.classList.remove('show'); }

  /* ------------------------------ 星图 ------------------------------ */
  var svg = $('map-svg');

  function defs() {
    var d = '<defs>';
    d += '<radialGradient id="coreGrad" cx="50%" cy="40%" r="68%">' +
      '<stop offset="0" stop-color="#0f4a5e"/><stop offset="55%" stop-color="#082634"/>' +
      '<stop offset="100%" stop-color="#03101a"/></radialGradient>';
    d += '<radialGradient id="coreHalo"><stop offset="0" stop-color="#22d3ee" stop-opacity=".26"/>' +
      '<stop offset="55%" stop-color="#22d3ee" stop-opacity=".07"/>' +
      '<stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/></radialGradient>';
    D.SUBJECTS.forEach(function (s) {
      d += '<radialGradient id="neb-' + s.id + '"><stop offset="0" stop-color="' + s.color + '" stop-opacity=".14"/>' +
        '<stop offset="55%" stop-color="' + s.color + '" stop-opacity=".045"/>' +
        '<stop offset="100%" stop-color="' + s.color + '" stop-opacity="0"/></radialGradient>';
      d += '<radialGradient id="hub-' + s.id + '" cx="50%" cy="34%">' +
        '<stop offset="0" stop-color="' + s.color + '" stop-opacity=".34"/>' +
        '<stop offset="100%" stop-color="' + s.color + '" stop-opacity=".05"/></radialGradient>';
    });
    d += '<filter id="softGlow" x="-90%" y="-90%" width="280%" height="280%">' +
      '<feGaussianBlur stdDeviation="6" result="b"/>' +
      '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
    d += '</defs>';
    return d;
  }

  function tickRing() {
    var s = '';
    for (var i = 0; i < 72; i++) {
      var a = (i / 72) * Math.PI * 2;
      var long = i % 6 === 0;
      var r1 = 110, r2 = long ? 122 : 116;
      var x1 = Math.cos(a) * r1, y1 = Math.sin(a) * r1;
      var x2 = Math.cos(a) * r2, y2 = Math.sin(a) * r2;
      s += '<line x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) + '" x2="' + x2.toFixed(2) +
        '" y2="' + y2.toFixed(2) + '" stroke="#22d3ee" stroke-opacity="' +
        (long ? '.5' : '.18') + '" stroke-width="' + (long ? '1.2' : '.8') + '"/>';
    }
    return s;
  }

  function buildMap() {
    var out = defs();

    /* 星云底 */
    D.SUBJECTS.forEach(function (s) {
      var q = LAYOUT.quad[s.id];
      out += '<circle cx="' + q.hx + '" cy="' + q.hy + '" r="330" fill="url(#neb-' + s.id + ')"/>';
    });

    /* 中心核心 */
    out += '<g transform="translate(' + LAYOUT.core.x + ',' + LAYOUT.core.y + ')">' +
      '<circle r="150" fill="url(#coreHalo)"/>' +
      '<circle r="200" fill="none" stroke="#22d3ee" stroke-opacity=".055" stroke-dasharray="1 9"/>' +
      '<circle r="160" fill="none" stroke="#22d3ee" stroke-opacity=".07"/>' +
      '<circle class="core-ring" r="104"/>' +
      '<circle class="core-ring-2" r="88"/>' +
      tickRing() +
      '</g>';

    /* 主干光束 */
    D.SUBJECTS.forEach(function (s, si) {
      var q = LAYOUT.quad[s.id];
      var d = 'M' + q.hx + ',' + q.hy + ' L' + LAYOUT.core.x + ',' + LAYOUT.core.y;
      out += '<path class="beam" d="' + d + '" stroke="' + s.color + '"/>';
      out += '<path class="beam-flow" d="' + d + '" stroke="' + s.color + '"/>';
      /* 沿光束汇入中心的数据流粒子 */
      for (var k = 0; k < 2; k++) {
        out += '<circle r="2" fill="' + s.color + '" opacity=".85" filter="url(#softGlow)">' +
          '<animateMotion dur="4.2s" begin="' + (-k * 2.1 - si * 0.5) + 's" repeatCount="indefinite" path="' + d + '"/>' +
          '</circle>';
      }
    });

    /* 章节连接线 */
    D.SUBJECTS.forEach(function (s) {
      var q = LAYOUT.quad[s.id];
      var list = CH_BY_SUB[s.id];
      var n = list.length;
      list.forEach(function (c, i) {
        var ny = q.hy - (n - 1) * LAYOUT.step / 2 + i * LAYOUT.step + LAYOUT.nodeH / 2;
        var d;
        if (q.side === 'right') {
          d = 'M' + (q.hx + 36) + ',' + q.hy +
            ' C' + (q.hx + 78) + ',' + q.hy + ' ' + (q.hx + 70) + ',' + ny +
            ' ' + (q.nx - 2) + ',' + ny;
        } else {
          d = 'M' + (q.hx - 36) + ',' + q.hy +
            ' C' + (q.hx - 78) + ',' + q.hy + ' ' + (q.hx - 70) + ',' + ny +
            ' ' + (q.nx + LAYOUT.nodeW + 2) + ',' + ny;
        }
        out += '<path class="link" data-chapter="' + c.id + '" d="' + d + '" stroke="' + s.color + '"/>';
      });
    });

    /* 章节节点 */
    D.SUBJECTS.forEach(function (s) {
      var q = LAYOUT.quad[s.id];
      var list = CH_BY_SUB[s.id];
      var n = list.length;
      var startY = q.hy - (n - 1) * LAYOUT.step / 2 - LAYOUT.nodeH / 2;

      list.forEach(function (c, i) {
        var y = startY + i * LAYOUT.step;
        var x = q.nx;
        var meterW = Math.max(3, Math.round((c.heat / MAX_HEAT) * 150));
        out += '<g class="node" data-chapter="' + c.id + '" style="--c:' + s.color + '">' +
          '<rect class="node-bg" x="' + x + '" y="' + y + '" width="' + LAYOUT.nodeW + '" height="' + LAYOUT.nodeH + '" rx="3"/>' +
          '<rect class="node-accent" x="' + x + '" y="' + y + '" width="2.5" height="' + LAYOUT.nodeH + '" fill="' + s.color + '" opacity=".55"/>' +
          '<circle class="node-dot" cx="' + (q.side === 'right' ? x : x + LAYOUT.nodeW) + '" cy="' + (y + LAYOUT.nodeH / 2) + '" r="2.6"/>' +
          '<text class="node-name" x="' + (x + 13) + '" y="' + (y + 19.5) + '">' + esc(c.name) + '</text>' +
          '<text class="node-heat" x="' + (x + LAYOUT.nodeW - 12) + '" y="' + (y + 19.5) + '">' + c.heat + '</text>' +
          '<rect class="node-meter" x="' + (x + 13) + '" y="' + (y + 24) + '" width="' + meterW + '" height="2" rx="1"/>' +
          '</g>';
      });
    });

    /* 科目枢纽 */
    D.SUBJECTS.forEach(function (s) {
      var q = LAYOUT.quad[s.id];
      out += '<g class="hub" data-subject="' + s.id + '" transform="translate(' + q.hx + ',' + q.hy + ')" style="--c:' + s.color + '">' +
        '<circle r="60" fill="url(#hub-' + s.id + ')"/>' +
        '<circle class="hub-ring" r="52" stroke="' + s.color + '"/>' +
        '<circle class="hub-ring-2" r="58" stroke="' + s.color + '" opacity=".18"/>' +
        '<circle class="hub-core" r="38" fill="#070d18" stroke="' + s.color + '" stroke-width="1.4" stroke-opacity=".65"/>' +
        '<text class="hub-name" y="-2">' + esc(s.short || s.name) + '</text>' +
        '<text class="hub-score" y="16">' + s.score + ' 分</text>' +
        '</g>';
    });

    /* 核心文字（最后绘制，保证在最上层） */
    out += '<g transform="translate(' + LAYOUT.core.x + ',' + LAYOUT.core.y + ')" pointer-events="none">' +
      '<circle r="68" fill="url(#coreGrad)" stroke="#22d3ee" stroke-opacity=".45" stroke-width="1.2" filter="url(#softGlow)"/>' +
      '<circle r="68" fill="none" stroke="#22d3ee" stroke-opacity=".18" stroke-width="8"/>' +
      '<text class="core-num" y="2">408</text>' +
      '<text class="core-sub" y="22">150 分 / 180 min</text>' +
      '<text class="core-label" y="-26">CORE</text>' +
      '</g>';

    svg.innerHTML = out;
    bindMapEvents();
  }

  var pinned = null;

  function bindMapEvents() {
    svg.addEventListener('mouseover', function (e) {
      var node = e.target.closest ? e.target.closest('.node') : null;
      if (node) {
        var c = CH[node.getAttribute('data-chapter')];
        if (c) { highlightChapters([c.id]); renderChapter(c); }
        return;
      }
      var hub = e.target.closest ? e.target.closest('.hub') : null;
      if (hub) {
        var sid = hub.getAttribute('data-subject');
        highlightChapters(CH_BY_SUB[sid].map(function (x) { return x.id; }));
        renderSubject(sid);
      }
    });

    svg.addEventListener('mouseleave', function () {
      applyPinned();
    });

    svg.addEventListener('click', function (e) {
      var node = e.target.closest ? e.target.closest('.node') : null;
      var hub = e.target.closest ? e.target.closest('.hub') : null;
      if (node) {
        pinned = { type: 'chapter', id: node.getAttribute('data-chapter') };
      } else if (hub) {
        pinned = { type: 'subject', id: hub.getAttribute('data-subject') };
      } else {
        return;
      }
      applyPinned();
    });
  }

  function applyPinned() {
    if (!pinned) {
      highlightChapters(null);
      renderDefault();
      return;
    }
    if (pinned.type === 'chapter') {
      highlightChapters([pinned.id]);
      renderChapter(CH[pinned.id]);
    } else if (pinned.type === 'subject') {
      highlightChapters(CH_BY_SUB[pinned.id].map(function (x) { return x.id; }));
      renderSubject(pinned.id);
    } else if (pinned.type === 'year') {
      highlightChapters(yearChapters(pinned.id));
      renderYear(pinned.id);
    }
  }

  function yearChapters(y) {
    var ids = [];
    D.COMP_TOPICS.forEach(function (t) {
      if (t.years.indexOf(y) >= 0 && t.chapter && ids.indexOf(t.chapter) < 0) ids.push(t.chapter);
    });
    return ids;
  }

  function highlightChapters(ids) {
    var nodes = svg.querySelectorAll('.node');
    var links = svg.querySelectorAll('.link');
    var on = !!(ids && ids.length);
    nodes.forEach(function (n) {
      var id = n.getAttribute('data-chapter');
      if (!on) { n.classList.remove('is-hot', 'is-dim', 'is-off'); return; }
      if (ids.indexOf(id) >= 0) {
        n.classList.add('is-hot'); n.classList.remove('is-dim');
      } else {
        n.classList.remove('is-hot'); n.classList.add('is-dim');
      }
    });
    links.forEach(function (l) {
      var hit = on && ids.indexOf(l.getAttribute('data-chapter')) >= 0;
      if (hit) l.classList.add('is-hot'); else l.classList.remove('is-hot');
    });
  }

  /* ------------------------------ 面板 ------------------------------ */
  var panelMode = $('panel-mode');
  var panelBody = $('panel-body');

  function renderDefault() {
    panelMode.textContent = '卷面结构';
    var rows = D.SUBJECTS.map(function (s) {
      var list = CH_BY_SUB[s.id];
      var heat = list.reduce(function (a, c) { return a + c.heat; }, 0);
      var chCount = list.length;
      return '<div class="ov-row" style="--c:' + s.color + '">' +
        '<div class="ov-name"><i></i>' + esc(s.name) + '<span>' + chCount + ' 章</span></div>' +
        '<div class="ov-val">' + s.score + ' 分<small>热度 ' + heat + '</small></div>' +
        '</div>';
    }).join('');

    panelBody.innerHTML =
      '<div class="p-subject-tag" style="--c:#22d3ee">PAPER STRUCTURE</div>' +
      '<div class="p-title">150 分，40 道选择 + 7 道综合</div>' +
      '<div class="p-note">408 从 2009 年开始统考，卷面结构 18 年未变：80 分选择题 + 70 分综合题。变的是题怎么问。</div>' +
      '<div class="p-metrics">' +
        '<div class="p-metric"><b>150</b><span>满分</span></div>' +
        '<div class="p-metric"><b>180</b><span>分钟</span></div>' +
        '<div class="p-metric"><b>' + TOTAL_POINTS + '</b><span>知识点</span></div>' +
      '</div>' +
      '<div class="p-sec">SUBJECT WEIGHT</div>' +
      rows +
      '<div class="p-sec">HOW TO READ</div>' +
      '<div class="p-note" style="margin:0">' +
        '左侧每个圆是一次科目枢纽，周围节点是章节。节点右下角的数字是"热度"= 选择题次数 + 5 × 综合题次数。<br><br>' +
        '悬停节点，这里会展开该章全部知识点与各自被考次数；悬停下方年份，会点亮当年考过的综合题所在章节。' +
      '</div>';
  }

  function renderChapter(c) {
    var s = SUB[c.sub];
    panelMode.textContent = '章节详情';

    var pts = c.points.slice().sort(function (a, b) {
      var ha = heatOf(a), hb = heatOf(b);
      if (ha === null && hb === null) return 0;
      if (ha === null) return 1;
      if (hb === null) return -1;
      return hb - ha;
    });

    var maxP = pts.reduce(function (m, p) { return Math.max(m, heatOf(p) || 0); }, 1);

    var list = pts.map(function (p) {
      var h = heatOf(p);
      var w = h === null ? 0 : Math.max(4, Math.round((h / maxP) * 34));
      var nums = (p[1] === null)
        ? '<span class="pt-nums">未单独统计</span>'
        : '<span class="pt-nums">选 <b>' + p[1] + '</b> · 综 <b>' + p[2] + '</b></span>';
      var cov = (p[3] !== null && p[3] !== undefined)
        ? '<em>' + p[3] + '/18 年</em>' : '';
      return '<div class="pt">' +
        '<div class="pt-name">' + esc(p[0]) + cov + '</div>' +
        '<div class="pt-bar">' + nums +
          '<span class="pt-track"><span class="pt-fill" style="width:' + w + 'px"></span></span>' +
        '</div></div>';
    }).join('');

    panelBody.innerHTML =
      '<div class="p-subject-tag" style="--c:' + s.color + '">' + esc(s.name) + ' / ' +
        String(CH_BY_SUB[c.sub].indexOf(c) + 1).padStart(2, '0') + '</div>' +
      '<div class="p-title">' + esc(c.name) + '</div>' +
      '<div class="p-note">' + esc(c.note) + '</div>' +
      '<div class="p-metrics" style="--c:' + s.color + '">' +
        '<div class="p-metric"><b style="color:' + s.color + '">' + c.heat + '</b><span>热度</span></div>' +
        '<div class="p-metric"><b>' + c.choice + '</b><span>选择题</span></div>' +
        '<div class="p-metric"><b>' + c.comp + '</b><span>综合题</span></div>' +
      '</div>' +
      '<div class="p-sec">ALL POINTS · ' + c.points.length + '</div>' +
      list +
      '<div class="p-sec">NOTE</div>' +
      '<div class="p-note" style="margin:0;font-size:11px">一道真题常同时挂在多个知识点下，所以各点次数之和大于真实题量。这张表比的是相对轻重，不是绝对分值。</div>';

    panelBody.scrollTop = 0;
  }

  function renderSubject(sid) {
    var s = SUB[sid];
    panelMode.textContent = '科目概览';
    var list = CH_BY_SUB[sid];
    var totalHeat = list.reduce(function (a, c) { return a + c.heat; }, 0);
    var totalChoice = list.reduce(function (a, c) { return a + c.choice; }, 0);
    var totalComp = list.reduce(function (a, c) { return a + c.comp; }, 0);
    var maxH = list.reduce(function (m, c) { return Math.max(m, c.heat); }, 1);

    var rows = list.map(function (c) {
      return '<div class="pt">' +
        '<div class="pt-name">' + esc(c.name) + '<em>' + c.choice + ' / ' + c.comp + '</em></div>' +
        '<div class="pt-bar"><span class="pt-nums"><b>' + c.heat + '</b></span>' +
        '<span class="pt-track"><span class="pt-fill" style="width:' + Math.max(4, Math.round(c.heat / maxH * 34)) + 'px"></span></span>' +
        '</div></div>';
    }).join('');

    panelBody.innerHTML =
      '<div class="p-subject-tag" style="--c:' + s.color + '">' + s.en + '</div>' +
      '<div class="p-title">' + esc(s.name) + '</div>' +
      '<div class="p-note">' + esc(s.tag) + '</div>' +
      '<div class="p-metrics">' +
        '<div class="p-metric"><b style="color:' + s.color + '">' + s.score + '</b><span>分值</span></div>' +
        '<div class="p-metric"><b>' + s.choice + '</b><span>选择题 / 年</span></div>' +
        '<div class="p-metric"><b>' + s.comp + '</b><span>综合题 / 年</span></div>' +
      '</div>' +
      '<div class="p-sec">CHAPTERS · ' + list.length + '</div>' +
      rows +
      '<div class="p-sec">TOTAL</div>' +
      '<div class="p-note" style="margin:0;font-size:11px">18 年累计引用：选择题 ' + totalChoice +
      ' 次、综合题 ' + totalComp + ' 次，合计热度 ' + totalHeat + '。</div>';

    panelBody.scrollTop = 0;
  }

  function renderYear(year) {
    var row = D.DIFFICULTY.filter(function (d) { return d.year === year; })[0];
    if (!row) return;
    panelMode.textContent = year + ' 年';

    var topics = D.COMP_TOPICS.filter(function (t) { return t.years.indexOf(year) >= 0; });

    var stars = '';
    for (var i = 1; i <= 5; i++) {
      stars += '<i class="' + (i <= row.all ? 'on ' + (row.all >= 5 ? 'hot' : row.all === 4 ? 'warm' : '') : '') + '"></i>';
    }

    var diffRows = D.SUBJECTS.map(function (s) {
      var v = row[s.id === 'ds' ? 'ds' : s.id === 'co' ? 'co' : s.id === 'os' ? 'os' : 'net'];
      var bars = '';
      for (var k = 1; k <= 5; k++) {
        bars += '<i class="' + (k <= v ? 'on ' + (v >= 5 ? 'hot' : v === 4 ? 'warm' : '') : '') + '" style="flex:1"></i>';
      }
      return '<div class="ov-row" style="--c:' + s.color + '">' +
        '<div class="ov-name"><i></i>' + esc(s.name) + '</div>' +
        '<div class="stars" style="margin:0">' + bars + '</div></div>';
    }).join('');

    var topicHtml = topics.length ? topics.map(function (t) {
      var s = SUB[t.sub];
      return '<div class="topic-line" style="--c:' + s.color + '"><i></i><div>' + esc(t.name) +
        '<em>' + s.name + ' · 综合题</em></div></div>';
    }).join('') : '<div class="p-empty">该年无综合题记录</div>';

    panelBody.innerHTML =
      '<div class="p-subject-tag" style="--c:#22d3ee">YEAR SCAN</div>' +
      '<div class="yr-big">' + year + '<small>' + esc(row.tag) + '</small></div>' +
      '<div class="stars">' + stars + '</div>' +
      '<div class="p-note">整体难度 ' + row.all + ' / 5</div>' +
      '<div class="p-sec">SUBJECT DIFFICULTY</div>' +
      diffRows +
      '<div class="p-sec">COMPREHENSIVE · ' + topics.length + '</div>' +
      topicHtml;

    panelBody.scrollTop = 0;
  }

  /* ------------------------------ 年份条 ------------------------------ */
  function buildYearBar() {
    var track = $('year-track');
    track.innerHTML = YEARS.map(function (y) {
      var count = D.COMP_TOPICS.filter(function (t) { return t.years.indexOf(y) >= 0; }).length;
      return '<div class="year-cell" data-year="' + y + '">' + y + '</div>';
    }).join('');

    track.addEventListener('mouseover', function (e) {
      var cell = e.target.closest('.year-cell');
      if (!cell) return;
      var y = +cell.getAttribute('data-year');
      onYearHover(y, cell);
    });
    track.addEventListener('mouseleave', function () {
      markYearCell(pinned && pinned.type === 'year' ? pinned.id : null);
      applyPinned();
    });
    track.addEventListener('click', function (e) {
      var cell = e.target.closest('.year-cell');
      if (!cell) return;
      var y = +cell.getAttribute('data-year');
      pinned = { type: 'year', id: y };
      onYearHover(y, cell);
    });

    $('reset-btn').addEventListener('click', function () {
      pinned = null;
      markYearCell(null);
      highlightChapters(null);
      renderDefault();
    });
  }

  function markYearCell(y) {
    var track = $('year-track');
    track.querySelectorAll('.year-cell').forEach(function (c) {
      c.classList.toggle('is-on', String(y) === c.getAttribute('data-year'));
    });
  }

  function onYearHover(y, cell) {
    markYearCell(y);
    highlightChapters(yearChapters(y));
    renderYear(y);
  }

  /* ------------------------------ 演化矩阵 ------------------------------ */
  function buildMatrix() {
    var wrap = $('matrix-wrap');
    var out = '<div class="mx">';

    /* 表头 */
    out += '<div class="mx-row"><div class="mx-head grp">综合题考点 / 年份</div>';
    YEARS.forEach(function (y) { out += '<div class="mx-head">' + y + '</div>'; });
    out += '</div>';

    var lastSub = null;
    D.COMP_TOPICS.forEach(function (t) {
      if (lastSub !== null && lastSub !== t.sub) {
        out += '<div class="mx-sep"></div>';
      }
      lastSub = t.sub;
      var s = SUB[t.sub];
      out += '<div class="mx-row">';
      out += '<div class="mx-label" style="--c:' + s.color + '"><i></i>' + esc(t.name) +
        '<b>' + t.years.length + '</b></div>';
      YEARS.forEach(function (y) {
        var on = t.years.indexOf(y) >= 0;
        out += '<div class="mx-cell' + (on ? ' on' : '') + '" style="--c:' + s.color + '"' +
          ' data-name="' + esc(t.name) + '" data-sub="' + esc(s.name) + '" data-year="' + y + '"' +
          ' data-on="' + (on ? 1 : 0) + '"></div>';
      });
      out += '</div>';
    });

    out += '</div>';
    wrap.innerHTML = out;

    wrap.addEventListener('mouseover', function (e) {
      var cell = e.target.closest('.mx-cell');
      if (!cell) return;
      var on = cell.getAttribute('data-on') === '1';
      var name = cell.getAttribute('data-name');
      var sub = cell.getAttribute('data-sub');
      var year = cell.getAttribute('data-year');
      showTip('<b>' + year + '</b><br>' + esc(name) +
        '<em>' + esc(sub) + ' · ' + (on ? '该年综合题中出现' : '该年未出现') + '</em>', e);
    });
    wrap.addEventListener('mousemove', function (e) {
      if (TIP.classList.contains('show')) moveTip(e);
    });
    wrap.addEventListener('mouseout', function (e) {
      if (e.target.closest('.mx-cell')) hideTip();
    });
  }

  /* ------------------------------ 难度曲线 ------------------------------ */
  function buildDiffChart() {
    var el = $('diff-svg');
    var W = 900, H = 320;
    var padL = 34, padR = 18, padT = 22, padB = 38;
    var iw = W - padL - padR, ih = H - padT - padB;
    var n = YEARS.length;

    var x = function (i) { return padL + (iw / (n - 1)) * i; };
    var y = function (v) { return padT + ih - ((v - 1) / 4) * ih; };

    var series = [
      { key: 'all', name: '整体', color: '#22d3ee', w: 2.2, op: 1 },
      { key: 'ds', name: '数据结构', color: '#22d3ee', w: 1.1, op: .38 },
      { key: 'co', name: '组成原理', color: '#a78bfa', w: 1.1, op: .38 },
      { key: 'os', name: '操作系统', color: '#fbbf24', w: 1.1, op: .38 },
      { key: 'net', name: '计算机网络', color: '#34d399', w: 1.1, op: .38 }
    ];

    var out = '<defs><linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#22d3ee" stop-opacity=".30"/>' +
      '<stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/>' +
      '</linearGradient></defs>';

    /* 网格 */
    for (var v = 1; v <= 5; v++) {
      out += '<line class="d-grid" x1="' + padL + '" y1="' + y(v) + '" x2="' + (W - padR) + '" y2="' + y(v) + '"/>';
      out += '<text class="d-tick-y" x="' + (padL - 8) + '" y="' + (y(v) + 3) + '">' + v + '</text>';
    }
    out += '<line class="d-axis" x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) + '"/>';

    /* 面积 */
    var areaPts = D.DIFFICULTY.map(function (d, i) { return x(i) + ',' + y(d.all); });
    out += '<path d="M' + x(0) + ',' + y(1) + ' L' + areaPts.join(' L') +
      ' L' + x(n - 1) + ',' + y(1) + ' Z" fill="url(#areaG)"/>';

    /* 科目细线 */
    ['ds', 'co', 'os', 'net'].forEach(function (k) {
      var s = series.filter(function (z) { return z.key === k; })[0];
      var pts = D.DIFFICULTY.map(function (d, i) { return x(i) + ',' + y(d[k]); });
      out += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + s.color +
        '" stroke-width="' + s.w + '" stroke-opacity="' + s.op + '" data-series="' + k + '"/>';
    });

    /* 整体线 */
    out += '<polyline points="' + areaPts.join(' ') + '" fill="none" stroke="#22d3ee" stroke-width="2.2"' +
      ' style="filter:drop-shadow(0 0 6px rgba(34,211,238,.7))"/>';

    /* 年份轴 */
    D.DIFFICULTY.forEach(function (d, i) {
      if (i % 2 === 0 || i === n - 1) {
        out += '<text class="d-tick" x="' + x(i) + '" y="' + (H - padB + 18) + '">' + String(d.year).slice(2) + '</text>';
      }
    });

    /* 数据点 */
    D.DIFFICULTY.forEach(function (d, i) {
      out += '<circle class="d-dot" cx="' + x(i) + '" cy="' + y(d.all) + '" r="3.4" fill="#04060e"' +
        ' stroke="#22d3ee" stroke-width="1.8" style="color:#22d3ee"' +
        ' data-year="' + d.year + '" data-all="' + d.all + '" data-tag="' + esc(d.tag) + '"/>';
    });

    el.innerHTML = out;

    el.addEventListener('mouseover', function (e) {
      var dot = e.target.closest('.d-dot');
      if (!dot) return;
      showTip('<b>' + dot.getAttribute('data-year') + ' 年</b><br>整体难度 ' +
        dot.getAttribute('data-all') + ' / 5<em>' + dot.getAttribute('data-tag') + '</em>', e);
    });
    el.addEventListener('mousemove', function (e) {
      if (TIP.classList.contains('show')) moveTip(e);
    });
    el.addEventListener('mouseout', function (e) {
      if (e.target.closest('.d-dot')) hideTip();
    });

    /* 图例 */
    $('diff-legend').innerHTML = series.map(function (s) {
      return '<span data-series="' + s.key + '" style="--c:' + s.color + '"><i></i>' + s.name + '</span>';
    }).join('');
  }

  /* ------------------------------ 高频榜 ------------------------------ */
  function buildTopList() {
    var all = [];
    D.CHAPTERS.forEach(function (c) {
      c.points.forEach(function (p) {
        var h = heatOf(p);
        if (h === null) return;
        all.push({ name: p[0], heat: h, choice: p[1], comp: p[2], sub: c.sub, chapter: c.name });
      });
    });
    all.sort(function (a, b) { return b.heat - a.heat; });
    var top = all.slice(0, 14);
    var max = top[0].heat;

    $('toplist').innerHTML = top.map(function (t, i) {
      var s = SUB[t.sub];
      return '<div class="tl-row" style="--c:' + s.color + '">' +
        '<div class="tl-rank">' + String(i + 1).padStart(2, '0') + '</div>' +
        '<div class="tl-main">' +
          '<div class="tl-name"><i></i>' + esc(t.name) + '</div>' +
          '<div class="tl-track"><div class="tl-bar" data-w="' + Math.round(t.heat / max * 100) + '"></div></div>' +
        '</div>' +
        '<div class="tl-val">' + t.heat + '<small>选 ' + t.choice + ' / 综 ' + t.comp + '</small></div>' +
      '</div>';
    }).join('');

    var bars = $('toplist').querySelectorAll('.tl-bar');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          var b = en.target;
          setTimeout(function () { b.style.width = b.getAttribute('data-w') + '%'; }, 60);
          io.unobserve(b);
        }
      });
    }, { threshold: 0.2 });
    bars.forEach(function (b) { io.observe(b); });
  }

  /* ------------------------------ 阶段与洞察 ------------------------------ */
  function buildPhases() {
    var colors = ['#22d3ee', '#a78bfa', '#fbbf24'];
    $('phases').innerHTML = D.PHASES.map(function (p, i) {
      return '<div class="phase" style="--c:' + colors[i] + '">' +
        '<div class="phase-range">' + p.range + '</div>' +
        '<div class="phase-name">' + esc(p.name) + '</div>' +
        '<div class="phase-desc">' + esc(p.desc) + '</div>' +
        '<div class="phase-points">' + p.points.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' +
        '</div>';
    }).join('');
  }

  function buildInsights() {
    $('insights').innerHTML = D.INSIGHTS.map(function (x) {
      return '<div class="ins" style="--c:' + x.color + '">' +
        '<span class="ins-tag">' + esc(x.tag) + '</span>' +
        '<div class="ins-title">' + esc(x.title) + '</div>' +
        '<div class="ins-desc">' + esc(x.desc) + '</div>' +
        '</div>';
    }).join('');
  }

  /* ------------------------------ 启动 ------------------------------ */
  function init() {
    $('stat-points').textContent = TOTAL_POINTS;
    buildMap();
    buildYearBar();
    buildMatrix();
    buildDiffChart();
    buildTopList();
    buildPhases();
    buildInsights();
    renderDefault();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
