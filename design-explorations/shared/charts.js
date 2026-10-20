/* Gemeinsame Beispieldaten (aus dem Demo-Konto der App) und ein kleiner Diagramm-Baukasten.
 * Alle zehn Varianten zeigen dieselben Zahlen; nur das Aussehen (Farbe, Strichstärke, Form) kommt aus dem jeweiligen CSS.
 *
 *   <div class="chart" data-series="oneRm" data-style="area|line|bars|dots|step" data-w="326" data-h="150" data-axis="y|none"></div>
 *
 * Gestaltet wird über CSS-Variablen am .chart: --c-stroke, --c-width, --c-fill-a, --c-fill-b, --c-grid, --c-dot, --c-dot-r, --c-label,
 * --c-bar-r (Eckenradius der Balken), --c-bar-gap. Klassen im SVG: .c-grid .c-line .c-area .c-bar .c-dot .c-last .c-ylab .c-xlab
 */
(function () {
  'use strict';
  window.DATA = {
    // Bankdrücken, geschätztes 1RM (Epley) je Woche; letzter Wert = Bestwert aus der Beispiel-Einheit 19.10.
    oneRm: { unit: 'kg', labels: ['31.08.', '07.09.', '14.09.', '21.09.', '28.09.', '05.10.', '12.10.', '19.10.'], values: [60.0, 62.5, 65.8, 68.3, 70.8, 73.3, 75.0, 76.7], min: 55, max: 80, ticks: [60, 70, 80] },
    // Körpergewicht der letzten zehn Tage (Daily)
    weight: { unit: 'kg', labels: ['11.10.', '12.10.', '13.10.', '14.10.', '15.10.', '16.10.', '17.10.', '18.10.', '19.10.', '20.10.'], values: [82.7, 82.6, 82.6, 82.4, 82.3, 82.2, 82.1, 82.0, 81.9, 82.0], min: 81.5, max: 83, ticks: [82, 83] },
  };

  var uid = 0;
  var fmt = function (n) { return String(n).replace('.', ','); };

  // glatte Kurve durch alle Punkte (Catmull-Rom → Bezier)
  function smooth(pts) {
    if (pts.length < 3) return 'M' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' L');
    var d = 'M' + pts[0][0] + ',' + pts[0][1];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, t = 0.18;
      d += ' C' + (p1[0] + (p2[0] - p0[0]) * t).toFixed(1) + ',' + (p1[1] + (p2[1] - p0[1]) * t).toFixed(1) + ' ' +
        (p2[0] - (p3[0] - p1[0]) * t).toFixed(1) + ',' + (p2[1] - (p3[1] - p1[1]) * t).toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
    }
    return d;
  }

  function render(el) {
    var s = window.DATA[el.dataset.series];
    if (!s) return;
    var style = el.dataset.style || 'line';
    var w = Number(el.dataset.w) || el.clientWidth, h = Number(el.dataset.h) || el.clientHeight;
    var axis = el.dataset.axis !== 'none';
    var padL = axis ? 30 : 6, padR = 10, padT = 10, padB = axis ? 24 : 8;
    var iw = w - padL - padR, ih = h - padT - padB;
    var X = function (i) { return padL + (s.values.length === 1 ? iw / 2 : (iw * i) / (s.values.length - 1)); };
    var Y = function (v) { return padT + ih - ((v - s.min) / (s.max - s.min)) * ih; };
    var pts = s.values.map(function (v, i) { return [X(i), Y(v)]; });
    var id = 'ch' + (++uid);
    var out = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="Verlauf ' + s.values.map(fmt).join(', ') + ' ' + s.unit + '">';
    out += '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--c-fill-a, rgba(255,255,255,.25))"/><stop offset="1" style="stop-color:var(--c-fill-b, rgba(255,255,255,0))"/></linearGradient></defs>';
    s.ticks.forEach(function (t) {
      out += '<line class="c-grid" x1="' + padL + '" x2="' + (w - padR) + '" y1="' + Y(t) + '" y2="' + Y(t) + '"/>';
      if (axis) out += '<text class="c-ylab" x="' + (padL - 8) + '" y="' + (Y(t) + 4) + '" text-anchor="end">' + fmt(t) + '</text>';
    });
    if (axis) {
      out += '<text class="c-xlab" x="' + padL + '" y="' + (h - 6) + '" text-anchor="start">' + s.labels[0] + '</text>';
      out += '<text class="c-xlab" x="' + (w - padR) + '" y="' + (h - 6) + '" text-anchor="end">' + s.labels[s.labels.length - 1] + '</text>';
    }
    var base = padT + ih;
    if (style === 'bars') {
      var gap = Number(getComputedStyle(el).getPropertyValue('--c-bar-gap')) || 8;
      var bw = Math.max(4, (iw - gap * (pts.length - 1)) / pts.length); // Balkenbreite
      pts.forEach(function (p, i) {
        var x = padL + i * (bw + gap);
        out += '<rect class="c-bar' + (i === pts.length - 1 ? ' c-last' : '') + '" x="' + x.toFixed(1) + '" y="' + p[1].toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (base - p[1]).toFixed(1) + '" style="rx:var(--c-bar-r,4px)"/>';
      });
    } else if (style === 'step') {
      var d = 'M' + pts[0][0] + ',' + pts[0][1];
      for (var i = 1; i < pts.length; i++) d += ' H' + pts[i][0].toFixed(1) + ' V' + pts[i][1].toFixed(1);
      out += '<path class="c-area" d="' + d + ' V' + base + ' H' + pts[0][0] + ' Z" fill="url(#' + id + ')"/>';
      out += '<path class="c-line" d="' + d + '" fill="none"/>';
    } else {
      var line = style === 'dots' ? 'M' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' L') : smooth(pts);
      if (style === 'area') out += '<path class="c-area" d="' + line + ' L' + pts[pts.length - 1][0] + ',' + base + ' L' + pts[0][0] + ',' + base + ' Z" fill="url(#' + id + ')"/>';
      out += '<path class="c-line" d="' + line + '" fill="none"/>';
    }
    if (style !== 'bars') {
      pts.forEach(function (p, i) {
        var last = i === pts.length - 1;
        if (style === 'dots' || last) out += '<circle class="c-dot' + (last ? ' c-last' : '') + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" style="r:' + (last ? 'var(--c-dot-last,5px)' : 'var(--c-dot-r,3px)') + '"/>';
      });
    }
    out += '</svg>';
    el.innerHTML = out;
  }

  window.Chart = { render: render, renderAll: function () { document.querySelectorAll('.chart').forEach(render); } };
  var go = function () { window.Chart.renderAll(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
