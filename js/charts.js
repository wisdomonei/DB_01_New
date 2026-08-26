/**
 * 차트 — SVG 를 직접 그린다.
 *
 * 라이브러리를 쓰지 않는 이유는 두 가지다.
 *  ① 사내망에서 CDN 이 막히면 대시보드가 빈 칸이 된다.
 *  ② 필요한 그림이 도넛 하나와 꺾은선 하나뿐이다.
 *
 * 색만으로 계열을 구분하지 않는다. 도넛은 옆에 숫자·퍼센트를 같이 적고,
 * 꺾은선은 점마다 값을 적는다. 흑백으로 인쇄해도 읽힌다.
 */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  /** 상태 4개의 색. app.js·범례·표 배지가 이 값을 함께 쓴다. */
  var STATUS_COLOR = {
    '요청':      '#7c9cf5',
    '작업중':    '#22a06b',
    '검토/수정': '#e0913a',
    '완료':      '#6b5ce7'
  };

  function el(name, attrs) {
    var n = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function svg(w, h) {
    var s = el('svg', { viewBox: '0 0 ' + w + ' ' + h, width: '100%', role: 'img' });
    s.style.overflow = 'visible';
    return s;
  }

  /* --------------------------------------------------------------- 도넛 */

  /**
   * 상태별 분포 도넛.
   * @param {Element} host
   * @param {Array} rows [{status, count, pct}]
   */
  function donut(host, rows) {
    host.textContent = '';
    var size = 190, r = 74, cx = size / 2, cy = size / 2, w = 22;
    var total = rows.reduce(function (a, b) { return a + b.count; }, 0);
    var s = svg(size, size);
    s.setAttribute('aria-label', '상태별 작업 분포. 전체 ' + total + '건.');

    if (!total) {
      s.appendChild(el('circle', { cx: cx, cy: cy, r: r, fill: 'none',
                                   stroke: 'var(--hd-line)', 'stroke-width': w }));
      host.appendChild(s);
      return;
    }

    var C = 2 * Math.PI * r;
    var offset = 0;
    rows.forEach(function (row) {
      if (!row.count) return;
      var len = C * row.count / total;
      // 원호는 stroke-dasharray 로 그린다. path 로 그리면 100% 한 조각일 때
      // 시작점과 끝점이 같아 아무것도 그려지지 않는 함정이 있다.
      var arc = el('circle', {
        cx: cx, cy: cy, r: r, fill: 'none',
        stroke: STATUS_COLOR[row.status] || 'var(--accent)',
        'stroke-width': w,
        'stroke-dasharray': len.toFixed(2) + ' ' + (C - len).toFixed(2),
        'stroke-dashoffset': (-offset).toFixed(2),
        transform: 'rotate(-90 ' + cx + ' ' + cy + ')'
      });
      arc.appendChild(el('title', {})).textContent = row.status + ' ' + row.count + '건';
      s.appendChild(arc);
      offset += len;
    });

    var t1 = el('text', { x: cx, y: cy - 2, 'text-anchor': 'middle',
                          'font-size': 27, 'font-weight': 700, fill: 'var(--hd-ink)' });
    t1.textContent = String(total);
    var t2 = el('text', { x: cx, y: cy + 18, 'text-anchor': 'middle',
                          'font-size': 12, fill: 'var(--hd-ink-3)' });
    t2.textContent = '전체 요청';
    s.appendChild(t1); s.appendChild(t2);
    host.appendChild(s);
  }

  /* ------------------------------------------------------------- 꺾은선 */

  /**
   * 월별 추이 꺾은선.
   * @param {Element} host
   * @param {Array} pts [{label, count}]
   */
  function line(host, pts) {
    host.textContent = '';
    var W = 460, H = 190, padL = 34, padR = 14, padT = 18, padB = 30;
    var s = svg(W, H);
    if (!pts.length) { host.appendChild(s); return; }

    var max = Math.max.apply(null, pts.map(function (p) { return p.count; }));
    // 최댓값이 0이면 선이 바닥에 눌어붙는다. 눈금은 최소 4로 둔다.
    var top = Math.max(4, Math.ceil(max * 1.25));
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var stepX = pts.length > 1 ? innerW / (pts.length - 1) : 0;

    function X(i) { return padL + stepX * i; }
    function Y(v) { return padT + innerH - (v / top) * innerH; }

    // 가로 눈금 4줄
    for (var g = 0; g <= 4; g++) {
      var v = Math.round(top * g / 4);
      var y = Y(v);
      s.appendChild(el('line', { x1: padL, y1: y, x2: W - padR, y2: y,
                                 stroke: 'var(--hd-line-soft)', 'stroke-width': 1 }));
      var lab = el('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end',
                             'font-size': 10, fill: 'var(--hd-ink-3)' });
      lab.textContent = String(v);
      s.appendChild(lab);
    }

    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(i) + ' ' + Y(p.count); }).join(' ');
    var area = d + ' L' + X(pts.length - 1) + ' ' + Y(0) + ' L' + X(0) + ' ' + Y(0) + ' Z';

    s.appendChild(el('path', { d: area, fill: 'var(--accent)', 'fill-opacity': .10 }));
    s.appendChild(el('path', { d: d, fill: 'none', stroke: 'var(--accent)',
                               'stroke-width': 2.4, 'stroke-linejoin': 'round' }));

    pts.forEach(function (p, i) {
      var c = el('circle', { cx: X(i), cy: Y(p.count), r: 4.5,
                             fill: '#fff', stroke: 'var(--accent)', 'stroke-width': 2.4 });
      c.appendChild(el('title', {})).textContent = p.label + ' ' + p.count + '건';
      s.appendChild(c);

      var n = el('text', { x: X(i), y: Y(p.count) - 11, 'text-anchor': 'middle',
                           'font-size': 11, 'font-weight': 700, fill: 'var(--hd-ink-2)' });
      n.textContent = String(p.count);
      s.appendChild(n);

      var lb = el('text', { x: X(i), y: H - 10, 'text-anchor': 'middle',
                            'font-size': 11, fill: 'var(--hd-ink-3)' });
      lb.textContent = p.label;
      s.appendChild(lb);
    });

    s.setAttribute('aria-label', '월별 완료 추이. ' +
      pts.map(function (p) { return p.label + ' ' + p.count + '건'; }).join(', ') + '.');
    host.appendChild(s);
  }

  root.Charts = { donut: donut, line: line, STATUS_COLOR: STATUS_COLOR };
})(typeof self !== 'undefined' ? self : this);
