/* ------------------------------------------------------------------
   美代桌宠 · 互动系统浏览器内测试
   用法：把本文件内容整段投给页面执行（见 .tmp/ix2.sh），随后读 window.__ixReport
   设计：全部动作在页面内用 setTimeout 编排，避免跨进程取样抖动
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  var pet = document.getElementById('pet');
  var base = document.getElementById('layerBase');
  var out = window.__ixReport = { t0: Date.now(), steps: [], mapping: [] };

  function now() { return Date.now() - out.t0; }
  function snap() { return window.MiyoPet.reaction(); }
  function rect() {
    var r = pet.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function down(x, y) { pet.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y })); }
  function up(x, y) { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y })); }
  function click(x, y) { pet.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })); }
  function tap() { var p = rect(); down(p.x, p.y); up(p.x, p.y); click(p.x, p.y); }
  function rec(tag) {
    var s = snap();
    out.steps.push({
      t: now(), tag: tag,
      spr: s ? s.spr : '-',
      line: s ? s.line.slice(0, 12) : '-',
      src: base.getAttribute('src')
    });
  }

  /* ---------- 0) 映射检查：直接调 react，逐个读回 ---------- */
  for (var n = 1; n <= 8; n++) {
    window.MiyoPet.react('click', n);
    var s1 = snap();
    out.mapping.push({ key: 'click#' + n, spr: s1 ? s1.spr : null });
  }
  ['dblclick', 'longpress', 'dragstart', 'drop', 'hover'].forEach(function (k) {
    window.MiyoPet.react(k);
    var s2 = snap();
    out.mapping.push({ key: k, spr: s2 ? s2.spr : null, left: s2 ? s2.left : null });
  });

  /* ---------- 1) 时序编排 ---------- */
  var seq = [];
  for (var i = 0; i < 8; i++) {
    seq.push({ tag: '单击#' + (i + 1), run: tap, wait: 520 });
  }
  seq.push({ tag: '— 等反应过期 —', run: function () {}, wait: 2600 });

  seq.push({ tag: '双击', run: function () { tap(); tap(); pet.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }, wait: 700 });

  seq.push({ tag: '长按-按下', run: function () { var p = rect(); down(p.x, p.y); }, wait: 1100 });
  seq.push({ tag: '长按-抬起', run: function () { var p = rect(); up(p.x, p.y); }, wait: 2600 });

  seq.push({ tag: '开始拖动', run: function () { var p = rect(); down(p.x, p.y); document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: p.x + 70, clientY: p.y + 10 })); }, wait: 600 });
  seq.push({ tag: '松开放下', run: function () { var p = rect(); up(p.x, p.y); }, wait: 2600 });

  seq.push({ tag: '悬停 0s', run: function () { pet.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false })); }, wait: 1200 });
  seq.push({ tag: '悬停 +1.2s', run: function () {}, wait: 900 });
  seq.push({ tag: '结束', run: function () { out.finished = true; }, wait: 0 });

  var idx = 0;
  (function next() {
    if (idx >= seq.length) return;
    var step = seq[idx++];
    try { step.run(); } catch (e) { out.steps.push({ t: now(), tag: 'ERR ' + step.tag, err: String(e) }); }
    rec(step.tag);
    setTimeout(next, step.wait);
  })();

  return 'started';
})();
