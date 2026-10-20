/* Liquid-Glass-Engine für die Prototypen (nur Chromium zeigt die Lichtbrechung; andere Browser fallen auf Weichzeichnen zurück).
 *
 * Für jedes Element mit der Klasse .glass entsteht eine Hilfsebene <glass-bd> hinter dem Inhalt (eigener Elementname, damit keine Selektoren der Varianten sie treffen):
 *   1. Sie ist größer als das Glas und wird per clip-path auf dessen Form zugeschnitten. backdrop-filter sieht nur Inhalt innerhalb
 *      seines Elements und spiegelt am Rand; mit der größeren Ebene hat die Weichzeichnung echten Kontext (wie bei Apples Glas).
 *   2. Verschiebungskarte (feDisplacementMap): Rand gewölbt wie eine Linse, Mitte neutral. Das biegt, was hinter dem Glas liegt.
 *   3. Optional Farbsäume (chromatische Dispersion): Rot, Grün und Blau werden unterschiedlich stark verschoben.
 *   4. backdrop-filter: url(#…) blur() saturate() brightness() – Weichzeichnung und Tönung kommen aus CSS-Variablen.
 * Glanzlicht, Rand und Schatten zeichnet das CSS (siehe base.css, .glass::before und ::after).
 *
 * Steuerung per CSS-Variablen am Element oder an einem Vorfahren:
 *   --lens-scale    größter Versatz am Rand in px (0 = keine Lichtbrechung, nur Weichzeichnen)    Standard 14
 *   --lens-bezel    Breite des gewölbten Rands in px                                             Standard min(h/2, 18)
 *   --lens-power    Abfall der Wölbung nach innen (größer = schmaler, schärfer)                  Standard 2.4
 *   --lens-chroma   Stärke der Farbsäume 0…1                                                     Standard 0
 *   --glass-blur (höchstens 14 px), --glass-sat, --glass-bright, --glass-contrast
 *   Faustregel: Versatz höchstens 22 % der kleineren Seite, Rand höchstens 45 %.
 */
(function () {
  'use strict';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var XLINK = 'http://www.w3.org/1999/xlink';
  var counter = 0;
  var host;

  function num(cs, name, fallback) {
    var v = parseFloat(cs.getPropertyValue(name));
    return isFinite(v) ? v : fallback;
  }

  // Vorzeichenbehafteter Abstand zu einem Rechteck mit runden Ecken (negativ = innen)
  function sdRoundRect(x, y, w, h, r) {
    var qx = Math.abs(x - w / 2) - (w / 2 - r);
    var qy = Math.abs(y - h / 2) - (h / 2 - r);
    var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
  }

  /** Verschiebungskarte als PNG (Größe der Hilfsebene, das Glas liegt mit Abstand m darin). R = x, G = y (128 = neutral). */
  function lensMap(W, H, m, w, h, r, bezel, power) {
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(W, H);
    var d = img.data, e = 0.5;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var px = x + 0.5 - m, py = y + 0.5 - m;
        var i = (y * W + x) * 4;
        var vx = 0, vy = 0;
        if (px > 0 && py > 0 && px < w && py < h) {
          var depth = -sdRoundRect(px, py, w, h, r); // Abstand zum Rand nach innen
          if (depth > 0 && depth < bezel) {
            var mag = Math.pow(1 - depth / bezel, power);
            var gx = sdRoundRect(px + e, py, w, h, r) - sdRoundRect(px - e, py, w, h, r);
            var gy = sdRoundRect(px, py + e, w, h, r) - sdRoundRect(px, py - e, w, h, r);
            var gl = Math.sqrt(gx * gx + gy * gy) || 1;
            // Der Gradient zeigt nach außen; gesampelt wird weiter innen
            vx = -(gx / gl) * mag;
            vy = -(gy / gl) * mag;
          }
        }
        d[i] = Math.round(128 + 127 * vx);
        d[i + 1] = Math.round(128 + 127 * vy);
        d[i + 2] = 128;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  function ensureHost() {
    if (host) return host;
    host = document.createElementNS(SVG_NS, 'svg');
    host.setAttribute('width', '0');
    host.setAttribute('height', '0');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    document.body.appendChild(host);
    return host;
  }

  function el(name, attrs) {
    var n = document.createElementNS(SVG_NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function build(node) {
    var cs = getComputedStyle(node);
    var w = Math.round(node.offsetWidth), h = Math.round(node.offsetHeight);
    if (!w || !h) return;
    // Der Renderer der Screenshot-Umgebung (Chromium ohne GPU) verliert oberhalb von etwa 14 px an Weichzeichnung (Aliasing, gemessen:
    // Streuung 0,6 bei 12 px, 6 bei 22 px, 34 bei 40 px). Größeres Milchglas entsteht deshalb über Tönung und Sättigung.
    var blur = Math.min(14, num(cs, '--glass-blur', 12)), sat = num(cs, '--glass-sat', 1.6);
    var bright = num(cs, '--glass-bright', 1), contrast = num(cs, '--glass-contrast', 1);
    var scale = num(cs, '--lens-scale', 14) * 2; // feDisplacementMap verschiebt um scale * (Kanalwert - 0,5), der Kartenwert reicht nur bis ±0,5
    var r = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2);
    var m = Math.min(110, Math.ceil(blur * 2.4) + 16); // Überstand der Hilfsebene
    var W = w + 2 * m, H = h + 2 * m;

    var bd = node.querySelector(':scope > glass-bd');
    if (!bd) { bd = document.createElement('glass-bd'); bd.setAttribute('aria-hidden', 'true'); node.insertBefore(bd, node.firstChild); }
    bd.style.setProperty('--bd', m + 'px');
    bd.style.setProperty('--bd-r', r + 'px');

    var tail = 'blur(' + blur + 'px) saturate(' + sat + ') brightness(' + bright + ') contrast(' + contrast + ')';
    var value = tail;
    if (scale > 0 && node.getAttribute('data-lens') !== 'off') {
      var bezel = num(cs, '--lens-bezel', Math.min(h / 2, 18));
      var power = num(cs, '--lens-power', 2.4);
      var chroma = num(cs, '--lens-chroma', 0);
      var id = 'lg-' + (++counter);
      var map = lensMap(W, H, m, w, h, r, bezel, power);
      var f = el('filter', { id: id, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H, 'color-interpolation-filters': 'sRGB' });
      var im = el('feImage', { x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none', result: 'map' });
      im.setAttribute('href', map);
      im.setAttributeNS(XLINK, 'xlink:href', map);
      f.appendChild(im);
      if (chroma > 0) {
        var ch = [['dr', 'r', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1', scale * (1 + chroma)],
                  ['dg', 'g', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 0 1', scale],
                  ['db', 'b', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 0 1', scale * (1 - chroma)]];
        ch.forEach(function (c) {
          f.appendChild(el('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: c[3], xChannelSelector: 'R', yChannelSelector: 'G', result: c[0] }));
          f.appendChild(el('feColorMatrix', { in: c[0], type: 'matrix', values: c[2], result: c[1] }));
        });
        f.appendChild(el('feBlend', { in: 'r', in2: 'g', mode: 'screen', result: 'rg' }));
        f.appendChild(el('feBlend', { in: 'rg', in2: 'b', mode: 'screen' }));
      } else {
        f.appendChild(el('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: scale, xChannelSelector: 'R', yChannelSelector: 'G' }));
      }
      ensureHost().appendChild(f);
      value = 'url(#' + id + ') ' + tail;
    }
    bd.style.webkitBackdropFilter = value;
    bd.style.backdropFilter = value;
  }

  function run() {
    if (host) { host.remove(); host = null; }
    counter = 0;
    document.querySelectorAll('.glass').forEach(build);
    document.documentElement.setAttribute('data-glass', 'ready');
  }

  window.Glass = { rebuild: run };
  var go = function () { (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () { requestAnimationFrame(run); }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
