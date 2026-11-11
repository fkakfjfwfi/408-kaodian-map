/* ==========================================================================
   408 考点演化图谱 · 交互编排
   - 星图 / 矩阵 / 曲线 / 年份条 四视图共享一个 state，互相互联
   - 所有图表自己算坐标、自己画，不依赖任何库
   ========================================================================== */
(function () {
  'use strict';

  var D = window.DATA;
  var YEARS = D.YEARS;
  var SUB = {}, CH = {}, CH_BY_SUB = {};
  D.SUBJECTS.forEach(function (s) { SUB[s.id] = s; CH_BY_SUB[s.id] = []; });
  D.CHAPTERS.forEach(function (c) { CH[c.id] = c; CH_BY_SUB[c.sub].push(c); });

  var TOTAL_POINTS = D.CHAPTERS.reduce(function (n, c) { return n + c.points.length; }, 0);

  var state = {
    subject: null,
    year: null,
    chapter: null,
    point: null,
    playing: false,
    timer: null,
    series: { all: true, ds: false, co: false, os: false, net: false }
  };

  /* ------------------------------------------------------------------ 工具 */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function heatOf(p) {
    if (p[1] === null || p[2] === null) return null;
    return p[1] + p[2] * 5;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function tween(dur, fn, done) {
    var t0 = performance.now();
    function step(t) {
      var k = clamp((t - t0) / dur, 0, 1);
      fn(easeOut(k));
      if (k < 1) requestAnimationFrame(step);
      else if (done) done();
    }
    requestAnimationFrame(step);
  }

  /* 悬浮提示 */
  var TIP = $('tip');
  function showTip(html, evt) {
    TIP.innerHTML = html;
    TIP.classList.add('show');
    moveTip(evt);
  }
  function moveTip(evt) {
    var pad = 16, w = TIP.offsetWidth, h = TIP.offsetHeight;
    var x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + w > window.innerWidth - 10) x = evt.clientX - w - pad;
    if (y + h > window.innerHeight - 10) y = evt.clientY - h - pad;
    TIP.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }
  function hideTip() { TIP.classList.remove('show'); }

  /* 大观园深链 */
  var DAGY = D.DAGY_BASE;
  function dagyChapterUrl(c, i) {
    var t = c.dagy && c.dagy[i || 0];
    return t ? DAGY + 'subject.html#/' + t.sub + '/ch' + t.ch : DAGY;
  }
  function dagyQuizUrl(c, i) {
    var t = c.dagy && c.dagy[i || 0];
    return t ? DAGY + 'quiz.html#/' + t.sub + '/ch' + t.ch : DAGY;
  }
  function dagySubjectUrl(sid) {
    return DAGY + 'subject.html#/' + (D.DAGY_SUB[sid] || sid);
  }

  /* ==================================================================
     1. 星图
     ================================================================== */
  var graph = new window.ForceGraph($('graph-canvas'), {});
  var INSTANT = /[?&]instant=1/.test(location.search) ||
    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  graph.instant = INSTANT;
  graph.insets = window.innerWidth > 1120
    ? { left: 40, right: 400, top: 128, bottom: 70 }
    : { left: 8, right: 8, top: 20, bottom: 40 };
  if (INSTANT) document.documentElement.classList.add('no-anim');
  graph.load(D.SUBJECTS, D.CHAPTERS);
  graph.start();

  graph.on('hover', function (n) {
    if (!n) { restorePanel(); return; }
    if (n.type === 'hub') renderSubject(n.sub);
    else if (n.type === 'chapter') renderChapter(CH[n.chapterId]);
    else if (n.type === 'point') renderPoint(n);
  });

  graph.on('click', function (n) {
    if (!n) {
      state.chapter = null;
      restorePanel();
      return;
    }
    if (n.type === 'chapter') {
      var c = CH[n.chapterId];
      state.chapter = c.id;
      state.point = null;
      graph.toggle(c.id);
      renderChapter(c);
    } else if (n.type === 'hub') {
      setSubject(state.subject === n.sub ? null : n.sub, true);
    } else if (n.type === 'point') {
      state.point = n.id;
      renderPoint(n);
      graph.focus(n.id, Math.max(graph.view.scale, 1.6));
    }
  });

  /* 双击节点 → 打开 408 大观园对应页面（保留原来的跳转能力） */
  graph.on('dblclick', function (n) {
    if (!n) return;
    if (n.type === 'chapter') window.open(dagyChapterUrl(CH[n.chapterId]), '_blank', 'noopener');
    else if (n.type === 'hub') window.open(dagySubjectUrl(n.sub), '_blank', 'noopener');
    else if (n.type === 'point') window.open(dagyChapterUrl(CH[n.chapterId]), '_blank', 'noopener');
  });

  /* 统一入口：展开某章 + 出面板 + 取景（可选回到首屏） */
  function focusChapter(cid, scroll) {
    var c = CH[cid];
    if (!c) return;
    var n = graph.byId['ch:' + cid];
    if (n && !n.expanded) graph.expand(cid);
    state.chapter = cid;
    renderChapter(c);
    if (n) graph.focus(n.id, Math.max(graph.view.scale, 1.05));
    if (scroll) $('map').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ==================================================================
     2. 年份轨道
     ================================================================== */
  function compCountByYear(y) {
    var n = 0;
    D.COMP_TOPICS.forEach(function (t) { if (t.years.indexOf(y) >= 0) n++; });
    return n;
  }
  var MAX_COMP = YEARS.reduce(function (m, y) { return Math.max(m, compCountByYear(y)); }, 1);

  function buildRail() {
    var maxComp = MAX_COMP;
    $('year-rail').innerHTML = YEARS.map(function (y) {
      var n = compCountByYear(y);
      var h = 6 + Math.round((n / maxComp) * 34);
      return '<button class="yr" type="button" data-year="' + y + '" title="' + y + ' 年 · ' + n + ' 类综合题">' +
        '<em class="mono">' + String(y).slice(2) + '</em>' +
        '<i style="height:' + h + 'px"></i>' +
        '<span class="mono">' + n + '</span>' +
        '</button>';
    }).join('');

    var rail = $('year-rail');
    rail.addEventListener('mouseover', function (e) {
      var b = e.target.closest('.yr');
      if (b) setYear(+b.getAttribute('data-year'), { fromRail: true });
    });
    rail.addEventListener('mouseleave', function () {
      if (!state.playing) {
        state.year = null;
        paintRail();
        clearYearHighlight();
        restorePanel();
      }
    });
    rail.addEventListener('click', function (e) {
      var b = e.target.closest('.yr');
      if (!b) return;
      e.preventDefault();
      setYear(+b.getAttribute('data-year'));
    });
  }

  function paintRail() {
    var nodes = $('year-rail').querySelectorAll('.yr');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('is-on', String(state.year) === nodes[i].getAttribute('data-year'));
    }
  }

  function yearChapters(y) {
    var ids = [];
    D.COMP_TOPICS.forEach(function (t) {
      if (t.years.indexOf(y) >= 0 && t.chapter && ids.indexOf(t.chapter) < 0) ids.push(t.chapter);
    });
    return ids;
  }

  function clearYearHighlight() {
    graph.setHighlight(null, null);
  }

  function applyYearHighlight(y) {
    var ids = yearChapters(y);
    graph.setHighlight(ids.map(function (id) { return 'ch:' + id; }), ids);
    ids.forEach(function (id) { graph.pulse('ch:' + id); });
    graph.alpha = 1;
  }

  function setYear(y, opts) {
    opts = opts || {};
    state.year = y;
    paintRail();
    applyYearHighlight(y);
    markMatrixYear(y);
    markChartYear(y);
    if (!opts.silentPanel) renderYear(y);
  }

  /* ==================================================================
     3. 年份播放器
     ================================================================== */
  function togglePlay() {
    state.playing ? stopPlay() : startPlay();
  }
  function startPlay() {
    if (state.playing) return;
    state.playing = true;
    document.body.classList.add('is-playing');
    var idx = state.year ? YEARS.indexOf(state.year) : -1;
    function step() {
      idx = (idx + 1) % YEARS.length;
      setYear(YEARS[idx]);
    }
    step();
    state.timer = setInterval(step, 1150);
  }
  function stopPlay() {
    state.playing = false;
    document.body.classList.remove('is-playing');
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  $('play-btn').addEventListener('click', togglePlay);
  $('matrix-play').addEventListener('click', togglePlay);

  /* ==================================================================
     4. 科目筛选
     ================================================================== */
  function buildFilters() {
    var html = '<button class="chip is-on" type="button" data-sub="">全部</button>';
    html += D.SUBJECTS.map(function (s) {
      return '<button class="chip" type="button" data-sub="' + s.id + '" style="--c:' + s.color + '">' +
        '<i></i>' + esc(s.short || s.name) + '</button>';
    }).join('');
    $('filters').innerHTML = html;

    $('filters').addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      setSubject(b.getAttribute('data-sub') || null, true);
    });
  }

  function setSubject(sid, refit) {
    state.subject = sid;
    graph.setFilter(sid);
    syncHeatFilter();
    var chips = $('filters').querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('is-on', (chips[i].getAttribute('data-sub') || null) === sid);
    }
    if (sid) {
      renderSubject(sid);
      if (refit) {
        var ids = ['hub:' + sid];
        CH_BY_SUB[sid].forEach(function (c) { ids.push('ch:' + c.id); });
        graph.fit(ids, 80);
      }
    } else {
      restorePanel();
      if (refit) graph.fit(null, 90);
    }
  }

  $('reset-btn').addEventListener('click', function () {
    stopPlay();
    state.year = null;
    state.chapter = null;
    state.point = null;
    setSubject(null, false);
    clearYearHighlight();
    paintRail();
    markMatrixYear(null);
    markChartYear(null);
    graph.collapseAll();
    graph.fit(null, 24);
    restorePanel();
    hideTip();
  });

  /* ==================================================================
     5. 详情面板
     ================================================================== */
  var inspBody = $('insp-body');
  var inspMode = $('insp-mode');
  var swapToken = 0;
  var lastKey = null;

  function swap(html, mode, key) {
    if (key && key === lastKey) return;
    lastKey = key || null;
    var token = ++swapToken;
    inspMode.textContent = mode;
    inspBody.classList.add('is-swapping');
    setTimeout(function () {
      if (token !== swapToken) return;
      inspBody.innerHTML = html;
      inspBody.scrollTop = 0;
      inspBody.classList.remove('is-swapping');
    }, 110);
  }

  function restorePanel() {
    if (state.chapter && CH[state.chapter]) { renderChapter(CH[state.chapter]); return; }
    if (state.subject) { renderSubject(state.subject); return; }
    if (state.year) { renderYear(state.year); return; }
    renderDefault();
  }

  function renderDefault() {
    var rows = D.SUBJECTS.map(function (s) {
      var list = CH_BY_SUB[s.id];
      var heat = list.reduce(function (a, c) { return a + c.heat; }, 0);
      return '<button class="ov-row" type="button" data-sub="' + s.id + '" style="--c:' + s.color + '">' +
        '<span class="ov-name"><i></i>' + esc(s.name) + '<em class="mono">' + list.length + ' 章</em></span>' +
        '<span class="ov-val mono">' + s.score + ' 分<em>热度 ' + heat + '</em></span>' +
        '</button>';
    }).join('');

    swap(
      '<div class="tag" style="--c:#22d3ee">PAPER STRUCTURE</div>' +
      '<h3 class="insp-title">40 道选择 + 7 道综合</h3>' +
      '<p class="insp-note">408 从 2009 年统考至今，卷面结构 18 年没变：80 分选择 + 70 分综合。变的是题怎么问。</p>' +
      donutHTML() +
      '<div class="sec">SUBJECT WEIGHT</div>' + rows +
      '<div class="sec">HOW TO USE</div>' +
      '<p class="insp-note tight">星图里的圆点是一个个章节，圆越大热度越高。' +
      '<b>点一下</b>它会摊开该章的全部知识点；<b>拖</b>节点、<b>滚</b>缩放、<b>双击空白</b>复位。<br><br>' +
      '底部年份条是一个播放器，点「播放 18 年」看综合题怎么在四科之间迁移。</p>' +
      '<div class="sec">LINKED</div>' +
      '<a class="plink" style="--c:#22d3ee" target="_blank" rel="noopener" href="' + DAGY + '">' +
      '<em>408 大观园 · 四科 26 章知识库</em><span class="mono">打开 →</span></a>',
      '卷面结构', 'default'
    );

    wireOverview();
  }

  function donutHTML() {
    var size = 168, r = 56, cx = size / 2, cy = size / 2;
    var C = 2 * Math.PI * r;
    var total = D.SUBJECTS.reduce(function (a, s) { return a + s.score; }, 0);
    var acc = 0;
    var segs = D.SUBJECTS.map(function (s) {
      var len = (s.score / total) * C - 3;
      var g = '<circle class="donut-seg" cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" ' +
        'stroke="' + s.color + '" stroke-width="9" stroke-linecap="butt" ' +
        'stroke-dasharray="' + Math.max(0, len) + ' ' + C + '" ' +
        'stroke-dashoffset="' + (-acc) + '" ' +
        'transform="rotate(-90 ' + cx + ' ' + cy + ')" ' +
        'data-score="' + s.score + '"/>';
      acc += (s.score / total) * C;
      return g;
    }).join('');

    return '<div class="donut">' +
      '<svg viewBox="0 0 ' + size + ' ' + size + '" class="donut-svg">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="rgba(110,170,255,.10)" stroke-width="9"/>' +
      segs +
      '</svg>' +
      '<div class="donut-center"><b class="mono">150</b><span>满分</span></div>' +
      '</div>';
  }

  function wireOverview() {
    inspBody.querySelectorAll('.ov-row').forEach(function (row) {
      row.addEventListener('mouseenter', function () {
        var sid = row.getAttribute('data-sub');
        var ids = CH_BY_SUB[sid].map(function (c) { return 'ch:' + c.id; });
        graph.setHighlight(ids.concat(['hub:' + sid]), CH_BY_SUB[sid].map(function (c) { return c.id; }));
      });
      row.addEventListener('mouseleave', function () { clearYearHighlight(); });
      row.addEventListener('click', function () { setSubject(row.getAttribute('data-sub'), true); });
    });
  }

  function renderSubject(sid) {
    var s = SUB[sid];
    var list = CH_BY_SUB[sid];
    var totalHeat = list.reduce(function (a, c) { return a + c.heat; }, 0);
    var maxH = list.reduce(function (m, c) { return Math.max(m, c.heat); }, 1);

    var rows = list.map(function (c) {
      return '<button class="pt" type="button" data-chapter="' + c.id + '">' +
        '<span class="pt-name">' + esc(c.name) + '<em class="mono">' + c.choice + '/' + c.comp + '</em></span>' +
        '<span class="pt-bar"><b class="mono">' + c.heat + '</b>' +
        '<i class="pt-track"><i class="pt-fill" style="width:' + Math.round(c.heat / maxH * 100) + '%"></i></i>' +
        '</span></button>';
    }).join('');

    swap(
      '<div class="tag" style="--c:' + s.color + '">' + esc(s.en) + '</div>' +
      '<h3 class="insp-title">' + esc(s.name) + '</h3>' +
      '<p class="insp-note">' + esc(s.tag) + '</p>' +
      '<div class="metrics">' +
        '<div class="metric"><b class="mono" style="color:' + s.color + '">' + s.score + '</b><span>分值</span></div>' +
        '<div class="metric"><b class="mono">' + s.choice + '</b><span>选择 / 年</span></div>' +
        '<div class="metric"><b class="mono">' + s.comp + '</b><span>综合 / 年</span></div>' +
      '</div>' +
      '<div class="sec">CHAPTERS · ' + list.length + '</div>' + rows +
      '<div class="sec">TOTAL</div>' +
      '<p class="insp-note tight">18 年累计引用：选择题 ' + list.reduce(function (a, c) { return a + c.choice; }, 0) +
      ' 次，综合题 ' + list.reduce(function (a, c) { return a + c.comp; }, 0) + ' 次，合计热度 ' + totalHeat + '。</p>' +
      '<a class="plink" style="--c:' + s.color + '" target="_blank" rel="noopener" href="' + dagySubjectUrl(sid) + '">' +
      '<em>' + esc(s.name) + '大观 · 全部 ' + list.length + ' 章</em><span class="mono">进入 →</span></a>',
      '科目概览', 's:' + sid
    );

    inspBody.querySelectorAll('.pt').forEach(function (row) {
      var cid = row.getAttribute('data-chapter');
      row.addEventListener('mouseenter', function () {
        graph.setHighlight(['ch:' + cid], [cid]);
      });
      row.addEventListener('mouseleave', function () { clearYearHighlight(); });
      row.addEventListener('click', function () {
        var n = graph.byId['ch:' + cid];
        if (n && !n.expanded) graph.expand(cid);
        graph.focus('ch:' + cid, 1.25);
        state.chapter = cid;
        renderChapter(CH[cid]);
      });
    });
  }

  function renderChapter(c) {
    var s = SUB[c.sub];
    var idx = CH_BY_SUB[c.sub].indexOf(c) + 1;
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
      var w = h === null ? 0 : Math.max(3, Math.round((h / maxP) * 100));
      var nums = p[1] === null ? '<em>未单独统计</em>'
        : '选 <b>' + p[1] + '</b> · 综 <b>' + p[2] + '</b>';
      var cov = (p[3] !== null && p[3] !== undefined) ? '<em class="cov mono">' + p[3] + '/18</em>' : '';
      return '<div class="pt pt-static">' +
        '<span class="pt-name">' + esc(p[0]) + cov + '</span>' +
        '<span class="pt-bar"><em class="mono">' + nums + '</em>' +
        '<i class="pt-track"><i class="pt-fill" style="width:' + w + '%"></i></i></span></div>';
    }).join('');

    var links = '';
    if (c.dagy && c.dagy.length) {
      links = '<div class="sec">GO TO 大观园</div>' + c.dagy.map(function (t) {
        return '<a class="plink" style="--c:' + s.color + '" target="_blank" rel="noopener" href="' +
          DAGY + 'subject.html#/' + t.sub + '/ch' + t.ch + '">' +
          '<em>大观园 · ' + esc(t.name) + '</em><span class="mono">进入章节 →</span></a>';
      }).join('') +
        '<a class="plink" style="--c:' + s.color + '" target="_blank" rel="noopener" href="' + dagyQuizUrl(c) + '">' +
        '<em>大观园 · 本章真题</em><span class="mono">去刷题 →</span></a>';
    }

    swap(
      '<div class="tag" style="--c:' + s.color + '">' + esc(s.name) + ' / ' + String(idx).padStart(2, '0') + '</div>' +
      '<h3 class="insp-title">' + esc(c.name) + '</h3>' +
      '<p class="insp-note">' + esc(c.note) + '</p>' +
      '<div class="metrics">' +
        '<div class="metric"><b class="mono" style="color:' + s.color + '">' + c.heat + '</b><span>热度</span></div>' +
        '<div class="metric"><b class="mono">' + c.choice + '</b><span>选择题</span></div>' +
        '<div class="metric"><b class="mono">' + c.comp + '</b><span>综合题</span></div>' +
      '</div>' +
      '<div class="sec">ALL POINTS · ' + c.points.length + '</div>' + list + links +
      '<div class="sec">NOTE</div>' +
      '<p class="insp-note tight">一道真题常同时挂在多个知识点下，所以各点次数之和大于真实题量。这张表比的是相对轻重，不是绝对分值。<br><br>' +
      '<b>双击星图里这个节点</b>，直接打开大观园对应章节。</p>',
      '章节详情', 'c:' + c.id
    );
  }

  function renderPoint(n) {
    var c = CH[n.chapterId];
    var s = SUB[n.sub];
    var p = null;
    c.points.forEach(function (x) { if (x[0] === n.label) p = x; });
    var heat = n.heat || 0;

    swap(
      '<div class="tag" style="--c:' + s.color + '">' + esc(s.name) + ' / ' + esc(c.name) + '</div>' +
      '<h3 class="insp-title">' + esc(n.label) + '</h3>' +
      '<div class="metrics">' +
        '<div class="metric"><b class="mono" style="color:' + s.color + '">' + heat + '</b><span>热度</span></div>' +
        '<div class="metric"><b class="mono">' + (p && p[1] !== null ? p[1] : '—') + '</b><span>选择题</span></div>' +
        '<div class="metric"><b class="mono">' + (p && p[2] !== null ? p[2] : '—') + '</b><span>综合题</span></div>' +
      '</div>' +
      '<p class="insp-note">' + (p && p[3] ? '在 18 套卷中覆盖 ' + p[3] + ' 年。' : '该考点按章节统一统计，未单列覆盖年份。') +
      '热度 = 选择题次数 + 5 × 综合题次数，用来横向比较轻重。</p>' +
      '<div class="sec">GO TO 大观园</div>' +
      '<a class="plink" style="--c:' + s.color + '" target="_blank" rel="noopener" href="' + dagyChapterUrl(c) + '">' +
      '<em>大观园 · ' + esc(c.name) + '</em><span class="mono">进入章节 →</span></a>' +
      '<a class="plink" style="--c:' + s.color + '" target="_blank" rel="noopener" href="' + dagyQuizUrl(c) + '">' +
      '<em>本章真题</em><span class="mono">去刷题 →</span></a>',
      '知识点', 'p:' + n.id
    );
  }

  function renderYear(y) {
    var row = null;
    D.DIFFICULTY.forEach(function (d) { if (d.year === y) row = d; });
    if (!row) return;
    var topics = D.COMP_TOPICS.filter(function (t) { return t.years.indexOf(y) >= 0; });

    var stars = '';
    for (var i = 1; i <= 5; i++) {
      stars += '<i class="' + (i <= row.all ? 'on ' + (row.all >= 5 ? 'hot' : row.all === 4 ? 'warm' : '') : '') + '"></i>';
    }

    var topicHtml = topics.length ? topics.map(function (t) {
      var s = SUB[t.sub];
      return '<div class="topic-line" style="--c:' + s.color + '"><i></i><span>' + esc(t.name) +
        '<em class="mono">' + esc(s.name) + ' · 综合题</em></span></div>';
    }).join('') : '<div class="p-empty">该年无综合题记录</div>';

    swap(
      '<div class="tag" style="--c:#22d3ee">YEAR SCAN</div>' +
      '<div class="year-big mono">' + y + '<small>' + esc(row.tag) + '</small></div>' +
      '<div class="stars">' + stars + '</div>' +
      '<div class="radar-wrap">' + radarHTML(row) + '</div>' +
      '<div class="sec">COMPREHENSIVE · ' + topics.length + '</div>' + topicHtml,
      y + ' 年', 'y:' + y
    );
  }

  function radarHTML(row) {
    var size = 200, cx = size / 2, cy = size / 2 + 4, R = 60;
    var axes = [
      { key: 'ds', name: '数据', color: '#22d3ee', v: row.ds },
      { key: 'co', name: '组原', color: '#a78bfa', v: row.co },
      { key: 'os', name: '操作', color: '#fbbf24', v: row.os },
      { key: 'net', name: '网络', color: '#34d399', v: row.net }
    ];
    var pts = [];
    for (var v = 1; v <= 5; v++) {
      var ring = axes.map(function (a, i) {
        var ang = -Math.PI / 2 + i * (Math.PI / 2);
        var rr = R * (v / 5);
        return (cx + Math.cos(ang) * rr) + ',' + (cy + Math.sin(ang) * rr);
      }).join(' ');
      pts.push('<polygon class="radar-ring" points="' + ring + '"/>');
    }
    var spokes = axes.map(function (a, i) {
      var ang = -Math.PI / 2 + i * (Math.PI / 2);
      return '<line class="radar-spoke" x1="' + cx + '" y1="' + cy + '" x2="' +
        (cx + Math.cos(ang) * R) + '" y2="' + (cy + Math.sin(ang) * R) + '"/>';
    }).join('');

    var labels = axes.map(function (a, i) {
      var ang = -Math.PI / 2 + i * (Math.PI / 2);
      var lx = cx + Math.cos(ang) * (R + 26);
      var ly = cy + Math.sin(ang) * (R + 24);
      return '<text class="radar-label" x="' + lx + '" y="' + (ly + 3) + '" fill="' + a.color + '">' +
        esc(a.name) + ' ' + a.v + '</text>';
    }).join('');

    var poly = axes.map(function (a, i) {
      var ang = -Math.PI / 2 + i * (Math.PI / 2);
      var rr = R * (a.v / 5);
      return (cx + Math.cos(ang) * rr) + ',' + (cy + Math.sin(ang) * rr);
    }).join(' ');

    return '<svg viewBox="0 0 ' + size + ' ' + size + '" class="radar">' +
      pts + spokes +
      '<polygon class="radar-area" points="' + poly + '"/>' +
      '<circle class="radar-dot" cx="' + cx + '" cy="' + cy + '" r="2"/>' +
      labels + '</svg>' +
      '<div class="radar-cap mono">SUBJECT DIFFICULTY · ' + row.year + '</div>';
  }

  /* ==================================================================
     6. 演化矩阵
     ================================================================== */
  var matrixCells = [];

  function buildMatrix() {
    var out = '<div class="mx-row mx-head-row">' +
      '<div class="mx-corner"><span class="mono">综合题考点</span><em>↓ / 年份 →</em></div>' +
      YEARS.map(function (y) { return '<button class="mx-year mono" type="button" data-year="' + y + '">' + String(y).slice(2) + '</button>'; }).join('') +
      '</div>';

    var lastSub = null;
    D.COMP_TOPICS.forEach(function (t, ri) {
      if (lastSub !== null && lastSub !== t.sub) out += '<div class="mx-sep"></div>';
      lastSub = t.sub;
      var s = SUB[t.sub];
      var ch = t.chapter && CH[t.chapter];
      out += '<div class="mx-row" data-row="' + ri + '">' +
        '<a class="mx-label" style="--c:' + s.color + '" href="' + (ch ? dagyChapterUrl(ch) : dagySubjectUrl(t.sub)) +
        '" target="_blank" rel="noopener" title="去大观园看：' + esc(ch ? ch.name : s.name) + '">' +
        '<i></i><span>' + esc(t.name) + '</span><b class="mono">' + t.years.length + '</b></a>';

      YEARS.forEach(function (y) {
        var on = t.years.indexOf(y) >= 0;
        out += '<div class="mx-cell' + (on ? ' on' : '') + '" style="--c:' + s.color + '" ' +
          'data-topic="' + esc(t.name) + '" data-sub="' + esc(s.name) + '" ' +
          'data-chapter="' + (t.chapter || '') + '" data-year="' + y + '" data-on="' + (on ? 1 : 0) + '"></div>';
      });
      out += '</div>';
    });

    var grid = $('matrix-grid');
    grid.innerHTML = out;
    matrixCells = Array.prototype.slice.call(grid.querySelectorAll('.mx-cell'));

    grid.addEventListener('mouseover', function (e) {
      var cell = e.target.closest('.mx-cell');
      if (!cell) return;
      highlightMatrixCol(+cell.getAttribute('data-year'));
      var on = cell.getAttribute('data-on') === '1';
      showTip('<b class="mono">' + cell.getAttribute('data-year') + '</b><br>' + esc(cell.getAttribute('data-topic')) +
        '<em>' + esc(cell.getAttribute('data-sub')) + ' · ' + (on ? '该年综合题考过' : '该年未出现') + '</em>', e);
    });
    grid.addEventListener('mousemove', function (e) {
      if (TIP.classList.contains('show')) moveTip(e);
    });
    grid.addEventListener('mouseout', function (e) {
      if (e.target.closest('.mx-cell')) {
        hideTip();
        highlightMatrixCol(state.year);
      }
    });

    grid.addEventListener('click', function (e) {
      var cell = e.target.closest('.mx-cell');
      if (!cell || cell.getAttribute('data-on') !== '1') return;
      var y = +cell.getAttribute('data-year');
      var cid = cell.getAttribute('data-chapter');
      setYear(y);
      if (cid && CH[cid]) {
        state.chapter = cid;
        if (!graph.byId['ch:' + cid].expanded) graph.expand(cid);
        graph.focus('ch:' + cid, 1.15);
        renderChapter(CH[cid]);
      }
    });

    grid.addEventListener('click', function (e) {
      var yb = e.target.closest('.mx-year');
      if (!yb) return;
      setYear(+yb.getAttribute('data-year'));
    });
  }

  function highlightMatrixCol(y) {
    matrixCells.forEach(function (c) {
      c.classList.toggle('col-hot', String(y) === c.getAttribute('data-year'));
    });
  }
  function markMatrixYear(y) {
    highlightMatrixCol(y);
    $('matrix-grid').querySelectorAll('.mx-year').forEach(function (b) {
      b.classList.toggle('is-on', String(y) === b.getAttribute('data-year'));
    });
  }

  /* ==================================================================
     6b. 章节 × 年份 热力矩阵
     ================================================================== */
  function chapterCompYears(cid) {
    var map = {};
    D.COMP_TOPICS.forEach(function (t) {
      if (t.chapter !== cid) return;
      t.years.forEach(function (y) {
        if (!map[y]) map[y] = [];
        map[y].push(t.name);
      });
    });
    return map;
  }

  function buildHeatMatrix() {
    var order = { ds: 0, co: 1, os: 2, net: 3 };
    var annotated = D.CHAPTERS.filter(function (c) {
      return Object.keys(chapterCompYears(c.id)).length > 0;
    });
    var rows = annotated.slice().sort(function (a, b) {
      if (a.sub !== b.sub) return order[a.sub] - order[b.sub];
      return b.comp - a.comp;
    });
    var missing = D.CHAPTERS.filter(function (c) {
      return annotated.indexOf(c) < 0;
    });

    var out = '<div class="hm-row hm-head">' +
      '<div class="hm-corner"><span class="mono">章节 / 年份</span><em>按科目分组</em></div>' +
      YEARS.map(function (y) { return '<div class="hm-year mono">' + String(y).slice(2) + '</div>'; }).join('') +
      '<div class="hm-sum mono">综合</div></div>';

    var lastSub = null;
    rows.forEach(function (c) {
      var s = SUB[c.sub];
      if (c.sub !== lastSub) {
        lastSub = c.sub;
        var ann = rows.filter(function (r) { return r.sub === c.sub; }).length;
        out += '<div class="hm-group" data-sub="' + c.sub + '" style="--c:' + s.color + '">' +
          '<i></i>' + esc(s.name) +
          '<em class="mono">' + ann + ' / ' + CH_BY_SUB[c.sub].length + ' CHAPTERS</em></div>';
      }
      var map = chapterCompYears(c.id);
      var hit = Object.keys(map).length;
      out += '<div class="hm-row" data-chapter="' + c.id + '" data-sub="' + c.sub + '">' +
        '<div class="hm-label" style="--c:' + s.color + '"><i></i>' + esc(c.name) + '</div>';
      YEARS.forEach(function (y) {
        var on = !!map[y];
        out += '<div class="hm-cell' + (on ? ' on' : '') + '" style="--c:' + s.color + '"' +
          ' data-year="' + y + '" data-on="' + (on ? 1 : 0) + '"' +
          ' data-topics="' + esc((map[y] || []).join(' / ')) + '"></div>';
      });
      out += '<div class="hm-sum"><em class="mono">' + hit + '/18</em></div></div>';
    });

    var dup = {};
    missing.forEach(function (c) { dup[c.name] = (dup[c.name] || 0) + 1; });
    out += '<p class="hm-missing">无逐年标注、不进本表：' +
      missing.map(function (c) {
        return esc(c.name) + (dup[c.name] > 1 ? '（' + SUB[c.sub].short + '）' : '');
      }).join('、') +
      '。它们在 16 类考点之外，只有累计次数——不代表没考过大题。</p>';

    var grid = $('heat-grid');
    grid.innerHTML = out;

    grid.addEventListener('mouseover', function (e) {
      var cell = e.target.closest('.hm-cell');
      if (!cell) return;
      var row = cell.closest('.hm-row');
      var cid = row.getAttribute('data-chapter');
      var c = CH[cid];
      var y = cell.getAttribute('data-year');
      var on = cell.getAttribute('data-on') === '1';
      var topics = cell.getAttribute('data-topics');
      showTip('<b class="mono">' + y + '</b> · ' + esc(c.name) +
        '<em>' + (on ? '综合题：' + esc(topics) : '该年未进综合题') + '</em>', e);
      graph.setHighlight(['ch:' + cid], [cid]);
    });
    grid.addEventListener('mousemove', function (e) {
      if (TIP.classList.contains('show')) moveTip(e);
    });
    grid.addEventListener('mouseout', function (e) {
      if (e.target.closest('.hm-cell')) { hideTip(); clearYearHighlight(); }
    });
    grid.addEventListener('click', function (e) {
      var row = e.target.closest('.hm-row');
      if (!row || row.classList.contains('hm-head')) return;
      focusChapter(row.getAttribute('data-chapter'), true);
    });
  }

  function syncHeatFilter() {
    if (!$('heat-grid')) return;
    var rows = $('heat-grid').querySelectorAll('.hm-row[data-sub], .hm-group[data-sub]');
    for (var i = 0; i < rows.length; i++) {
      var sub = rows[i].getAttribute('data-sub');
      rows[i].classList.toggle('is-off', !!state.subject && sub !== state.subject);
    }
  }

  /* ==================================================================
     6c. 跨科连体（CO ↔ OS 三条机制链）
     ================================================================== */
  function buildSankey() {
    var svg = $('sankey');
    var H = 440, LX = 186, MX = 452, RX = 714;
    var unit = 5.4, gap = 38;

    var leftIds = D.CROSS.map(function (x) { return x.a; });
    var rightIds = D.CROSS.map(function (x) { return x.b; });

    function stack(ids) {
      var hs = ids.map(function (id) { return Math.max(26, CH[id].comp * unit); });
      var total = hs.reduce(function (a, b) { return a + b; }, 0) + gap * (ids.length - 1);
      var y = 40 + (H - 62 - total) / 2;
      return ids.map(function (id, i) {
        var o = { id: id, c: CH[id], y0: y, y1: y + hs[i], cy: y + hs[i] / 2, h: hs[i] };
        y += hs[i] + gap;
        return o;
      });
    }
    var L = stack(leftIds), R = stack(rightIds);

    function ribbon(x0, y0, y1, x1, yc) {
      var mx = (x0 + x1) / 2;
      return 'M' + x0 + ',' + y0 +
        ' C' + mx + ',' + y0 + ' ' + mx + ',' + yc + ' ' + x1 + ',' + yc +
        ' C' + mx + ',' + yc + ' ' + mx + ',' + y1 + ' ' + x0 + ',' + y1 + ' Z';
    }
    function ribbonTo(x0, yc, x1, y0, y1) {
      var mx = (x0 + x1) / 2;
      return 'M' + x0 + ',' + yc +
        ' C' + mx + ',' + yc + ' ' + mx + ',' + y0 + ' ' + x1 + ',' + y0 +
        ' L' + x1 + ',' + y1 +
        ' C' + mx + ',' + y1 + ' ' + mx + ',' + yc + ' ' + x0 + ',' + yc + ' Z';
    }
    function lineTo(x0, y0, x1, y1) {
      var mx = (x0 + x1) / 2;
      return 'M' + x0 + ',' + y0 + ' C' + mx + ',' + y0 + ' ' + mx + ',' + y1 + ' ' + x1 + ',' + y1;
    }

    var out = '<defs>';
    D.CROSS.forEach(function (lk, i) {
      out += '<linearGradient id="skg' + i + '" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="' + SUB[CH[lk.a].sub].color + '" stop-opacity=".6"/>' +
        '<stop offset="1" stop-color="' + SUB[CH[lk.b].sub].color + '" stop-opacity=".6"/>' +
        '</linearGradient>';
    });
    out += '</defs>';

    out += '<text class="sk-col" x="' + (LX - 10) + '" y="20" text-anchor="end">计算机组成原理</text>';
    out += '<text class="sk-col" x="' + (RX + 10) + '" y="20">操作系统</text>';
    out += '<text class="sk-col dim" x="' + MX + '" y="20" text-anchor="middle">同一机制</text>';

    D.CROSS.forEach(function (lk, i) {
      var l = L[i], r = R[i];
      var cy = (l.cy + r.cy) / 2;
      var rad = 9 + (l.c.comp + r.c.comp) * 0.26;

      out += '<g class="sk-link" data-link="' + i + '">' +
        '<path class="sk-ribbon" d="' + ribbon(LX + 7, l.y0, l.y1, MX - rad, cy) + '" fill="url(#skg' + i + ')"/>' +
        '<path class="sk-ribbon" d="' + ribbonTo(MX + rad, cy, RX, r.y0, r.y1) + '" fill="url(#skg' + i + ')"/>' +
        '<path class="sk-flow" d="' + lineTo(LX + 7, l.cy, MX - rad, cy) + '"/>' +
        '<path class="sk-flow" d="' + lineTo(MX + rad, cy, RX, r.cy) + '"/>' +
        '<circle class="sk-circle" cx="' + MX + '" cy="' + cy + '" r="' + rad + '" ' +
        'style="--c:' + SUB[CH[lk.a].sub].color + '"/>' +
        '<text class="sk-mech" x="' + MX + '" y="' + (cy - rad - 11) + '" text-anchor="middle">' + esc(lk.name) + '</text>' +
        '<text class="sk-w" x="' + MX + '" y="' + (cy + rad + 16) + '" text-anchor="middle">' +
        (l.c.comp + r.c.comp) + ' 次综合题</text>' +
        '</g>';
    });

    [L, R].forEach(function (col, side) {
      col.forEach(function (o, i) {
        var x = side === 0 ? LX : RX;
        var color = SUB[o.c.sub].color;
        var lk = D.CROSS[i];
        out += '<g class="sk-node" data-chapter="' + o.id + '" style="--c:' + color + '">' +
          '<rect class="sk-bar" x="' + x + '" y="' + o.y0 + '" width="7" height="' + (o.y1 - o.y0) + '" rx="2"/>' +
          '<text class="sk-name" x="' + (side === 0 ? x - 13 : x + 14) + '" y="' + (o.cy - 2) + '" ' +
          'text-anchor="' + (side === 0 ? 'end' : 'start') + '">' + esc(o.c.name) + '</text>' +
          '<text class="sk-meta" x="' + (side === 0 ? x - 13 : x + 14) + '" y="' + (o.cy + 12) + '" ' +
          'text-anchor="' + (side === 0 ? 'end' : 'start') + '">综 ' + o.c.comp + ' · 选 ' + o.c.choice + '</text>' +
          '<title>' + esc(o.c.name) + ' · 综合题 ' + o.c.comp + ' 次</title>' +
          '</g>';
      });
    });

    out += '<line class="sk-axis" x1="' + MX + '" y1="30" x2="' + MX + '" y2="' + (H - 20) + '"/>';
    svg.innerHTML = out;

    svg.addEventListener('mouseover', function (e) {
      var g = e.target.closest('.sk-link');
      if (g) {
        var i = +g.getAttribute('data-link');
        var lk = D.CROSS[i];
        svg.classList.add('is-focus');
        g.classList.add('is-hot');
        graph.setHighlight(['ch:' + lk.a, 'ch:' + lk.b], [lk.a, lk.b]);
        showTip('<b>' + esc(lk.name) + '</b><em>' + esc(lk.note) + '</em>', e);
        return;
      }
      var n = e.target.closest('.sk-node');
      if (n) {
        graph.setHighlight(['ch:' + n.getAttribute('data-chapter')], [n.getAttribute('data-chapter')]);
      }
    });
    svg.addEventListener('mousemove', function (e) {
      if (TIP.classList.contains('show')) moveTip(e);
    });
    svg.addEventListener('mouseout', function (e) {
      var g = e.target.closest('.sk-link');
      if (g) { g.classList.remove('is-hot'); svg.classList.remove('is-focus'); hideTip(); clearYearHighlight(); }
    });
    svg.addEventListener('click', function (e) {
      var n = e.target.closest('.sk-node');
      if (n) focusChapter(n.getAttribute('data-chapter'), true);
    });
  }

  /* ==================================================================
     7. 难度曲线
     ================================================================== */
  var CHART = { W: 660, H: 400, padL: 30, padR: 16, padT: 26, padB: 44 };
  var chartX = function (i) {
    return CHART.padL + (CHART.W - CHART.padL - CHART.padR) / (YEARS.length - 1) * i;
  };
  var chartY = function (v) {
    var ih = CHART.H - CHART.padT - CHART.padB;
    return CHART.padT + ih - ((v - 1) / 4) * ih;
  };
  var SERIES = [
    { key: 'all', name: '整体', color: '#22d3ee', w: 2.2 },
    { key: 'ds', name: '数据结构', color: '#22d3ee', w: 1.2 },
    { key: 'co', name: '组成原理', color: '#a78bfa', w: 1.2 },
    { key: 'os', name: '操作系统', color: '#fbbf24', w: 1.2 },
    { key: 'net', name: '计算机网络', color: '#34d399', w: 1.2 }
  ];

  function buildChart() {
    var svg = $('diff-chart');
    svg.setAttribute('viewBox', '0 0 ' + CHART.W + ' ' + CHART.H);
    var padL = CHART.padL, padR = CHART.padR, H = CHART.H, padB = CHART.padB;
    var out = '<defs><linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#22d3ee" stop-opacity=".26"/>' +
      '<stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></linearGradient>' +
      '<filter id="chartGlow" x="-40%" y="-40%" width="180%" height="180%">' +
      '<feGaussianBlur stdDeviation="3.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';

    for (var v = 1; v <= 5; v++) {
      out += '<line class="c-grid" x1="' + padL + '" y1="' + chartY(v) + '" x2="' + (CHART.W - padR) + '" y2="' + chartY(v) + '"/>';
      out += '<text class="c-tick-y mono" x="' + (padL - 9) + '" y="' + (chartY(v) + 3.5) + '">' + v + '</text>';
    }
    out += '<line class="c-axis" x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (CHART.W - padR) + '" y2="' + (H - padB) + '"/>';

    var pts = D.DIFFICULTY.map(function (d, i) { return chartX(i) + ',' + chartY(d.all); });
    var area = 'M' + chartX(0) + ',' + chartY(1) + ' L' + pts.join(' L ') + ' L' + chartX(YEARS.length - 1) + ',' + chartY(1) + ' Z';
    out += '<path class="c-area" d="' + area + '" fill="url(#areaG)"/>';

    SERIES.forEach(function (s) {
      if (s.key === 'all') return;
      var p = D.DIFFICULTY.map(function (d, i) { return chartX(i) + ',' + chartY(d[s.key]); });
      out += '<polyline class="c-serie" data-series="' + s.key + '" points="' + p.join(' ') +
        '" fill="none" stroke="' + s.color + '" stroke-width="' + s.w + '" stroke-opacity="0"/>';
    });

    out += '<polyline class="c-main" points="' + pts.join(' ') + '" fill="none" stroke="#22d3ee" ' +
      'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" filter="url(#chartGlow)"/>';

    D.DIFFICULTY.forEach(function (d, i) {
      out += '<circle class="c-dot" cx="' + chartX(i) + '" cy="' + chartY(d.all) + '" r="3.4" ' +
        'data-year="' + d.year + '" data-all="' + d.all + '" data-tag="' + esc(d.tag) + '"/>';
      out += '<text class="c-tick mono" x="' + chartX(i) + '" y="' + (H - padB + 18) + '">' + d.year + '</text>';
    });

    out += '<g class="c-cursor" id="chart-cursor" style="opacity:0">' +
      '<line x1="0" y1="' + CHART.padT + '" x2="0" y2="' + (H - padB) + '"/>' +
      '<circle class="c-cursor-dot" r="5" cx="0" cy="0"/></g>';

    out += '<rect class="c-hit" fill="transparent" x="' + padL + '" y="0" width="' + (CHART.W - padL - padR) + '" height="' + (H - 10) + '"/>';

    svg.innerHTML = out;

    /* 入场：路径描边 */
    var main = svg.querySelector('.c-main');
    if (main && main.getTotalLength) {
      var len = main.getTotalLength();
      main.style.strokeDasharray = len;
      main.style.strokeDashoffset = len;
      requestAnimationFrame(function () {
        main.style.transition = 'stroke-dashoffset 1.6s cubic-bezier(.25,.8,.25,1)';
        main.style.strokeDashoffset = '0';
      });
    }

    /* 图例 */
    $('trend-legend').innerHTML = SERIES.map(function (s) {
      return '<button class="lg' + (s.key === 'all' || state.series[s.key] ? ' is-on' : '') +
        '" type="button" data-series="' + s.key + '" style="--c:' + s.color + '"><i></i>' + s.name + '</button>';
    }).join('');

    $('trend-legend').addEventListener('click', function (e) {
      var b = e.target.closest('.lg');
      if (!b) return;
      var key = b.getAttribute('data-series');
      if (key === 'all') return;
      state.series[key] = !state.series[key];
      b.classList.toggle('is-on', state.series[key]);
      var line = svg.querySelector('[data-series="' + key + '"]');
      if (line) line.style.strokeOpacity = state.series[key] ? 0.85 : 0;
    });

    /* 交互 */
    svg.addEventListener('mousemove', function (e) {
      var rect = svg.getBoundingClientRect();
      var sx = (e.clientX - rect.left) / rect.width * CHART.W;
      var idx = Math.round((sx - padL) / ((CHART.W - padL - padR) / (YEARS.length - 1)));
      idx = clamp(idx, 0, YEARS.length - 1);
      var d = D.DIFFICULTY[idx];
      var cur = svg.querySelector('#chart-cursor');
      cur.style.opacity = 1;
      cur.querySelector('line').setAttribute('x1', chartX(idx));
      cur.querySelector('line').setAttribute('x2', chartX(idx));
      cur.querySelector('circle').setAttribute('cx', chartX(idx));
      cur.querySelector('circle').setAttribute('cy', chartY(d.all));
      showTip('<b class="mono">' + d.year + ' 年</b><br>整体难度 ' + d.all + ' / 5<em>' + esc(d.tag) + '</em>', e);
      if (state.year !== d.year) setYear(d.year, { silentPanel: false });
    });

    svg.addEventListener('mouseleave', function () {
      var cur = svg.querySelector('#chart-cursor');
      if (cur) cur.style.opacity = 0;
      hideTip();
      if (!state.playing) {
        state.year = null;
        paintRail();
        markMatrixYear(null);
        clearYearHighlight();
        restorePanel();
      }
    });
  }

  function markChartYear(y) {
    var svg = $('diff-chart');
    if (!svg) return;
    svg.querySelectorAll('.c-dot').forEach(function (d) {
      d.classList.toggle('is-on', String(y) === d.getAttribute('data-year'));
    });
  }

  /* ==================================================================
     8. 高频榜
     ================================================================== */
  function buildTopList() {
    var all = [];
    D.CHAPTERS.forEach(function (c) {
      c.points.forEach(function (p) {
        var h = heatOf(p);
        if (h === null) return;
        all.push({ name: p[0], heat: h, choice: p[1], comp: p[2], sub: c.sub, chapter: c.id, chapterName: c.name });
      });
    });
    all.sort(function (a, b) { return b.heat - a.heat; });
    var top = all.slice(0, 14);
    var max = top[0].heat;

    $('toplist').innerHTML = top.map(function (t, i) {
      var s = SUB[t.sub];
      return '<div class="tl-row" style="--c:' + s.color + '" data-chapter="' + t.chapter + '">' +
        '<div class="tl-rank mono">' + String(i + 1).padStart(2, '0') + '</div>' +
        '<div class="tl-main">' +
          '<div class="tl-name"><i></i>' + esc(t.name) + '<em>' + esc(t.chapterName) + '</em></div>' +
          '<div class="tl-track"><div class="tl-bar" data-w="' + (t.heat / max * 100).toFixed(1) + '%"></div></div>' +
        '</div>' +
        '<div class="tl-val mono">' + t.heat + '<small>选' + t.choice + ' / 综' + t.comp + '</small></div>' +
      '</div>';
    }).join('');

    var rows = $('toplist').querySelectorAll('.tl-row');
    rows.forEach(function (row) {
      var cid = row.getAttribute('data-chapter');
      row.addEventListener('mouseenter', function (e) {
        graph.setHighlight(['ch:' + cid], [cid]);
        graph.pulse('ch:' + cid);
        showTip('<b>' + esc(CH[cid].name) + '</b><em>热度 ' + CH[cid].heat + ' · 点击展开该章知识点</em>', e);
      });
      row.addEventListener('mousemove', function (e) { moveTip(e); });
      row.addEventListener('mouseleave', function () { hideTip(); clearYearHighlight(); });
      row.addEventListener('click', function () {
        var n = graph.byId['ch:' + cid];
        if (n && !n.expanded) graph.expand(cid);
        state.chapter = cid;
        graph.focus('ch:' + cid, 1.2);
        renderChapter(CH[cid]);
        $('map').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /* ==================================================================
     9. 阶段 / 洞察
     ================================================================== */
  function buildPhases() {
    var colors = ['#22d3ee', '#a78bfa', '#fbbf24'];
    $('phases').innerHTML = D.PHASES.map(function (p, i) {
      return '<article class="phase" style="--c:' + colors[i] + '" data-i="' + i + '">' +
        '<div class="phase-node"><i></i><b class="mono">0' + (i + 1) + '</b></div>' +
        '<div class="phase-range mono">' + p.range + '</div>' +
        '<h3 class="phase-name">' + esc(p.name) + '</h3>' +
        '<p class="phase-desc">' + esc(p.desc) + '</p>' +
        '<div class="phase-points">' + p.points.map(function (x) { return '<span class="mono">' + esc(x) + '</span>'; }).join('') + '</div>' +
      '</article>';
    }).join('');
  }

  function buildInsights() {
    $('insights').innerHTML = D.INSIGHTS.map(function (x, i) {
      return '<article class="ins" style="--c:' + x.color + '" data-reveal data-delay="' + (i % 4) * 60 + '">' +
        '<span class="ins-tag mono">' + esc(x.tag) + '</span>' +
        '<h3 class="ins-title">' + esc(x.title) + '</h3>' +
        '<p class="ins-desc">' + esc(x.desc) + '</p>' +
      '</article>';
    }).join('');
  }

  /* ==================================================================
     10. 入场动画 / 计数 / 时间线进度
     ================================================================== */
  function countUp() {
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var to = +el.getAttribute('data-count');
      if (INSTANT) { el.textContent = to; return; }
      tween(1100, function (k) { el.textContent = Math.round(to * k); });
    });
  }

  function observeReveals() {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        var d = +(el.getAttribute('data-delay') || 0);
        setTimeout(function () { el.classList.add('in'); }, d);
        io.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('[data-reveal]').forEach(function (el) { io.observe(el); });

    // 高频榜条形
    var bars = document.querySelectorAll('.tl-bar');
    bars.forEach(function (b) {
      var io2 = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) {
            b.style.width = b.getAttribute('data-w');
            io2.unobserve(b);
          }
        });
      }, { threshold: 0.2 });
      io2.observe(b);
    });

    // 时间线进度
    var tl = $('timeline');
    var io3 = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) {
          $('tl-progress').style.width = '100%';
          io3.unobserve(e.target);
        }
      });
    }, { threshold: 0.3 });
    io3.observe(tl);
  }

  /* ==================================================================
     11. 启动
     ================================================================== */
  function init() {
    $('stat-points').textContent = TOTAL_POINTS;

    buildRail();
    buildFilters();
    buildMatrix();
    buildHeatMatrix();
    buildSankey();
    buildChart();
    buildTopList();
    buildPhases();
    buildInsights();
    renderDefault();
    countUp();
    observeReveals();

    // 首屏尺寸往往在 CSS 生效后才稳定，延后一次取景
    setTimeout(function () { graph.fit(null, 20); }, 80);

    window.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.key === 'Escape') $('reset-btn').click();
    });

    var rzTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(rzTimer);
      rzTimer = setTimeout(function () {
        graph.insets = window.innerWidth > 1120
          ? { left: 40, right: 400, top: 128, bottom: 70 }
          : { left: 8, right: 8, top: 16, bottom: 16 };
        graph.fit(null, 20);
      }, 220);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
