/* RV Iryo — Registro de Viajes
 * Toda la lógica de la app: modelo, almacenamiento, calendario, editor de
 * turno, exportación PDF, estadísticas y ajustes. Vanilla JS, sin frameworks.
 * El Libro de Horarios se embebe vía horarios.js (window.RV_HORARIOS), así
 * funciona también abriendo el archivo directamente (file://) y sin conexión.
 */
(function () {
  'use strict';

  function normName(n) { return (n || '').toUpperCase().replace(/[-\s]+/g, ' ').trim(); }

  // ===== Constantes =====
  var K_TURNOS = 'rviryo_turnos_v1';
  var K_SETTINGS = 'rviryo_settings_v1';
  var APP_VERSION = 'iryostudio-v6';

  var COMPROBACIONES = [
    'Arranque rama', 'Estado Pantógrafo', 'DAT/DHLTV', 'ASFA', 'ETCS/LZB',
    'Datos Tren', 'Prueba estanqueidad', 'Prueba de freno (Básica/Instrumental)',
    'Prueba HM', 'Enclavamientos', 'Luces gran intensidad / limpia',
    'Registro GSM-R', 'Puertas'
  ];

  var DEFAULT_RAMAS = [];
  for (var r = 1; r <= 23; r++) DEFAULT_RAMAS.push(r < 10 ? '0' + r : '' + r);

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  // ===== Estado =====
  var turnos = [];
  var settings = {};
  var horarios = [];
  var editId = null;
  var expandedSvc = 0;
  var calYear, calMonth;
  var statsRange = null;

  // ===== Utilidades =====
  function $(id) { return document.getElementById(id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function ymd(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function today() { return ymd(new Date()); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function ymdNice(s) {
    if (!s) return '';
    var p = s.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  // Duración en minutos entre dos horas HH:MM (cruce de medianoche → +24h).
  function durMin(a, b) {
    if (!/^\d{1,2}:\d{2}$/.test(a || '') || !/^\d{1,2}:\d{2}$/.test(b || '')) return null;
    var pa = a.split(':'), pb = b.split(':');
    var m = (+pb[0] * 60 + +pb[1]) - (+pa[0] * 60 + +pa[1]);
    if (m < 0) m += 1440;
    return m;
  }
  function fmtDur(m) {
    if (m == null || m === 0) return '0h 00m';
    return Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm';
  }
  // Parser flexible de retraso: '5' (min), '9:25' (HH:MM), '925'/'0925' (HHMM)
  // Orden de detección: HH:MM con dos puntos > 3-4 dígitos (HHMM) > entero suelto.
  function parseRetraso(raw) {
    if (raw == null) return null;
    var s = String(raw).trim().replace(/^\+/, '');
    if (s === '') return null;
    // 1) HH:MM con dos puntos
    var m = s.match(/^(-?)(\d{1,2}):(\d{2})$/);
    if (m) {
      var sig = m[1] === '-' ? -1 : 1;
      return sig * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
    }
    // 2) HHMM (3 o 4 dígitos) interpretado como tiempo
    if (/^\d{3,4}$/.test(s)) {
      var pad = s.length === 3 ? '0' + s : s;
      return parseInt(pad.slice(0, 2), 10) * 60 + parseInt(pad.slice(2), 10);
    }
    // 3) Entero suelto (1-2 dígitos, o negativo)
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    return null;
  }
  function fmtRetraso(min) {
    if (min == null || !isFinite(min)) return '';
    var abs = Math.abs(min);
    var sign = min >= 0 ? '+' : '-';
    if (abs >= 60) return sign + Math.floor(abs / 60) + 'h ' + pad2(abs % 60) + 'm';
    return sign + abs + 'm';
  }
  // True si el servicio aún no ha llegado a destino (hDestino > hora actual).
  function servicioEnCurso(s) {
    if (!s || !s.hDestino) return false;
    var parts = String(s.hDestino).split(':');
    if (parts.length < 2) return false;
    var dest = new Date();
    dest.setHours(+parts[0], +parts[1], 0, 0);
    return new Date() < dest;
  }
  // Suma minutos a una hora 'HH:MM' → 'HH:MM' (con wrap 24h).
  function addMinutos(hora, min) {
    if (!/^\d{1,2}:\d{2}$/.test(hora || '') || !isFinite(min)) return '';
    var p = hora.split(':');
    var t = (+p[0]) * 60 + (+p[1]) + min;
    t = ((t % 1440) + 1440) % 1440;
    return pad2(Math.floor(t / 60)) + ':' + pad2(t % 60);
  }
  // Resta minutos a una hora 'HH:MM' → 'HH:MM' (con wrap 24h).
  function subMinutos(hora, min) {
    if (!/^\d{1,2}:\d{2}$/.test(hora || '') || !isFinite(min)) return '';
    var p = hora.split(':');
    var t = (+p[0]) * 60 + (+p[1]) - min;
    while (t < 0) t += 24 * 60;
    t = t % (24 * 60);
    return pad2(Math.floor(t / 60)) + ':' + pad2(t % 60);
  }

  // ===== Almacenamiento =====
  function load(k, def) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; }
    catch (e) { return def; }
  }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  var saveTimer = null;
  function autosave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      save(K_TURNOS, turnos);
    }, 350);
  }
  function flashSaved() {
    var f = $('save-flash');
    if (!f) return;
    f.classList.add('show');
    setTimeout(function () { f.classList.remove('show'); }, 1100);
  }

  function loadAll() {
    turnos = load(K_TURNOS, []);
    settings = load(K_SETTINGS, {});
    if (!settings.ramas || !settings.ramas.length) settings.ramas = DEFAULT_RAMAS.slice();
    if (settings.telefono == null) settings.telefono = '';
    if (!settings.theme) settings.theme = 'dark';
    if (settings.calView !== 'list') settings.calView = 'grid';
    if (settings.lastBackup == null) settings.lastBackup = '';
    if (settings.autoDownload == null) settings.autoDownload = false;
  }
  function saveSettings() { save(K_SETTINGS, settings); }

  function loadHorarios() {
    horarios = (window.RV_HORARIOS || []).slice();
    horarios.sort(function (a, b) {
      return (parseInt(a.servicio, 10) || 0) - (parseInt(b.servicio, 10) || 0);
    });
  }

  // ===== Modelo =====
  function blankServicio(fecha) {
    return {
      fecha: fecha || today(),
      servicioComercial: '', origen: '', destino: '', via: '', rama: '',
      hSalida: '', hDestino: '', rSalida: '', rLlegDestino: '',
      horaLTV: '', paradas: [],
      n1: '', viajeros: '', asistencias: '', plazasH: '', pmr: [],
      comprobaciones: COMPROBACIONES.map(function () { return false; }),
      observaciones: '', dibujos: []
    };
  }
  function blankParada() {
    return {
      nombre: '', hLleg: '', hora: '', tParada: 0, rLleg: '', rSal: '',
      viajeros: '', asistencias: ''
    };
  }
  function blankTurno(fecha) {
    return {
      id: uid(), estado: 'en_curso', horaLTV: '',
      servicios: [blankServicio(fecha)]
    };
  }
  function getTurno(id) {
    for (var i = 0; i < turnos.length; i++) if (turnos[i].id === id) return turnos[i];
    return null;
  }
  // Migración defensiva: asegura que un turno tiene la forma esperada.
  function normTurno(t) {
    if (t.horaLTV == null) t.horaLTV = '';
    if (!t.servicios) t.servicios = [];
    t.servicios.forEach(function (s, si) {
      if (s.origen == null) s.origen = '';
      if (s.destino == null) s.destino = '';
      if (s.rSalida == null) s.rSalida = '';
      if (s.rLlegDestino == null) s.rLlegDestino = '';
      if (s.horaLTV == null) s.horaLTV = '';
      // Migración LTV global → servicio 0
      if (si === 0 && !s.horaLTV && t.horaLTV) s.horaLTV = t.horaLTV;
      if (!s.paradas) s.paradas = [];
      s.paradas.forEach(function (p) {
        if (p.tParada == null) p.tParada = 0;
        if (p.hLleg == null) p.hLleg = '';
        if (p.rLleg == null) p.rLleg = '';
        if (p.rSal == null) p.rSal = '';
        if (p.viajeros == null) p.viajeros = '';
        if (p.asistencias == null) p.asistencias = '';
        if (!Array.isArray(p.pmr)) p.pmr = [];
      });
      if (!s.dibujos) s.dibujos = [];
      // Migración plazasH (string/numero) → pmr (array)
      if (!Array.isArray(s.pmr)) {
        var n = parseInt(s.plazasH, 10);
        s.pmr = [];
        if (!isNaN(n) && n > 0) {
          for (var k = 0; k < n; k++) s.pmr.push({ baja: '' });
        }
      }
      if (!s.comprobaciones || s.comprobaciones.length !== COMPROBACIONES.length) {
        var old = s.comprobaciones || [];
        s.comprobaciones = COMPROBACIONES.map(function (_, i) { return !!old[i]; });
      }
    });
    // LTV ya migrada a servicio[0], queda en t por compat pero ignorada.
    return t;
  }
  function isDormida(t) {
    if (!t || !t.servicios || t.servicios.length < 2) return false;
    var fechas = t.servicios.map(function (s) { return s.fecha; }).filter(Boolean);
    if (fechas.length < 2) return false;
    var seen = {};
    fechas.forEach(function (f) { seen[f] = true; });
    return Object.keys(seen).length > 1;
  }
  function turnosOfDay(d) {
    return turnos.filter(function (t) {
      return t.servicios.some(function (s) { return s.fecha === d; });
    });
  }
  // ¿Turno sin ningún dato introducido? (solo la fecha automática del servicio)
  function isEmptyTurno(t) {
    if (t.horaLTV) return false;
    return t.servicios.every(function (s) {
      if (s.servicioComercial || s.via || s.rama || s.n1 ||
          s.viajeros || s.asistencias || s.plazasH || s.observaciones) return false;
      if (s.paradas.some(function (p) {
        return p.nombre || p.hora || p.rLleg || p.rSal;
      })) return false;
      if (s.comprobaciones.some(function (c) { return c; })) return false;
      return true;
    });
  }
  // Al salir del editor, descarta el turno si quedó completamente vacío.
  // Si el turno tiene datos, se PRESERVA editId (y el servicio expandido) para
  // que al volver a Registro reaparezca el mismo servicio, no el primero.
  function discardEmptyEdit() {
    if (currentRec) stopDictado();
    if (editId) {
      var t = getTurno(editId);
      if (!t) {
        editId = null;
      } else if (t.estado !== 'cerrado' && isEmptyTurno(t)) {
        turnos = turnos.filter(function (x) { return x.id !== editId; });
        save(K_TURNOS, turnos);
        editId = null;
      }
      // turno con datos → conservar editId y expandedSvc
    }
  }

  // ===== Navegación / vistas =====
  var lastSetView = '';
  function setView(v) {
    // Si salimos del editor de Registro hacia otra vista RV, descartar
    // turno blank si quedó vacío. Esto cubre TODOS los flujos de salida
    // (botón "volver", cambio de tab, sub-nav), incluso los que no
    // pasan por onTabChange de app.js (click en día del calendario).
    if (lastSetView === 'registro' && v !== 'registro') {
      discardEmptyEdit();
    }
    lastSetView = v;
    ['calendario', 'registro', 'estadisticas', 'ajustes'].forEach(function (p) {
      var el = $(p + '-pane');
      if (el) el.classList.toggle('active', p === v);
    });
    var navMap = { calendario: 'calendario', registro: 'calendario', estadisticas: 'estadisticas', ajustes: 'ajustes' };
    document.querySelectorAll('nav.tabs button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === navMap[v]);
    });
    window.scrollTo(0, 0);
    window.dispatchEvent(new CustomEvent('iryo:setView', { detail: { view: v } }));
  }

  // ===== Calendario =====
  function renderSvcBlock(s) {
    var num = s.servicioComercial ? '<b>' + esc(s.servicioComercial) + '</b>' : '';
    var rd = parseInt(String(s.rLlegDestino || '').replace(/^\+/, ''), 10);
    var ret = (!isNaN(rd) && rd > 0) ? ' <span class="ret">+' + rd + 'm</span>' : '';
    var line1 = num + ret;
    var line2 = (s.hSalida && s.hDestino) ? esc(s.hSalida + '→' + s.hDestino) : '';
    if (!line1 && !line2) return '';
    var out = '<span class="svc-block">';
    if (line1) out += '<span class="svc-head">' + line1 + '</span>';
    if (line2) out += '<span class="svc-hrs">' + line2 + '</span>';
    out += '</span>';
    return out;
  }

  function renderCalendar() {
    if (settings.calView === 'list') { renderList(); return; }
    var pane = $('calendario-pane');
    var first = new Date(calYear, calMonth, 1);
    var offset = (first.getDay() + 6) % 7; // lunes primero
    var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    var monthPrefix = calYear + '-' + pad2(calMonth + 1);

    // Pair info para dormidas: vincular los 2 días del mismo turno.
    var pairInfo = {};
    turnos.forEach(function (t) {
      if (!isDormida(t)) return;
      var fechas = t.servicios.map(function (s) { return s.fecha; })
        .filter(Boolean).sort();
      if (fechas.length < 2) return;
      var f1 = fechas[0], f2 = fechas[1];
      var bothInMonth = f1.slice(0, 7) === monthPrefix && f2.slice(0, 7) === monthPrefix;
      var sameRow = false;
      if (bothInMonth) {
        var dn1 = parseInt(f1.slice(8), 10);
        var dn2 = parseInt(f2.slice(8), 10);
        sameRow = (dn2 === dn1 + 1) &&
          (Math.floor((offset + dn1 - 1) / 7) === Math.floor((offset + dn2 - 1) / 7));
      }
      pairInfo[f1] = { role: 'first', other: f2, sameRow: sameRow };
      pairInfo[f2] = { role: 'second', other: f1, sameRow: sameRow };
    });

    var h = '<div class="cal-head">' +
      '<button class="cal-nav" data-action="cal-prev">‹</button>' +
      '<div class="cal-title">' + MESES[calMonth] + ' ' + calYear + '</div>' +
      '<button class="cal-nav" data-action="cal-next">›</button>' +
      '<button class="cal-toggle" data-action="cal-toggle" title="Vista lista">≡</button>' +
      '</div>';
    h += '<div class="cal-grid">';
    DOW.forEach(function (d) { h += '<div class="cal-dow">' + d + '</div>'; });
    for (var i = 0; i < offset; i++) h += '<div class="cal-day empty"></div>';

    for (var dn = 1; dn <= daysInMonth; dn++) {
      var ds = calYear + '-' + pad2(calMonth + 1) + '-' + pad2(dn);
      var info = pairInfo[ds];

      // Si es el segundo día de una dormida y cabe en celda doble, ya se
      // renderizó como parte del 'first' — saltamos.
      if (info && info.role === 'second' && info.sameRow) continue;

      var tod = turnosOfDay(ds);
      // Defensa: ignorar turnos completamente vacíos (puede quedar uno en
      // memoria si discardEmptyEdit no se ejecutó). Sin esto, la celda
      // sale con `has-turno` y badge "En curso", lo que rompe el grid.
      tod = tod.filter(function (t) { return !isEmptyTurno(t); });
      var t0 = tod[0];
      var doble = info && info.role === 'first' && info.sameRow;
      var firstOfDormida = info && info.role === 'first';

      var cls = 'cal-day';
      if (ds === today()) cls += ' today';
      if (info) cls += ' dormida';
      else if (tod.length) cls += ' has-turno';
      if (doble) cls += ' cal-day-double';
      if (info && !info.sameRow) {
        cls += info.role === 'first' ? ' pair-end-right' : ' pair-end-left';
      }

      h += '<div class="' + cls + '" data-action="cal-day" data-day="' + ds + '">';

      if (doble) {
        h += '<span class="dnum">' + dn + ' · ' + (dn + 1) + '</span>';
        h += '<span class="dormida-icon" title="Dormida">🌙</span>';
        if (t0) {
          t0.servicios.forEach(function (s) { h += renderSvcBlock(s); });
          h += '<span class="estado ' + esc(t0.estado) + '">' +
            (t0.estado === 'cerrado' ? 'Cerrado' : 'En curso') + '</span>';
        }
      } else {
        h += '<span class="dnum">' + dn + '</span>';
        if (info && firstOfDormida) {
          h += '<span class="dormida-icon" title="Dormida">🌙</span>';
        }
        if (t0) {
          t0.servicios.forEach(function (s) {
            if (s.fecha !== ds) return;
            h += renderSvcBlock(s);
          });
          h += '<span class="estado ' + esc(t0.estado) + '">' +
            (t0.estado === 'cerrado' ? 'Cerrado' : 'En curso') + '</span>';
        }
      }
      h += '</div>';
    }
    h += '</div>';
    h += '<div class="cal-legend">' +
      '<span><i style="background:var(--warn)"></i> En curso</span>' +
      '<span><i style="background:var(--ok)"></i> Cerrado</span></div>';
    pane.innerHTML = h;
  }

  function renderList() {
    var pane = $('calendario-pane');
    var h = '<div class="cal-head">' +
      '<div class="cal-title" style="text-align:left;flex:1">Todos los turnos</div>' +
      '<button class="cal-toggle" data-action="cal-toggle" title="Vista cuadrícula">▦</button>' +
      '</div>';

    var sorted = turnos.slice().sort(function (a, b) {
      var fa = (a.servicios[0] && a.servicios[0].fecha) || '';
      var fb = (b.servicios[0] && b.servicios[0].fecha) || '';
      return fb.localeCompare(fa);
    });

    if (!sorted.length) {
      h += '<div class="list-empty">Aún no hay turnos registrados.<br>' +
        'Cambia a vista cuadrícula y toca un día para crear el primero.</div>';
      pane.innerHTML = h;
      return;
    }

    h += '<div class="list-grid">';
    sorted.forEach(function (t) {
      var fechas = t.servicios.map(function (s) { return s.fecha ? ymdNice(s.fecha) : '—'; });
      var rng = fechas[0];
      if (fechas.length > 1 && fechas[1] && fechas[1] !== fechas[0]) rng += ' · ' + fechas[1];
      h += '<div class="list-row" data-action="open-turno" data-id="' + t.id + '">';
      h += '<div class="lr-head">' +
        '<div class="lr-date">' + esc(rng) + '</div>' +
        '<span class="badge ' + t.estado + '">' +
        (t.estado === 'cerrado' ? 'Cerrado' : 'En curso') + '</span>' +
        '<span class="lr-chev">›</span>' +
        '</div>';
      h += '<div class="lr-svc-list">';
      t.servicios.forEach(function (s) {
        var num = s.servicioComercial || '—';
        var hrs = (s.hSalida && s.hDestino) ? (s.hSalida + ' → ' + s.hDestino) : '—';
        var ruta = (s.origen && s.destino) ? ' · ' + s.origen + ' → ' + s.destino : '';
        var rd = parseInt(String(s.rLlegDestino || '').replace(/^\+/, ''), 10);
        var retHtml = (!isNaN(rd) && rd > 0)
          ? ' · <span class="ret">+' + rd + 'm</span>'
          : '';
        h += '<div class="lr-svc-line">' +
          '<b>Servicio ' + esc(num) + '</b> · ' + esc(hrs) + esc(ruta) + retHtml +
          '</div>';
      });
      h += '</div>';
      h += '</div>';
    });
    h += '</div>';
    pane.innerHTML = h;
  }

  function openDay(ds) {
    var tod = turnosOfDay(ds);
    if (tod.length === 0) {
      var t = blankTurno(ds);
      turnos.push(t);
      // NO save() aquí — el turno solo se persiste cuando el usuario
      // añade algún dato (autosave lo guardará). Si sale sin tocar,
      // discardEmptyEdit lo descarta de turnos[].
      openEditor(t.id);
    } else if (tod.length === 1) {
      openEditor(tod[0].id);
    } else {
      renderDayChooser(ds, tod);
    }
  }
  function renderDayChooser(ds, tod) {
    editId = null;
    var pane = $('registro-pane');
    var h = '<div class="btn-row" style="margin:0 0 14px">' +
      '<button class="btn ghost" data-action="volver">‹ Calendario</button></div>';
    h += '<h2>Turnos del ' + ymdNice(ds) + '</h2>';
    tod.forEach(function (t) {
      var labs = t.servicios.map(function (s) { return s.servicioComercial || '—'; });
      h += '<div class="card" data-action="open-turno" data-id="' + t.id + '" style="cursor:pointer">' +
        '<div class="card-title">Turno ' + esc(labs.join(' / ')) +
        ' <span class="badge ' + t.estado + '">' +
        (t.estado === 'cerrado' ? 'Cerrado' : 'En curso') + '</span></div></div>';
    });
    h += '<div class="btn-row"><button class="btn primary" data-action="new-turno" ' +
      'data-day="' + ds + '">+ Crear otro turno</button></div>';
    pane.innerHTML = h;
    setView('registro');
  }

  // ===== Editor de turno =====
  function openEditor(id) {
    editId = id;
    expandedSvc = 0;
    renderEditor();
    setView('registro');
    // El scroll real del editor está en #registro-pane (.pane{overflow:auto}),
    // no en window. Resetear ambos por defensa.
    var pane = document.getElementById('registro-pane');
    if (pane) pane.scrollTop = 0;
    window.scrollTo(0, 0);
    requestAnimationFrame(function () {
      if (pane) pane.scrollTop = 0;
      window.scrollTo(0, 0);
    });
  }

  // Clave única de un tramo del Libro de Horarios.
  function legKey(servicio, origen, destino) {
    return servicio + '|' + origen + '|' + destino;
  }
  function horarioOptions(s) {
    var cur = s.servicioComercial ? legKey(s.servicioComercial, s.origen, s.destino) : '';
    var h = '<option value="">— elegir servicio —</option>';
    horarios.forEach(function (hr, i) {
      var key = legKey(hr.servicio, hr.origen, hr.destino);
      var label = hr.servicio + ' · ' + hr.origen + ' → ' + hr.destino;
      h += '<option value="' + esc(key) + '" data-idx="' + i + '"' +
        (key === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
    });
    return h;
  }
  function ramaOptions(sel) {
    var h = '<option value="">—</option>';
    settings.ramas.forEach(function (rm) {
      h += '<option value="' + esc(rm) + '"' + (rm === sel ? ' selected' : '') +
        '>' + esc(rm) + '</option>';
    });
    return h;
  }
  // Hora LTV: solo horas en punto, rango operativo 05:00–23:00.
  function horaLtvOptions(sel) {
    var h = '<option value="">—</option>';
    for (var i = 5; i <= 23; i++) {
      var v = pad2(i) + ':00';
      h += '<option value="' + v + '"' + (v === sel ? ' selected' : '') +
        '>' + v + '</option>';
    }
    return h;
  }

  // Estado del editor inline de retraso (sólo uno activo a la vez).
  var activeRetBind = null;

  // ownerIdx: -1 = origen; 0..n-1 = paradas[i]. Devuelve solo paradas
  // posteriores (no se puede ir hacia atrás en la marcha).
  function pmrOptionsFor(s, ownerIdx, selected) {
    var opts = ['<option value="">— elegir parada —</option>'];
    var add = function (n) {
      if (!n) return;
      opts.push('<option value="' + esc(n) + '"' +
        (n === selected ? ' selected' : '') + '>' + esc(n) + '</option>');
    };
    var startIdx = ownerIdx + 1;
    for (var i = startIdx; i < s.paradas.length; i++) add(s.paradas[i].nombre);
    add(s.destino);
    return opts.join('');
  }

  function retInlineHtml(bind, val) {
    if (!bind) return '';
    if (activeRetBind === bind) {
      return '<input class="ret-input" type="text" inputmode="text" ' +
        'placeholder="min o HH:MM" value="' + esc(val || '') + '" ' +
        'data-ret-bind="' + esc(bind) + '" autofocus>';
    }
    var min = parseRetraso(val);
    if (min != null && isFinite(min) && min !== 0) {
      return '<button class="ret-val" data-action="ret-edit" ' +
        'data-ret-bind="' + esc(bind) + '">' + fmtRetraso(min) + ' ✎</button>';
    }
    return '<button class="ret-add" data-action="ret-edit" ' +
      'data-ret-bind="' + esc(bind) + '">+ Retraso</button>';
  }

  function stationCard(tipo, si, cfg) {
    var badgeTxt = tipo === 'origin' ? 'ORIGEN' :
      tipo === 'destination' ? 'DESTINO' : 'PARADA';
    var h = '<div class="station-card ' + tipo + '">';
    h += '<div class="st-head">' +
      '<span class="st-badge ' + tipo + '">' + badgeTxt + '</span>';
    if (cfg.parIdx != null && cfg.editable) {
      h += '<input type="text" class="st-name-input" placeholder="Estación" ' +
        'data-bind="srv.' + si + '.par.' + cfg.parIdx + '.nombre" ' +
        'value="' + esc(cfg.nombre || '') + '">';
    } else {
      h += '<span class="st-name">' + esc(cfg.nombre || '—');
      if (cfg.pmrBaja) h += ' <span class="pmr-warn" title="PMR baja aquí">♿</span>';
      h += '</span>';
    }
    // Mini "+" inserta una parada NUEVA antes de la actual.
    if (cfg.parIdx != null) {
      h += '<button class="st-add" data-action="add-parada-before" ' +
        'data-svc="' + si + '" data-par="' + cfg.parIdx + '" ' +
        'title="Añadir parada antes">+</button>';
      h += '<button class="st-del" data-action="del-parada" ' +
        'data-svc="' + si + '" data-par="' + cfg.parIdx + '" ' +
        'title="Quitar parada">🗑</button>';
    } else if (tipo === 'destination') {
      // El destino tiene un mini "+" para añadir parada al final.
      h += '<button class="st-add" data-action="add-parada-end" ' +
        'data-svc="' + si + '" title="Añadir parada al final">+</button>';
    }
    h += '</div>';
    h += '<div class="st-body">';
    h += '<div class="st-times">';
    if (cfg.horaLlegada || cfg.editLlegada) {
      var retLlegMin = parseRetraso(cfg.valRetLleg);
      var horaRealLleg = (cfg.horaLlegada && retLlegMin) ? addMinutos(cfg.horaLlegada, retLlegMin) : '';
      h += '<div class="st-row"><span class="st-lbl">H. Llegada</span>' +
        '<div class="st-time-col">';
      if (cfg.editLlegada) {
        h += '<input type="time" data-bind="' + cfg.bindHoraLlegada + '" value="' +
          esc(cfg.horaLlegada || '') + '">';
      } else {
        h += '<span class="st-h">' + esc(cfg.horaLlegada) + '</span>';
      }
      if (horaRealLleg) h += '<span class="st-real">' + horaRealLleg + '</span>';
      h += '</div>' + retInlineHtml(cfg.bindRetLleg, cfg.valRetLleg) + '</div>';
    }
    if (cfg.horaSalida || cfg.editSalida) {
      var retSalMin = parseRetraso(cfg.valRetSal);
      var horaRealSal = (cfg.horaSalida && retSalMin) ? addMinutos(cfg.horaSalida, retSalMin) : '';
      h += '<div class="st-row"><span class="st-lbl">H. Salida</span>' +
        '<div class="st-time-col">';
      if (cfg.editSalida) {
        h += '<input type="time" data-bind="' + cfg.bindHoraSalida + '" value="' +
          esc(cfg.horaSalida || '') + '">';
      } else {
        h += '<span class="st-h">' + esc(cfg.horaSalida) + '</span>';
      }
      if (horaRealSal) h += '<span class="st-real">' + horaRealSal + '</span>';
      h += '</div>' + retInlineHtml(cfg.bindRetSal, cfg.valRetSal) + '</div>';
    }
    h += '</div>';
    if (cfg.pax) h += '<div class="st-pax">' + cfg.pax + '</div>';
    h += '</div></div>';
    return h;
  }

  // Lista PMR para una estación. ownerIdx = -1 (origen) o índice de parada.
  // bindPrefix = 'srv.X' para origen, 'srv.X.par.Y' para parada intermedia.
  function pmrListHtml(s, ownerIdx, pmrArr, si, bindPrefix) {
    var parAttr = ownerIdx >= 0 ? (' data-par="' + ownerIdx + '"') : '';
    var h = '<div class="pmr-block"><label>PMR (plazas H)</label>';
    (pmrArr || []).forEach(function (p, i) {
      h += '<div class="pmr-item">' +
        '<select data-bind="' + bindPrefix + '.pmr.' + i + '.baja">' +
        pmrOptionsFor(s, ownerIdx, p.baja) + '</select>' +
        '<button class="pmr-del" data-action="del-pmr" data-svc="' + si +
        '"' + parAttr + ' data-pmr="' + i + '" title="Quitar PMR">×</button>' +
        '</div>';
    });
    h += '<button class="btn ghost" data-action="add-pmr" data-svc="' + si +
      '"' + parAttr +
      ' style="font-size:12px;padding:5px 10px;min-height:32px">+ Añadir PMR</button>';
    h += '</div>';
    return h;
  }

  function paxBlockOrigen(s, si) {
    var h = '<div class="pax-block">';
    h += '<div class="pax-row"><label>Viajeros</label>' +
      '<input type="number" inputmode="numeric" data-bind="srv.' + si +
      '.viajeros" value="' + esc(s.viajeros) + '"></div>';
    h += '<div class="pax-row"><label>Asistencias</label>' +
      '<input type="number" inputmode="numeric" data-bind="srv.' + si +
      '.asistencias" value="' + esc(s.asistencias) + '"></div>';
    h += pmrListHtml(s, -1, s.pmr, si, 'srv.' + si);
    h += '</div>';
    return h;
  }

  function paxBlockParada(s, p, si, pi) {
    var h = '<div class="pax-block">';
    h += '<div class="pax-row"><label>Viajeros</label>' +
      '<input type="number" inputmode="numeric" data-bind="srv.' + si +
      '.par.' + pi + '.viajeros" value="' + esc(p.viajeros) + '"></div>';
    h += '<div class="pax-row"><label>Asistencias</label>' +
      '<input type="number" inputmode="numeric" data-bind="srv.' + si +
      '.par.' + pi + '.asistencias" value="' + esc(p.asistencias) + '"></div>';
    h += pmrListHtml(s, pi, p.pmr, si, 'srv.' + si + '.par.' + pi);
    h += '</div>';
    return h;
  }

  function stationsBlock(s, si) {
    var h = '<div class="stations">';
    // Origen
    h += stationCard('origin', si, {
      nombre: s.origen || '(origen)',
      horaSalida: s.hSalida,
      horaLlegada: '',
      bindRetSal: 'srv.' + si + '.rSalida',
      valRetSal: s.rSalida,
      pax: paxBlockOrigen(s, si)
    });
    // Paradas intermedias
    s.paradas.forEach(function (p, pi) {
      var nuevaSinDatos = !p.nombre && !p.hora;
      var hasPmrInt = (s.pmr || []).some(function (pr) {
        return pr.baja && p.nombre && normName(pr.baja) === normName(p.nombre);
      });
      var hLlegParada = p.hLleg || (p.tParada > 0 ? subMinutos(p.hora, p.tParada) : '');
      h += stationCard('intermediate', si, {
        nombre: p.nombre,
        parIdx: pi,
        editable: nuevaSinDatos,
        pmrBaja: hasPmrInt,
        horaLlegada: hLlegParada,
        horaSalida: p.hora,
        editSalida: !p.hora,
        bindHoraSalida: 'srv.' + si + '.par.' + pi + '.hora',
        bindRetLleg: 'srv.' + si + '.par.' + pi + '.rLleg',
        valRetLleg: p.rLleg,
        bindRetSal: 'srv.' + si + '.par.' + pi + '.rSal',
        valRetSal: p.rSal,
        pax: paxBlockParada(s, p, si, pi)
      });
    });
    // Destino (con mini "+" para añadir parada al final)
    var hasPmrDest = (s.pmr || []).some(function (pr) {
      return pr.baja && s.destino && normName(pr.baja) === normName(s.destino);
    });
    h += stationCard('destination', si, {
      nombre: s.destino || '(destino)',
      pmrBaja: hasPmrDest,
      horaLlegada: s.hDestino,
      horaSalida: '',
      bindRetLleg: 'srv.' + si + '.rLlegDestino',
      valRetLleg: s.rLlegDestino,
      pax: ''
    });
    h += '</div>';
    return h;
  }

  function servicioInner(t, si) {
    var s = t.servicios[si];
    var dos = t.servicios.length > 1;
    var h = '';
    var titulo = s.servicioComercial ? esc(s.servicioComercial) : String(si + 1);

    // Cabecera card-title con LTV inline a la derecha
    h += '<div class="svc-card-title">';
    if (dos) {
      h += '<button type="button" class="title-toggle" ' +
        'data-action="svc-toggle" data-svc="' + si + '">' +
        'Servicio ' + titulo + '<span class="chev">▴</span></button>';
    } else {
      h += '<div class="title-static">Servicio ' + titulo + '</div>';
    }
    h += '<div class="ltv-inline">' +
      '<label>Hora LTV</label>' +
      '<select data-bind="srv.' + si + '.horaLTV">' +
      horaLtvOptions(s.horaLTV) + '</select>' +
      '</div>';
    h += '</div>';

    // Fecha + Servicio Comercial
    h += '<div class="field-grid" style="grid-template-columns:130px 1fr">' +
      '<div class="field"><label>Fecha</label>' +
      '<input type="date" data-bind="srv.' + si + '.fecha" value="' + esc(s.fecha) + '"></div>' +
      '<div class="field"><label>Servicio Comercial</label>';
    if (horarios.length) {
      h += '<select data-bind="srv.' + si + '.servicioComercial" data-svc="' + si +
        '" class="srv-sel">' + horarioOptions(s) + '</select>';
    } else {
      h += '<input type="text" data-bind="srv.' + si + '.servicioComercial" value="' +
        esc(s.servicioComercial) + '" placeholder="Nº de servicio">';
    }
    h += '</div></div>';
    if (s.origen || s.destino) {
      h += '<div class="hint" style="margin:-6px 0 11px">' +
        esc(s.origen) + ' → ' + esc(s.destino) + '</div>';
    }

    // Vía + Rama
    h += '<div class="field-grid">' +
      '<div class="field"><label>Vía</label>' +
      '<input type="text" data-bind="srv.' + si + '.via" value="' + esc(s.via) + '"></div>' +
      '<div class="field"><label>Rama</label>' +
      '<select data-bind="srv.' + si + '.rama">' + ramaOptions(s.rama) + '</select></div>' +
      '</div>';

    // N1
    h += '<div class="field"><label class="red">N1</label>' +
      '<input type="text" data-bind="srv.' + si + '.n1" value="' +
      esc(s.n1) + '" placeholder="Nombre"></div>';

    // Estaciones (card por estación)
    h += stationsBlock(s, si);

    // Comprobaciones
    h += '<h3>Comprobaciones</h3><div class="checks">';
    COMPROBACIONES.forEach(function (c, ci) {
      h += '<label class="check-item">' +
        '<input type="checkbox" data-bind="srv.' + si + '.chk.' + ci + '"' +
        (s.comprobaciones[ci] ? ' checked' : '') + '>' +
        '<span>' + esc(c) + '</span></label>';
    });
    h += '</div>';

    h += '<div class="field" style="margin-top:12px">' +
      '<label style="color:#a371f7">Observaciones durante el trayecto</label>' +
      '<div class="obs-wrapper" data-svc="' + si + '">' +
      '<textarea data-bind="srv.' + si + '.observaciones">' + esc(s.observaciones) + '</textarea>' +
      '</div>';
    h += '<div class="obs-actions">' +
      '<button class="btn ghost" data-action="dictar" data-svc="' + si + '">🎤 Dictar</button>' +
      '</div>';
    h += (dos ? '<button class="btn ghost" data-action="del-servicio" data-svc="' + si +
      '" style="margin-top:14px;color:var(--bad);border-color:var(--bad)">🗑 Quitar este servicio</button>' : '');
    h += '</div>';

    return h;
  }

  function renderEditor() {
    var t = getTurno(editId);
    if (!t) { renderCalendar(); setView('calendario'); return; }
    normTurno(t);
    var pane = $('registro-pane');
    var cerrado = t.estado === 'cerrado';
    var h = '';

    h += '<div class="btn-row" style="margin:0 0 12px">' +
      '<button class="btn ghost" data-action="volver">‹ Calendario</button>' +
      '<span class="badge ' + t.estado + '" style="align-self:center">' +
      (cerrado ? 'Cerrado' : 'En curso') + '</span>';
    h += '<span class="tel-cabecera">' +
      (settings.telefono ? '📞 ' + esc(settings.telefono) : '') + '</span>';
    if (t.servicios.length < 2) {
      h += '<button class="btn" data-action="add-servicio">' +
        '+ Añadir 2º servicio</button>';
    }
    h += '</div>';

    // Servicios — acordeón: solo expandedSvc abierto.
    if (expandedSvc >= t.servicios.length) expandedSvc = 0;
    h += '<div class="servicios">';
    t.servicios.forEach(function (s, si) {
      if (si === expandedSvc) {
        h += '<div class="card servicio-card" id="svc-card-' + si + '">' +
          servicioInner(t, si) + '</div>';
      } else {
        var num = s.servicioComercial ? esc(s.servicioComercial) : String(si + 1);
        var ruta = (s.origen || s.destino)
          ? esc(s.origen) + ' → ' + esc(s.destino)
          : '<span style="color:var(--fg-dim);font-weight:400">sin datos</span>';
        h += '<button type="button" class="svc-collapsed" data-action="svc-toggle" data-svc="' + si + '">' +
          '<span class="svc-c-num">Servicio ' + num + '</span>' +
          '<span class="svc-c-ruta">' + ruta + '</span>' +
          '<span class="chev">▾</span>' +
          '</button>';
      }
    });
    h += '</div>';

    // Acciones
    h += '<div class="btn-row" style="margin-top:18px">';
    if (cerrado) {
      h += '<button class="btn" data-action="reabrir">Reabrir turno</button>';
    } else {
      h += '<button class="btn primary" data-action="cerrar">Cerrar turno</button>';
    }
    h += '<button class="btn danger" data-action="borrar">Borrar turno</button>';
    h += '</div>';

    pane.innerHTML = h;
  }

  function refreshServicioCard(si) {
    var t = getTurno(editId);
    var card = $('svc-card-' + si);
    if (t && card) card.innerHTML = servicioInner(t, si);
  }

  function applyBind(bind, value) {
    var t = getTurno(editId);
    if (!t) return;
    var p = bind.split('.');
    if (p[0] === 'srv') {
      var s = t.servicios[+p[1]];
      if (!s) return;
      if (p[2] === 'par') {
        var par = s.paradas[+p[3]];
        if (par) {
          if (p[4] === 'pmr') {
            if (!Array.isArray(par.pmr)) par.pmr = [];
            var pm0 = par.pmr[+p[5]];
            if (pm0) pm0[p[6]] = value;
          } else {
            par[p[4]] = value;
          }
        }
      } else if (p[2] === 'chk') {
        s.comprobaciones[+p[3]] = value;
      } else if (p[2] === 'pmr') {
        var pm = s.pmr[+p[3]];
        if (pm) pm[p[4]] = value;
      } else {
        s[p[2]] = value;
      }
    } else {
      t[p[0]] = value;
    }
    autosave();
    // Si cambió pmr.baja, refrescar la card del servicio para mostrar/quitar ⚠
    var pmrM = bind.match(/^srv\.(\d+)\..*pmr\.\d+\.baja$/);
    if (pmrM) refreshServicioCard(+pmrM[1]);
  }

  // ===== Dictado por voz (Web Speech API) =====
  var currentRec = null;
  var currentRecSvc = null;
  // Intención del usuario: Android ignora continuous y corta por silencio a los
  // pocos segundos (dispara onend). Mientras wantDictado siga true, reiniciamos
  // el reconocimiento para que el dictado sea continuo hasta pulsar Detener.
  var wantDictado = false;
  function startDictado(si) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      appModal.alert({ title: 'Dictado no disponible', message: 'Tu navegador no soporta dictado por voz. Usa el teclado de escritura a mano de la tablet.' });
      return;
    }
    var t = getTurno(editId);
    if (!t) return;
    var s = t.servicios[si];
    if (!s) return;
    var rec = new SR();
    rec.lang = 'es-ES';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = function (e) {
      var txt = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) txt += e.results[i][0].transcript + ' ';
      }
      txt = txt.trim();
      if (txt) {
        s.observaciones = (s.observaciones ? s.observaciones + ' ' : '') + txt;
        autosave();
        var ta = document.querySelector('[data-bind="srv.' + si + '.observaciones"]');
        if (ta) ta.value = s.observaciones;
      }
    };
    rec.onerror = function (e) {
      // Silencio o aborto: no avisar ni parar — onend reiniciará si seguimos.
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantDictado = false; stopDictado();
        appModal.alert({ title: 'Micrófono bloqueado', message: 'Hay que permitir el micrófono para dictar.' });
      } else {
        wantDictado = false; stopDictado();
        appModal.alert({ title: 'Error de dictado', message: 'Error de dictado: ' + e.error });
      }
    };
    rec.onend = function () {
      if (currentRec !== rec) return;
      // Android corta por silencio: reiniciar mientras el usuario siga queriendo.
      if (wantDictado) {
        try { rec.start(); return; }
        catch (err) {
          try { currentRec = null; startDictado(si); return; } catch (e2) {}
        }
      }
      currentRec = null; currentRecSvc = null;
      updateDictarBtn();
    };
    try {
      rec.start();
      currentRec = rec;
      currentRecSvc = si;
      wantDictado = true;
      updateDictarBtn();
    } catch (err) {
      // start() puede tirar InvalidStateError si ya hay sesión activa
    }
  }
  function stopDictado() {
    wantDictado = false;
    if (currentRec) {
      try { currentRec.stop(); } catch (e) {}
      currentRec = null; currentRecSvc = null;
    }
    updateDictarBtn();
  }
  function updateDictarBtn() {
    document.querySelectorAll('[data-action="dictar"]').forEach(function (b) {
      var si = +b.getAttribute('data-svc');
      if (si === currentRecSvc) {
        b.classList.add('rec');
        b.classList.remove('ghost');
        b.textContent = '🛑 Detener';
      } else {
        b.classList.remove('rec');
        b.classList.add('ghost');
        b.textContent = '🎤 Dictar';
      }
    });
  }

  // Autocompletado del tramo elegido en el Libro de Horarios.
  function autofillServicio(si, horarioIdx) {
    var t = getTurno(editId);
    if (!t) return;
    var s = t.servicios[si];
    var hr = horarios[horarioIdx];
    if (!hr) return;
    s.servicioComercial = hr.servicio;
    s.origen = hr.origen || '';
    s.destino = hr.destino || '';
    s.hSalida = hr.hSalida || '';
    s.hDestino = hr.hDestino || '';
    s.paradas = (hr.paradas || []).map(function (p) {
      var tP = typeof p.tParada === 'number' ? p.tParada : 0;
      return {
        nombre: p.nombre,
        hLleg: tP > 0 ? subMinutos(p.hora, tP) : (p.hLleg || ''),
        hora: p.hora,
        tParada: tP,
        rLleg: '', rSal: '',
        viajeros: '', asistencias: ''
      };
    });
    autosave();
    refreshServicioCard(si);
    // Solo sincronizar con Horario si el servicio editado es de HOY. Editar
    // registros de otra fecha no debe marcar una marcha activa en HT.
    if (s.fecha === today()) {
      window.dispatchEvent(new CustomEvent('iryo:registroServiceChanged',
        { detail: { num: hr.servicio } }));
    }
  }

  // ===== Estadísticas =====
  function renderStats() {
    var pane = $('estadisticas-pane');
    if (!statsRange) {
      var n = new Date();
      statsRange = {
        desde: ymd(new Date(n.getFullYear(), n.getMonth(), 1)),
        hasta: today()
      };
    }
    var inRange = function (d) {
      return d && d >= statsRange.desde && d <= statsRange.hasta;
    };
    var nTurnos = 0, nServicios = 0, totalMin = 0, totalRetrasoMin = 0;
    var addRet = function (v) {
      var n = parseRetraso(v);
      if (n != null && n > 0) totalRetrasoMin += n;
    };
    turnos.forEach(function (t) {
      var hit = t.servicios.some(function (s) { return inRange(s.fecha); });
      if (!hit) return;
      nTurnos++;
      t.servicios.forEach(function (s) {
        if (!inRange(s.fecha)) return;
        nServicios++;
        var d = durMin(s.hSalida, s.hDestino);
        if (d != null) totalMin += d;
        addRet(s.rSalida);
        addRet(s.rLlegDestino);
        (s.paradas || []).forEach(function (p) {
          addRet(p.rLleg);
          addRet(p.rSal);
        });
      });
    });

    var h = '<h2>Estadísticas</h2>';
    h += '<div class="card"><div class="field-grid">' +
      '<div class="field"><label>Desde</label>' +
      '<input type="date" id="st-desde" value="' + statsRange.desde + '"></div>' +
      '<div class="field"><label>Hasta</label>' +
      '<input type="date" id="st-hasta" value="' + statsRange.hasta + '"></div>' +
      '</div></div>';
    h += '<div class="stat-grid">' +
      '<div class="stat-box"><div class="num">' + nTurnos + '</div>' +
      '<div class="lbl">Turnos</div></div>' +
      '<div class="stat-box"><div class="num">' + nServicios + '</div>' +
      '<div class="lbl">Servicios</div></div>' +
      '<div class="stat-box"><div class="num">' + fmtDur(totalMin) + '</div>' +
      '<div class="lbl">Horas de servicio</div></div>' +
      '<div class="stat-box"><div class="num">' + fmtDur(totalRetrasoMin) + '</div>' +
      '<div class="lbl">Retraso acumulado</div></div>' +
      '</div>';
    pane.innerHTML = h;

    $('st-desde').addEventListener('change', function (e) {
      statsRange.desde = e.target.value; renderStats();
    });
    $('st-hasta').addEventListener('change', function (e) {
      statsRange.hasta = e.target.value; renderStats();
    });
  }

  // ===== Ajustes =====
  function renderSettings() {
    var pane = $('ajustes-pane');
    var h = '<h2>Ajustes</h2>';

    // 1. Apariencia
    h += '<div class="card"><div class="card-title">Apariencia</div>' +
      '<div class="btn-row" style="margin:0">' +
      '<button class="btn" data-action="theme-dark">Tema oscuro</button>' +
      '<button class="btn" data-action="theme-light">Tema claro</button>' +
      '</div></div>';

    // 2. Teléfono de referencia
    h += '<div class="card"><div class="card-title">Teléfono de referencia</div>' +
      '<div class="field"><input type="text" id="set-tel" value="' + esc(settings.telefono) +
      '" placeholder="Ej. 651 450 000"></div>' +
      '<div class="btn-row" style="margin:0"><button class="btn primary" data-action="save-tel">Guardar teléfono</button></div></div>';

    // 3. Ramas
    h += '<div class="card"><div class="card-title">Ramas</div>' +
      '<div class="field"><label>Una rama por línea (desplegable del editor)</label>' +
      '<textarea id="set-ramas" style="min-height:120px">' +
      esc(settings.ramas.join('\n')) + '</textarea></div>' +
      '<div class="btn-row" style="margin:0"><button class="btn primary" data-action="save-ramas">Guardar ramas</button></div></div>';

    // 5. Guardar registros en la tablet
    h += '<div class="card"><div class="card-title">Guardar registros en la tablet</div>' +
      '<div class="hint" style="line-height:1.5">' +
      'Los turnos se guardan dentro de la app y sobreviven a las actualizaciones. ' +
      'Usa "Copia de seguridad" para exportar un archivo manualmente cuando lo necesites.' +
      '</div></div>';

    // 6. Exportar a PDF (multi-select)
    var sortedT = turnos.slice().sort(function (a, b) {
      var fa = (a.servicios[0] && a.servicios[0].fecha) || '';
      var fb = (b.servicios[0] && b.servicios[0].fecha) || '';
      return fb.localeCompare(fa);
    });
    h += '<div class="card"><div class="card-title">Exportar a PDF</div>';
    if (!sortedT.length) {
      h += '<div class="hint">Aún no hay turnos para exportar.</div>';
    } else {
      h += '<div class="hint" style="margin-bottom:8px">Marca los turnos que quieras exportar:</div>' +
        '<div class="pdf-list">';
      sortedT.forEach(function (t) {
        var f = (t.servicios[0] && t.servicios[0].fecha) ? ymdNice(t.servicios[0].fecha) : 'sin fecha';
        var nums = t.servicios.map(function (s) { return s.servicioComercial || '—'; }).join(' / ');
        var est = t.estado === 'cerrado' ? 'cerrado' : 'en curso';
        h += '<label class="pdf-row">' +
          '<input type="checkbox" data-pdfi="' + esc(t.id) + '">' +
          '<span class="pdf-row-text">' + esc(f) + ' · <b>' + esc(nums) + '</b> · ' + est + '</span>' +
          '</label>';
      });
      h += '</div>' +
        '<div class="btn-row" style="margin-top:10px">' +
        '<button class="btn" data-action="pdf-mark-all">Marcar todos</button>' +
        '<button class="btn ghost" data-action="pdf-mark-none">Desmarcar</button>' +
        '<button class="btn primary" data-action="pdf-export" style="margin-left:auto">Exportar seleccionados</button>' +
        '</div>';
    }
    h += '</div>';

    // 7. Copia de seguridad
    h += '<div class="card"><div class="card-title">Copia de seguridad</div>' +
      '<div class="hint">' + turnos.length + ' turnos guardados.</div>' +
      '<div class="btn-row"><button class="btn primary" data-action="export-backup">Exportar copia</button>' +
      '<button class="btn" data-action="import-backup">Importar copia</button></div>' +
      '<input type="file" id="file-backup" accept=".json,application/json" style="display:none">' +
      '</div>';

    // 8. Aplicación
    h += '<div class="card"><div class="card-title">Aplicación</div>' +
      '<div class="hint">Versión instalada: <b>' + esc(APP_VERSION) + '</b></div>' +
      '<div class="btn-row" style="margin-top:8px">' +
      '<button class="btn primary" data-action="check-update">Comprobar actualizaciones</button>' +
      '<button class="btn" data-action="export-backup">Exportar copia ahora</button>' +
      '</div>' +
      '<div class="hint" style="margin-top:6px">Si hay versión nueva en el servidor, la app se recarga sola.</div>' +
      '</div>';

    // 9. Borrar todo
    h += '<div class="card"><div class="card-title">Borrar todo</div>' +
      '<div class="btn-row" style="margin:0"><button class="btn danger" data-action="wipe">Borrar todos los datos</button></div></div>';

    h += '<div class="hint" style="text-align:center;margin-top:8px">RV Iryo · datos guardados solo en esta tablet</div>';
    pane.innerHTML = h;
  }

  function applyTheme() {
    document.body.classList.toggle('light', settings.theme === 'light');
  }

  // ===== Exportación PDF =====
  function pintarTurnoEnDoc(doc, t) {
    var W = 210, M = 14;
    var state = { y: 16 };
    function line(txt, opt) {
      opt = opt || {};
      doc.setFont('helvetica', opt.bold ? 'bold' : 'normal');
      doc.setFontSize(opt.size || 10);
      if (opt.color) doc.setTextColor.apply(doc, opt.color);
      else doc.setTextColor(20, 20, 20);
      var lines = doc.splitTextToSize(txt, opt.w || (W - 2 * M));
      doc.text(lines, opt.x || M, state.y);
      state.y += (opt.size || 10) * 0.45 * lines.length + (opt.gap || 1.5);
    }
    function rule() { doc.setDrawColor(200); doc.line(M, state.y, W - M, state.y); state.y += 3; }
    function checkPage() { if (state.y > 272) { doc.addPage(); state.y = 16; } }

    line('RV Iryo — Registro de Viajes', { bold: true, size: 15, color: [232, 32, 28] });
    line('Estado: ' + (t.estado === 'cerrado' ? 'Cerrado' : 'En curso'), { size: 9, color: [120, 120, 120] });
    rule();
    line('Teléfono: ' + (settings.telefono || '—'), { size: 10, gap: 3 });

    t.servicios.forEach(function (s, si) {
      checkPage();
      rule();
      line('SERVICIO ' + (si + 1) + '  ·  ' + ymdNice(s.fecha) +
        (s.horaLTV ? '  ·  LTV ' + s.horaLTV : ''),
        { bold: true, size: 12, color: [232, 32, 28] });
      line('Servicio Comercial: ' + (s.servicioComercial || '—') +
        (s.origen ? '  (' + s.origen + ' → ' + s.destino + ')' : ''), { size: 10 });
      line('Vía: ' + (s.via || '—') + '     Rama: ' + (s.rama || '—'), { size: 10 });
      line('N1: ' + (s.n1 || '—'), { size: 10 });

      // Origen
      checkPage();
      line('Origen ' + (s.origen || '—') + '   Sal: ' + (s.hSalida || '—') +
        (s.rSalida ? '  [ret. ' + s.rSalida + ' min]' : ''),
        { bold: true, size: 10, color: [21, 128, 61] });
      if (s.viajeros || s.asistencias || (s.pmr && s.pmr.length)) {
        line('  Viajeros ' + (s.viajeros || '0') +
             '  Asist ' + (s.asistencias || '0') +
             '  PMR ' + ((s.pmr && s.pmr.length) || '0'),
          { size: 8, x: M + 3, gap: 1, color: [110, 110, 110] });
      }
      if (s.pmr && s.pmr.length) {
        s.pmr.forEach(function (pm, idx) {
          line('  PMR ' + (idx + 1) + ' baja en: ' + (pm.baja || '—'),
            { size: 8, x: M + 3, gap: 1, color: [110, 110, 110] });
        });
      }

      // Paradas intermedias
      (s.paradas || []).forEach(function (p) {
        checkPage();
        var hSal = p.hora || '—';
        var hLleg = (p.tParada > 0 && p.hora) ? subMinutos(p.hora, p.tParada) : '—';
        line('Parada ' + (p.nombre || '?') +
          '   Lleg: ' + hLleg + (p.rLleg ? ' [ret. ' + p.rLleg + ' min]' : '') +
          '   Sal: ' + hSal + (p.rSal ? ' [ret. ' + p.rSal + ' min]' : ''),
          { bold: true, size: 10 });
        if (p.viajeros || p.asistencias) {
          line('  Viajeros ' + (p.viajeros || '0') +
               '  Asist ' + (p.asistencias || '0'),
            { size: 8, x: M + 3, gap: 1, color: [110, 110, 110] });
        }
      });

      // Destino
      checkPage();
      line('Destino ' + (s.destino || '—') + '   Lleg: ' + (s.hDestino || '—') +
        (s.rLlegDestino ? '  [ret. ' + s.rLlegDestino + ' min]' : ''),
        { bold: true, size: 10, color: [185, 28, 28] });

      checkPage();
      line('Comprobaciones:', { bold: true, size: 10 });
      COMPROBACIONES.forEach(function (c, ci) {
        checkPage();
        line((s.comprobaciones[ci] ? '[X] ' : '[  ] ') + c, { size: 9, x: M + 3, gap: 1 });
      });
      state.y += 1.5;
      checkPage();
      line('Observaciones durante el trayecto:', { bold: true, size: 10 });
      line(s.observaciones || '—', { size: 9, gap: 3 });
    });
  }

  function exportPDF(t) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      appModal.alert({ title: 'PDF no disponible', message: 'No se pudo cargar el generador de PDF. Revisa la conexión.' });
      return;
    }
    var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    pintarTurnoEnDoc(doc, t);
    doc.save('turno-' + (t.servicios[0] ? t.servicios[0].fecha : 'sin-fecha') + '.pdf');
    flashSaved();
  }

  function exportPDFAll() { exportPDFMany(turnos.map(function (t) { return t.id; })); }

  function exportPDFMany(ids) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      appModal.alert({ title: 'PDF no disponible', message: 'No se pudo cargar el generador de PDF. Revisa la conexión.' });
      return;
    }
    var selected = ids.map(getTurno).filter(Boolean);
    if (!selected.length) { appModal.alert({ title: 'Sin selección', message: 'No hay turnos para exportar.' }); return; }
    var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    selected.sort(function (a, b) {
      var fa = (a.servicios[0] && a.servicios[0].fecha) || '';
      var fb = (b.servicios[0] && b.servicios[0].fecha) || '';
      return fa.localeCompare(fb);
    });
    selected.forEach(function (t, i) {
      if (i > 0) doc.addPage();
      pintarTurnoEnDoc(doc, t);
    });
    var name = selected.length === 1
      ? 'turno-' + (selected[0].servicios[0] ? selected[0].servicios[0].fecha : 'sin-fecha') + '.pdf'
      : 'rviryo-' + selected.length + 'turnos-' + today() + '.pdf';
    doc.save(name);
    flashSaved();
  }

  // ===== Respaldo =====
  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function exportBackup() {
    var data = { app: 'rviryo', version: 1, fecha: new Date().toISOString(),
      turnos: turnos, settings: settings };
    var jsonBlob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    downloadBlob(jsonBlob, 'rviryo-copia-' + today() + '.json');

    var html = buildBackupHtml(turnos, settings);
    var htmlBlob = new Blob([html], { type: 'text/html' });
    downloadBlob(htmlBlob, 'rviryo-resumen-' + today() + '.html');

    settings.lastBackup = today();
    saveSettings();
    flashSaved();
  }
  function buildBackupHtml(turnos, settings) {
    var sorted = turnos.slice().sort(function (a, b) {
      var fa = (a.servicios[0] && a.servicios[0].fecha) || '';
      var fb = (b.servicios[0] && b.servicios[0].fecha) || '';
      return fb.localeCompare(fa);
    });
    var totalServ = 0;
    sorted.forEach(function (t) { totalServ += t.servicios.length; });

    var css = 'body{font-family:system-ui,sans-serif;background:#f6f8fa;color:#0d1117;margin:0;padding:20px;max-width:980px;margin-left:auto;margin-right:auto}' +
      'h1{color:#e8201c;margin:0 0 4px}' +
      '.sub{color:#666;font-size:13px;margin-bottom:24px}' +
      '.totals{display:flex;gap:16px;margin-bottom:24px}' +
      '.totals .tt{background:#fff;border:1px solid #ddd;border-radius:8px;padding:10px 14px;font-size:13px}' +
      '.totals .tt b{font-size:22px;color:#e8201c;display:block;font-weight:700}' +
      '.turno{background:#fff;border:1px solid #ccc;border-radius:10px;padding:14px;margin-bottom:14px}' +
      '.turno-head{display:flex;align-items:center;gap:10px;margin-bottom:6px;font-weight:600;font-size:15px;flex-wrap:wrap}' +
      '.estado{font-size:11px;padding:2px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:.3px}' +
      '.estado.cerrado{background:#dcfce7;color:#15803d}' +
      '.estado.en_curso{background:#fef3c7;color:#9a3412}' +
      '.meta{margin-left:auto;color:#666;font-size:13px;font-weight:400}' +
      '.servicio{border-top:1px solid #eee;padding-top:10px;margin-top:10px}' +
      '.servicio h3{margin:0 0 8px;font-size:15px;color:#e8201c}' +
      '.fr{display:flex;flex-wrap:wrap;gap:14px;font-size:13px;margin-bottom:8px}' +
      '.fr span{min-width:120px}' +
      '.fr b{display:block;color:#888;font-size:10px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:1px}' +
      'table{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0}' +
      'table th,table td{padding:5px 8px;border:1px solid #ddd;text-align:left}' +
      'table th{background:#f0f3f6;font-weight:600;font-size:11px;text-transform:uppercase}' +
      '.chk{display:flex;flex-wrap:wrap;gap:6px;font-size:11px;margin:8px 0}' +
      '.chk span{padding:3px 8px;border-radius:4px}' +
      '.chk .ok{background:#dcfce7;color:#15803d}' +
      '.chk .no{background:#f0f3f6;color:#888}' +
      '.obs{font-size:13px;line-height:1.5;background:#f9fafb;padding:10px;border-radius:6px;white-space:pre-wrap;margin-top:8px;border-left:3px solid #a371f7}' +
      '@media print{body{background:#fff}.turno{break-inside:avoid}}';

    var body = '<h1>RV Iryo — Registro de viajes</h1>' +
      '<div class="sub">Generado el ' + new Date().toLocaleString('es-ES') + '</div>' +
      '<div class="totals">' +
      '<div class="tt"><b>' + sorted.length + '</b>Turnos</div>' +
      '<div class="tt"><b>' + totalServ + '</b>Servicios</div>' +
      '</div>';

    sorted.forEach(function (t) {
      var fechas = (t.servicios.map(function (s) { return s.fecha ? ymdNice(s.fecha) : ''; }).filter(Boolean)).join(' · ');
      body += '<div class="turno"><div class="turno-head">' +
        '<span>' + esc(fechas || '(sin fecha)') + '</span>' +
        '<span class="estado ' + esc(t.estado) + '">' + (t.estado === 'cerrado' ? 'Cerrado' : 'En curso') + '</span>' +
        '<span class="meta">' +
        (settings.telefono ? 'Tel ' + esc(settings.telefono) : '') + '</span>' +
        '</div>';

      t.servicios.forEach(function (s, si) {
        var pmrCount = (s.pmr && s.pmr.length) || 0;
        var pmrDestinos = (s.pmr || []).map(function (p) { return p.baja || '—'; }).join(', ');
        body += '<div class="servicio">' +
          '<h3>Servicio ' + esc(s.servicioComercial || (si + 1)) +
          (s.origen ? ' — ' + esc(s.origen) + ' → ' + esc(s.destino) : '') +
          (s.horaLTV ? ' <span style="color:#888;font-size:13px;font-weight:400">· LTV ' + esc(s.horaLTV) + '</span>' : '') +
          '</h3>' +
          '<div class="fr">' +
          '<span><b>Fecha</b>' + esc(s.fecha ? ymdNice(s.fecha) : '—') + '</span>' +
          '<span><b>Vía</b>' + esc(s.via || '—') + '</span>' +
          '<span><b>Rama</b>' + esc(s.rama || '—') + '</span>' +
          '<span><b>H. Salida</b>' + esc(s.hSalida || '—') +
          (s.rSalida ? ' <span style="color:#9a3412">(+' + esc(s.rSalida) + 'm)</span>' : '') + '</span>' +
          '<span><b>H. Destino</b>' + esc(s.hDestino || '—') +
          (s.rLlegDestino ? ' <span style="color:#9a3412">(+' + esc(s.rLlegDestino) + 'm)</span>' : '') + '</span>' +
          '<span><b>N1</b>' + esc(s.n1 || '—') + '</span>' +
          '<span><b>Viajeros</b>' + esc(s.viajeros || '0') + '</span>' +
          '<span><b>Asistencias</b>' + esc(s.asistencias || '0') + '</span>' +
          '<span><b>PMR</b>' + pmrCount +
          (pmrCount ? ' <span style="color:#666;font-size:11px">(' + esc(pmrDestinos) + ')</span>' : '') + '</span>' +
          '</div>';

        if (s.paradas && s.paradas.length) {
          body += '<table><thead><tr>' +
            '<th>Parada</th><th>H. Lleg</th><th>Ret. lleg</th><th>H. Sal</th><th>Ret. sal</th>' +
            '<th>Viajeros</th><th>Asist.</th>' +
            '</tr></thead><tbody>';
          s.paradas.forEach(function (p) {
            var hLleg = (p.tParada > 0 && p.hora) ? subMinutos(p.hora, p.tParada) : '—';
            body += '<tr>' +
              '<td>' + esc(p.nombre || '—') + '</td>' +
              '<td>' + esc(hLleg) + '</td>' +
              '<td>' + esc(p.rLleg || '—') + '</td>' +
              '<td>' + esc(p.hora || '—') + '</td>' +
              '<td>' + esc(p.rSal || '—') + '</td>' +
              '<td>' + esc(p.viajeros || '0') + '</td>' +
              '<td>' + esc(p.asistencias || '0') + '</td>' +
              '</tr>';
          });
          body += '</tbody></table>';
        }

        body += '<div class="chk">';
        COMPROBACIONES.forEach(function (lab, ci) {
          var ok = s.comprobaciones && s.comprobaciones[ci];
          body += '<span class="' + (ok ? 'ok' : 'no') + '">' +
            (ok ? '✓ ' : '☐ ') + esc(lab) + '</span>';
        });
        body += '</div>';

        if (s.observaciones) {
          body += '<div class="obs"><b>Observaciones:</b> ' + esc(s.observaciones) + '</div>';
        }
        body += '</div>';
      });

      body += '</div>';
    });

    return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>RV Iryo — Resumen ' + today() + '</title>' +
      '<style>' + css + '</style></head>' +
      '<body>' + body + '</body></html>';
  }
  function importBackup(file) {
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result);
        if (d.app !== 'rviryo' || !Array.isArray(d.turnos)) {
          appModal.alert({ title: 'Archivo no válido', message: 'El archivo no es una copia válida de RV Iryo.' });
          return;
        }
        appModal.confirm({
          title: 'Restaurar copia',
          message: 'Esto sustituirá los ' + turnos.length + ' turnos actuales por los ' + d.turnos.length + ' de la copia. ¿Continuar?',
          buttons: [
            { label: 'Cancelar', value: false, kind: 'neutral' },
            { label: 'Restaurar', value: true, kind: 'danger' }
          ]
        }).then(function (ok) {
          if (!ok) return;
          turnos = d.turnos.map(normTurno);
          if (d.settings) {
            settings = d.settings;
            if (!settings.ramas || !settings.ramas.length) settings.ramas = DEFAULT_RAMAS.slice();
            if (!settings.theme) settings.theme = 'dark';
          }
          save(K_TURNOS, turnos);
          saveSettings();
          applyTheme();
          appModal.alert({ title: 'Copia restaurada', message: 'Copia importada: ' + turnos.length + ' turnos.' });
          renderSettings();
        });
      } catch (e) {
        appModal.alert({ title: 'Error al leer', message: 'No se pudo leer el archivo.' });
      }
    };
    rd.readAsText(file);
  }
  // ===== Eventos delegados =====
  function onInput(e) {
    var el = e.target;
    var bind = el.getAttribute && el.getAttribute('data-bind');
    if (!bind) return;
    if (el.type === 'checkbox') applyBind(bind, el.checked);
    else applyBind(bind, el.value);
  }
  function onChange(e) {
    var el = e.target;
    if (el.classList && el.classList.contains('srv-sel')) {
      var si = +el.getAttribute('data-svc');
      var opt = el.selectedOptions && el.selectedOptions[0];
      var t = getTurno(editId);
      var s = t ? t.servicios[si] : null;
      // Aviso si hay servicio activo y aún en trayecto (evita cambios involuntarios).
      function doAutofillSrv() {
        if (opt && opt.getAttribute('data-idx') != null) {
          autofillServicio(si, +opt.getAttribute('data-idx'));
        } else if (t && s) {
          s.servicioComercial = ''; s.origen = ''; s.destino = '';
          autosave();
          refreshServicioCard(si);
        }
      }
      if (s && s.servicioComercial && servicioEnCurso(s)) {
        var nuevoNum = '';
        if (opt && opt.getAttribute('data-idx') != null) {
          var hr = horarios[+opt.getAttribute('data-idx')];
          nuevoNum = hr ? hr.servicio : '';
        }
        if (nuevoNum !== s.servicioComercial) {
          appModal.confirm({
            title: 'Cambiar servicio activo',
            message: 'Hay un servicio activo (' + s.servicioComercial + '). ¿Reemplazar por ' + (nuevoNum || '(ninguno)') + '?',
            buttons: [
              { label: 'Cancelar', value: false, kind: 'neutral' },
              { label: 'Reemplazar', value: true, kind: 'danger' }
            ]
          }).then(function (ok) {
            if (!ok) { refreshServicioCard(si); return; }
            doAutofillSrv();
          });
          return;
        }
      }
      doAutofillSrv();
      return;
    }
    onInput(e);
  }

  function onClick(e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var act = el.getAttribute('data-action');
    var t = getTurno(editId);

    if (act === 'cal-prev') {
      calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
      renderCalendar(); return;
    }
    if (act === 'cal-next') {
      calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
      renderCalendar(); return;
    }
    if (act === 'cal-toggle') {
      settings.calView = settings.calView === 'list' ? 'grid' : 'list';
      saveSettings(); renderCalendar(); return;
    }
    if (act === 'cal-day') { openDay(el.getAttribute('data-day')); return; }
    if (act === 'open-turno') { openEditor(el.getAttribute('data-id')); return; }
    if (act === 'new-turno') {
      var nt = blankTurno(el.getAttribute('data-day'));
      turnos.push(nt); save(K_TURNOS, turnos); openEditor(nt.id); return;
    }
    if (act === 'volver') { discardEmptyEdit(); renderCalendar(); setView('calendario'); return; }

    if (act === 'add-servicio' && t) {
      var lastF = t.servicios[t.servicios.length - 1].fecha;
      t.servicios.push(blankServicio(lastF));
      expandedSvc = t.servicios.length - 1;
      autosave(); renderEditor(); return;
    }
    if (act === 'svc-toggle') {
      var nv = +el.getAttribute('data-svc');
      expandedSvc = (expandedSvc === nv) ? -1 : nv;
      renderEditor(); return;
    }
    if (act === 'del-servicio' && t) {
      var dsi = +el.getAttribute('data-svc');
      appModal.confirm({
        title: 'Quitar servicio',
        message: '¿Quitar este servicio del turno? No se puede deshacer.',
        buttons: [
          { label: 'Cancelar', value: false, kind: 'neutral' },
          { label: 'Quitar', value: true, kind: 'danger' }
        ]
      }).then(function (ok) {
        if (!ok) return;
        t.servicios.splice(dsi, 1);
        if (expandedSvc >= t.servicios.length) expandedSvc = t.servicios.length - 1;
        autosave(); renderEditor();
      });
      return;
    }
    if (act === 'add-parada-end' && t) {
      var asi = +el.getAttribute('data-svc');
      t.servicios[asi].paradas.push(blankParada());
      autosave(); renderEditor(); return;
    }
    if (act === 'add-parada-before' && t) {
      var bsi = +el.getAttribute('data-svc');
      var bi = +el.getAttribute('data-par');
      t.servicios[bsi].paradas.splice(bi, 0, blankParada());
      autosave(); renderEditor(); return;
    }
    if (act === 'del-parada' && t) {
      var dpsi = +el.getAttribute('data-svc');
      var dppi = +el.getAttribute('data-par');
      appModal.confirm({
        title: 'Quitar parada',
        message: '¿Quitar esta parada?',
        buttons: [
          { label: 'Cancelar', value: false, kind: 'neutral' },
          { label: 'Quitar', value: true, kind: 'danger' }
        ]
      }).then(function (ok) {
        if (!ok) return;
        t.servicios[dpsi].paradas.splice(dppi, 1);
        autosave(); renderEditor();
      });
      return;
    }
    if (act === 'add-pmr' && t) {
      var psi = +el.getAttribute('data-svc');
      var parAttr = el.getAttribute('data-par');
      if (parAttr != null) {
        var pari = +parAttr;
        var par = t.servicios[psi].paradas[pari];
        if (!Array.isArray(par.pmr)) par.pmr = [];
        par.pmr.push({ baja: '' });
      } else {
        t.servicios[psi].pmr = t.servicios[psi].pmr || [];
        t.servicios[psi].pmr.push({ baja: '' });
      }
      autosave(); renderEditor(); return;
    }
    if (act === 'del-pmr' && t) {
      var psi2 = +el.getAttribute('data-svc');
      var parAttr2 = el.getAttribute('data-par');
      var pmrI = +el.getAttribute('data-pmr');
      if (parAttr2 != null) {
        t.servicios[psi2].paradas[+parAttr2].pmr.splice(pmrI, 1);
      } else {
        t.servicios[psi2].pmr.splice(pmrI, 1);
      }
      autosave(); renderEditor(); return;
    }
    if (act === 'ret-edit') {
      activeRetBind = el.getAttribute('data-ret-bind');
      renderEditor();
      setTimeout(function () {
        var inp = document.querySelector('.ret-input');
        if (inp) { inp.focus(); inp.select(); }
      }, 0);
      return;
    }
    if (act === 'dictar') {
      var dictSi = +el.getAttribute('data-svc');
      if (currentRec && currentRecSvc === dictSi) stopDictado();
      else { if (currentRec) stopDictado(); startDictado(dictSi); }
      return;
    }
    if (act === 'cerrar' && t) {
      t.estado = 'cerrado';
      save(K_TURNOS, turnos);
      renderEditor();
      flashSaved();
      return;
    }
    if (act === 'reabrir' && t) {
      t.estado = 'en_curso';
      save(K_TURNOS, turnos);
      renderEditor();
      flashSaved();
      return;
    }
    if (act === 'pdf-export') {
      var ids = [];
      document.querySelectorAll('[data-pdfi]').forEach(function (cb) {
        if (cb.checked) ids.push(cb.getAttribute('data-pdfi'));
      });
      if (!ids.length) {
        appModal.alert({ title: 'Sin selección', message: 'Selecciona al menos un turno para exportar.' });
        return;
      }
      exportPDFMany(ids);
      return;
    }
    if (act === 'pdf-mark-all') {
      document.querySelectorAll('[data-pdfi]').forEach(function (cb) { cb.checked = true; });
      return;
    }
    if (act === 'pdf-mark-none') {
      document.querySelectorAll('[data-pdfi]').forEach(function (cb) { cb.checked = false; });
      return;
    }
    if (act === 'borrar' && t) {
      appModal.confirm({
        title: 'Borrar turno',
        message: '¿Borrar este turno por completo? No se puede deshacer.',
        buttons: [
          { label: 'Cancelar', value: false, kind: 'neutral' },
          { label: 'Borrar', value: true, kind: 'danger' }
        ]
      }).then(function (ok) {
        if (!ok) return;
        turnos = turnos.filter(function (x) { return x.id !== t.id; });
        save(K_TURNOS, turnos);
        editId = null;
        renderCalendar(); setView('calendario');
      });
      return;
    }

    // Ajustes
    if (act === 'check-update') {
      if (!('serviceWorker' in navigator)) {
        appModal.alert({ title: 'No compatible', message: 'Tu navegador no soporta actualizaciones automáticas.' });
        return;
      }
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (!reg) {
          appModal.alert({ title: 'Sin Service Worker', message: 'Aún no hay Service Worker. Recarga la página primero.' });
          return;
        }
        reg.update().then(function () {
          setTimeout(function () {
            appModal.alert({ title: 'Al día', message: 'Ya tienes la última versión.' });
          }, 2500);
        }).catch(function () {
          appModal.alert({ title: 'Sin conexión', message: 'No se pudo comprobar la actualización. ¿Tienes conexión?' });
        });
      });
      return;
    }
    if (act === 'theme-dark') { settings.theme = 'dark'; saveSettings(); applyTheme(); return; }
    if (act === 'theme-light') { settings.theme = 'light'; saveSettings(); applyTheme(); return; }
    if (act === 'save-tel') {
      settings.telefono = $('set-tel').value.trim(); saveSettings(); flashSaved(); return;
    }
    if (act === 'save-ramas') {
      var arr = $('set-ramas').value.split('\n').map(function (x) { return x.trim(); })
        .filter(Boolean);
      settings.ramas = arr.length ? arr : DEFAULT_RAMAS.slice();
      saveSettings(); flashSaved(); renderSettings(); return;
    }
    if (act === 'export-backup') { exportBackup(); return; }
    if (act === 'import-backup') { $('file-backup').click(); return; }
    if (act === 'wipe') {
      appModal.confirm({
        title: 'Borrar todo',
        message: '¿Borrar TODOS los turnos y ajustes? Esta acción no se puede deshacer.',
        buttons: [
          { label: 'Cancelar', value: false, kind: 'neutral' },
          { label: 'Borrar todo', value: true, kind: 'danger' }
        ]
      }).then(function (ok) {
        if (!ok) return;
        appModal.confirm({
          title: 'Confirma el borrado',
          message: 'Segunda confirmación: se perderán todos los registros.',
          buttons: [
            { label: 'Cancelar', value: false, kind: 'neutral' },
            { label: 'Sí, borrar todo', value: true, kind: 'danger' }
          ]
        }).then(function (ok2) {
          if (!ok2) return;
          turnos = [];
          try {
            localStorage.removeItem(K_TURNOS);
            localStorage.removeItem(K_SETTINGS);
          } catch (e3) {}
          settings = {}; loadAll(); applyTheme();
          renderSettings();
        });
      });
      return;
    }
  }

  // ===== Inicio =====
  function init() {
    loadAll();
    loadHorarios();
    turnos.forEach(normTurno);
    applyTheme();

    var now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();

    document.querySelectorAll('nav.tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.dataset.view;
        discardEmptyEdit();
        if (v === 'cal') { renderCalendar(); setView('calendario'); }
        else if (v === 'stats') { renderStats(); setView('estadisticas'); }
        else if (v === 'settings') { renderSettings(); setView('ajustes'); }
      });
    });
    $('theme-toggle').addEventListener('click', function () {
      settings.theme = settings.theme === 'light' ? 'dark' : 'light';
      saveSettings(); applyTheme();
    });

    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('click', onClick);

    // Editor inline de retraso: Enter o blur guardan; Escape cancela.
    function commitRet(inp) {
      var bind = inp.getAttribute('data-ret-bind');
      var min = parseRetraso(inp.value);
      var stored = (min == null) ? '' : String(min);
      applyBind(bind, stored);
      activeRetBind = null;
      renderEditor();
    }
    document.addEventListener('keydown', function (e) {
      if (!e.target.classList || !e.target.classList.contains('ret-input')) return;
      if (e.key === 'Enter') { e.preventDefault(); commitRet(e.target); }
      else if (e.key === 'Escape') {
        e.preventDefault(); activeRetBind = null; renderEditor();
      }
    });
    document.addEventListener('blur', function (e) {
      if (e.target.classList && e.target.classList.contains('ret-input')) {
        commitRet(e.target);
      }
    }, true);
    document.addEventListener('change', function (e) {
      if (e.target.id === 'file-backup' && e.target.files[0]) {
        importBackup(e.target.files[0]); e.target.value = '';
      }
      if (e.target.id === 'set-autodl') {
        settings.autoDownload = e.target.checked;
        saveSettings(); flashSaved();
      }
    });

    renderCalendar();
    setView('calendario');

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () {});
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        window.location.reload();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  window.REGISTRO = {
    getActiveTurno: function () {
      return turnos.find(function (t) { return t.estado === 'en_curso'; }) || null;
    },
    // Turno abierto ahora mismo en el editor (o null si no hay editor abierto).
    getEditTurno: function () {
      return editId != null ? getTurno(editId) : null;
    },
    // Índice del servicio expandido en el editor (al que apunta el cross-feed
    // de Horario). Permite que la marcha caiga sobre el 2º servicio, no el 1º.
    getActiveSvcIndex: function () {
      return expandedSvc;
    },
    getOrCreateActiveTurno: function () {
      var t = turnos.find(function (t) { return t.estado === 'en_curso'; });
      if (!t) {
        t = blankTurno(today());
        turnos.push(t);
        save(K_TURNOS, turnos);
      }
      return t;
    },
    setView: setView,
    // switchTo: render + setView (para que app.js active la vista correcta con datos)
    switchTo: function (v) {
      if (v === 'calendario') {
        renderCalendar();
        setView('calendario');
        // Re-render tras el paint para fix de layout intermitente
        // (la primera render puede ocurrir con el pane oculto si venimos
        // de body.locked, lo que cachea dimensiones grid mal calculadas).
        requestAnimationFrame(renderCalendar);
      }
      else if (v === 'estadisticas') { renderStats(); setView('estadisticas'); }
      else if (v === 'ajustes') { renderSettings(); setView('ajustes'); }
      else if (v === 'registro') {
        // Si hay turno cargado, re-renderizar el editor para mantener el
        // servicio expandido (p.ej. el 2º si ya estaba empezado). Si no,
        // abrir el del día actual (flujo openDay del calendario).
        if (editId != null && getTurno(editId)) { renderEditor(); setView('registro'); }
        else { editId = null; openDay(today()); }
      }
    },
    refreshEditor: function () {
      if (editId != null) { renderEditor(); save(K_TURNOS, turnos); }
    },
    discardEmptyEdit: discardEmptyEdit
  };
})();