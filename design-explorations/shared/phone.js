/* Setzt in jeden .phone die Statusleiste (Uhrzeit, Empfang, WLAN, Akku) und den Home-Indikator ein. */
(function () {
  var bars = '<svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx=".8"/><rect x="5" y="5.5" width="3" height="6.5" rx=".8"/><rect x="10" y="3" width="3" height="9" rx=".8"/><rect x="15" y="0" width="3" height="12" rx=".8"/></svg>';
  var wifi = '<svg viewBox="0 0 17 12"><path d="M8.5 2.4c2.3 0 4.4.9 6 2.4l1.1-1.2A10.4 10.4 0 0 0 8.5.7 10.4 10.4 0 0 0 1.4 3.6l1.1 1.2a8.7 8.7 0 0 1 6-2.4Zm0 3.6c1.3 0 2.5.5 3.4 1.3l1.1-1.2a7 7 0 0 0-9 0l1.1 1.2c.9-.8 2.1-1.3 3.4-1.3Zm0 3.5c.6 0 1.1.2 1.5.6L8.5 12 7 10.100c.4-.4.9-.6 1.500-.6Z"/></svg>';
  var battery = '<svg viewBox="0 0 27 12"><rect x=".5" y=".5" width="23" height="11" rx="3.200" fill="none" stroke="#fff" stroke-opacity=".4"/><rect x="2" y="2" width="20" height="8" rx="2" /><path d="M25 4v4c.8-.3 1.500-1.100 1.500-2S25.800 4.300 25 4Z" fill-opacity=".45"/></svg>';
  function init() {
    document.querySelectorAll('.phone').forEach(function (p) {
      var s = document.createElement('div');
      s.className = 'statusbar';
      s.setAttribute('aria-hidden', 'true');
      s.innerHTML = '<span class="sb-time">9:41</span><span class="sb-right">' + bars + wifi + battery + '</span>';
      p.appendChild(s);
      var h = document.createElement('div');
      h.className = 'homebar';
      p.appendChild(h);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
