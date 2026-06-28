/* EnRuta — data.js
 * Expone window.HT_DATA (desde el JSON embebido en index.html) y construye
 * window.RV_HORARIOS en el formato que espera registro.js (array de tramos,
 * equivalente a lo que generaba _build_horarios.py de RV).
 * Cargado DESPUÉS del HTML (para que <script id="data"> exista) y ANTES de registro.js.
 */
(function () {
  'use strict';

  var dataEl = document.getElementById('data');
  window.HT_DATA = dataEl ? JSON.parse(dataEl.textContent) : {};

  var ATOCHA = 'MADRID-P.ATOCHA-ALMUDENA GRANDES';

  function isComStop(s, i, arr) {
    return !s._l010cdi && (!!s.c || i === 0 || i === arr.length - 1);
  }

  function buildTramo(march, stops) {
    if (stops.length < 2) return null;
    var orig = stops[0];
    var dest = stops[stops.length - 1];
    var paradas = stops.slice(1, -1).map(function (s) {
      return { nombre: s.n, hora: s.h || '', tParada: s.c || 0 };
    });
    return {
      servicio: march.t,
      origen: orig.n,
      destino: dest.n,
      hSalida: orig.h || '',
      hDestino: dest.h || '',
      paradas: paradas
    };
  }

  var tramos = [];
  Object.keys(window.HT_DATA).forEach(function (grp) {
    window.HT_DATA[grp].forEach(function (march) {
      var ss = march.s;
      var comStops = ss.filter(isComStop);
      if (comStops.length < 2) return;

      var corte = -1;
      for (var i = 1; i < comStops.length - 1; i++) {
        if (comStops[i].n === ATOCHA) { corte = i; break; }
      }

      if (corte > 0) {
        var t1 = buildTramo(march, comStops.slice(0, corte + 1));
        var t2 = buildTramo(march, comStops.slice(corte));
        if (t1) tramos.push(t1);
        if (t2) tramos.push(t2);
      } else {
        var t = buildTramo(march, comStops);
        if (t) tramos.push(t);
      }
    });
  });

  window.RV_HORARIOS = tramos;
})();
