/* Iryo Studio — app.js
 * Hook sobre el nav nativo de HT. Cuando HT cambia body.tab-X,
 * delegamos a window.REGISTRO.switchTo para renderizar las vistas RV.
 * También gestiona el sub-nav de Calendario y los cross-feed entre apps.
 */
(function () {
  'use strict';

  var lastTab = '';

  function syncSubnav(tab) {
    var subActive = (tab === 'estadisticas') ? 'estadisticas'
                  : (tab === 'ajustes') ? 'ajustes'
                  : 'calendario';
    document.querySelectorAll('.cal-sub-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.calSub === subActive);
    });
  }

  // Servicio destino del cross-feed Horario→Registro. Apunta al servicio
  // EXPANDIDO en el editor (p.ej. el 2º), no siempre al primero. Si no hay
  // editor abierto, cae al turno activo (creándolo si allowCreate).
  // Devuelve { turno, svcIndex, svc } o null.
  function svcCtx(allowCreate) {
    var R = window.REGISTRO;
    if (!R) return null;
    var turno = R.getEditTurno && R.getEditTurno();
    if (!turno) {
      turno = (allowCreate && R.getOrCreateActiveTurno)
        ? R.getOrCreateActiveTurno()
        : (R.getActiveTurno && R.getActiveTurno());
    }
    if (!turno || !turno.servicios || !turno.servicios.length) return null;
    var idx = R.getActiveSvcIndex ? R.getActiveSvcIndex() : 0;
    if (idx == null || idx < 0 || idx >= turno.servicios.length) idx = 0;
    return { turno: turno, svcIndex: idx, svc: turno.servicios[idx] };
  }

  // Aplica la marcha activa de HT al turno si éste no tiene servicio asignado.
  // Se llama al entrar en el tab Registro (sync pasivo, sin pedir confirmación).
  function syncMarchaToRegistro() {
    if (!window.HTIryo || !window.REGISTRO) return;
    var march = window.HTIryo.getMarch();
    if (!march || !march.t) return;
    var c = svcCtx(true);
    if (!c) return;
    if (c.svc.servicioComercial) return; // solo si el servicio activo está vacío
    applyMarchToSvc(c.svc, march.t);
    window.dispatchEvent(new CustomEvent('iryo:marchaApplied', { detail: march }));
    if (window.REGISTRO.refreshEditor) window.REGISTRO.refreshEditor();
  }

  function onTabChange(name) {
    if (name === lastTab) return;
    var prev = lastTab;
    lastTab = name;
    localStorage.setItem('iryostudio_active_tab', name);

    // Al salir de Registro: descartar el turno blank si quedó vacío.
    // Evita que el calendario muestre turnos ghost.
    if (prev === 'registro' && name !== 'registro'
        && window.REGISTRO && typeof window.REGISTRO.discardEmptyEdit === 'function') {
      window.REGISTRO.discardEmptyEdit();
    }

    if (name === 'calendario' || name === 'registro'
        || name === 'estadisticas' || name === 'ajustes') {
      if (window.REGISTRO && typeof window.REGISTRO.switchTo === 'function') {
        window.REGISTRO.switchTo(name);
      }
    }
    if (name === 'calendario' || name === 'estadisticas'
        || name === 'ajustes' || name === 'registro') {
      syncSubnav(name);
    }
    // Al entrar en Registro: scroll arriba + sincronizar marcha activa.
    // El scroll real está en #registro-pane (.pane{overflow:auto}), no en window.
    if (name === 'registro') {
      var rp = document.getElementById('registro-pane');
      if (rp) rp.scrollTop = 0;
      window.scrollTo(0, 0);
      window.setTimeout(syncMarchaToRegistro, 100);
    }
  }

  // HT's switchTab solo limpia tabs que conoce (home/schedule/map/dhltv/usoweb/adif).
  // Hay que retirar las nuevas (registro/calendario/estadisticas/ajustes) antes de que
  // el click de un tab "viejo" llegue a HT. Listener en captura sobre .tab clicks.
  var EXTRA_TABS = ['tab-registro','tab-calendario','tab-estadisticas','tab-ajustes'];
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('.tab[data-tab]');
    if (!t) return;
    document.body.classList.remove.apply(document.body.classList, EXTRA_TABS);
  }, true);

  // Observer sobre body.className para detectar tab-X (lo setea HT switchTab).
  var observerSelfTriggered = false;
  new MutationObserver(function () {
    if (observerSelfTriggered) { observerSelfTriggered = false; return; }
    var classes = document.body.className.split(/\s+/);
    var tabClasses = classes.filter(function (c) { return /^tab-/.test(c); });
    if (tabClasses.length === 0) return;
    // Última clase tab-X gana. Si hay más de una, limpiar las anteriores.
    var current = tabClasses[tabClasses.length - 1];
    if (tabClasses.length > 1) {
      observerSelfTriggered = true;
      tabClasses.slice(0, -1).forEach(function (c) { document.body.classList.remove(c); });
    }
    onTabChange(current.replace(/^tab-/, ''));
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // Sub-nav clicks: estadisticas/ajustes no tienen tab principal,
  // hay que forzar body.tab-X y mostrar el pane manualmente.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.cal-sub-btn');
    if (!btn) return;
    var sub = btn.dataset.calSub;
    if (sub === 'calendario') {
      var mainBtn = document.querySelector('.tab[data-tab="calendario"]');
      if (mainBtn) mainBtn.click();
      return;
    }
    // estadisticas o ajustes: desactivar tabs principales, activar pane RV
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    document.querySelectorAll('.pane').forEach(function (p) {
      p.classList.toggle('active', p.id === sub + '-pane');
    });
    document.body.className = document.body.className
      .replace(/\btab-\w+\b/g, '').trim() + ' tab-' + sub;
  });

  // Restaurar última tab al cargar (tras desbloqueo PIN).
  function restoreTab() {
    var last = localStorage.getItem('iryostudio_active_tab') || 'home';
    var btn = document.querySelector('.tab[data-tab="' + last + '"]');
    if (btn) { btn.click(); return; }
    var sb = document.querySelector('.cal-sub-btn[data-cal-sub="' + last + '"]');
    if (sb) sb.click();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreTab);
  } else {
    restoreTab();
  }

  // === Cross-feed: Registro → Horario ===
  window.addEventListener('iryo:openService', function (e) {
    var num = e.detail && e.detail.num;
    var btn = document.querySelector('.tab[data-tab="schedule"]');
    if (btn) btn.click();
    if (window.HTIryo && typeof window.HTIryo.showService === 'function' && num) {
      window.HTIryo.showService(num);
    }
  });

  // === Cross-feed: Registro → Horario (cambio de servicio, sin cambiar tab) ===
  window.addEventListener('iryo:registroServiceChanged', function (e) {
    var num = e.detail && e.detail.num;
    if (!num) return;
    // Idempotencia: si HT ya está en este servicio, no hacer nada.
    if (window.HTIryo && typeof window.HTIryo.getMarch === 'function') {
      var march = window.HTIryo.getMarch();
      if (march && march.t === String(num)) return;
    }
    if (window.HTIryo && typeof window.HTIryo.showService === 'function') {
      window.HTIryo.showService(num, true); // noNav = sin cambiar de pestaña
    }
  });

  // === Cross-feed: Retrasos HT → Registro ===
  // Reglas:
  //   - Valor frozen (marca real) → siempre escribir, marca el campo como
  //     congelado para que no se machaque después.
  //   - Valor live (delta en vivo) → solo escribir si el campo NO está congelado.
  //   - delays sin valor para un campo → NO tocar lo grabado (preservar).
  function applyDelaysToSvc(svc, delays) {
    if (!svc || !delays) return;
    function applyField(field, frozenField, value, frozen) {
      if (!value) return;                       // sin valor: no tocar
      if (frozen) { svc[field] = value; svc[frozenField] = true; return; }
      if (svc[frozenField]) return;              // ya congelado: no machacar
      svc[field] = value;                        // live sobre campo no congelado
    }
    applyField('rSalida', '_rSalidaFrozen', delays.rSalida, delays.rSalidaFrozen);
    applyField('rLlegDestino', '_rLlegDestinoFrozen', delays.rLlegDestino, delays.rLlegDestinoFrozen);
    (svc.paradas || []).forEach(function (p) {
      var d = delays.paradas && delays.paradas[p.nombre];
      if (!d) return;
      if (d.frozen) {
        p.rLleg = d.rLleg; p.rSal = d.rSal;
        p._rLlegFrozen = true; p._rSalFrozen = true;
        return;
      }
      if (!p._rLlegFrozen) p.rLleg = d.rLleg;
      if (!p._rSalFrozen) p.rSal = d.rSal;
    });
  }

  // Debounce: cuando GPS marca en cascada (G2), setMark dispara N eventos
  // muy rápidos. Sin debounce, applyDelaysToSvc + refreshEditor se ejecutaría
  // N veces. Agrupamos en una sola actualización.
  var _delaysTimer = null;
  function _doDelayCrossfeed() {
    _delaysTimer = null;
    if (!window.HTIryo || !window.HTIryo.getStopDelays || !window.REGISTRO) return;
    var march = window.HTIryo.getMarch();
    if (!march || !march.t) return;
    var c = svcCtx(false);
    if (!c) return;
    var svc = c.svc;
    // FIX transversal: si svc tiene número pero NO paradas, intentar
    // rellenar el tramo ahora (HT puede haber detectado leg después).
    var needsTramo = svc.servicioComercial === String(march.t)
      && (!svc.paradas || svc.paradas.length === 0);
    if (needsTramo) applyMarchToSvc(svc, march.t);
    var delays = window.HTIryo.getStopDelays();
    if (delays) applyDelaysToSvc(svc, delays);
    if (window.REGISTRO.refreshEditor) window.REGISTRO.refreshEditor();
  }
  window.addEventListener('iryo:htDelaysChanged', function () {
    if (_delaysTimer) clearTimeout(_delaysTimer);
    _delaysTimer = setTimeout(_doDelayCrossfeed, 200);
  });
  // Mismo handler para cuando HT cambia tramo (transversal cruza umbral Atocha).
  window.addEventListener('iryo:legChanged', function () {
    if (_delaysTimer) clearTimeout(_delaysTimer);
    _delaysTimer = setTimeout(_doDelayCrossfeed, 50);
  });

  // === Cross-feed: HT → Registro (completo) ===

  // Devuelve true si el servicio ya ha llegado a destino (hDestino < hora actual).
  function serviceComplete(svc) {
    if (!svc || !svc.hDestino) return false;
    var parts = svc.hDestino.split(':');
    if (parts.length < 2) return false;
    var dest = new Date();
    dest.setHours(+parts[0], +parts[1], 0, 0);
    return new Date() >= dest;
  }

  // Copia los datos del tramo HT al servicio del turno activo.
  // Si el servicio es transversal (split en Atocha → 2 tramos en RV_HORARIOS):
  //   1. Si el Registro ya tiene origen elegido por el maquinista → matchear ese tramo.
  //   2. Si HT tiene un tramo detectado (activeLegStart > 0) → usar ese.
  //   3. Si no sabemos → solo asignar servicioComercial y dejar que el maquinista
  //      elija manualmente en el <select> del editor (no inventar tramo).
  function applyMarchToSvc(svc, marchT) {
    var allTramos = (window.RV_HORARIOS || []).filter(function (h) {
      return h.servicio === String(marchT);
    });
    svc.servicioComercial = String(marchT);
    if (allTramos.length === 0) return;

    var tramo = null;
    if (allTramos.length === 1) {
      tramo = allTramos[0];
    } else {
      // Transversal split.
      if (svc.origen) {
        tramo = allTramos.find(function (h) { return h.origen === svc.origen; });
      }
      if (!tramo && window.HTIryo && typeof window.HTIryo.getActiveLegInfo === 'function') {
        var info = window.HTIryo.getActiveLegInfo();
        if (info && info.origen) {
          tramo = allTramos.find(function (h) { return h.origen === info.origen; });
        }
      }
      // Si seguimos sin tramo: NO aplicar uno a ciegas. El maquinista elige.
    }

    if (!tramo) return;
    svc.origen   = tramo.origen;
    svc.destino  = tramo.destino;
    svc.hSalida  = tramo.hSalida;
    svc.hDestino = tramo.hDestino;
    svc.paradas = tramo.paradas.map(function (p) {
      return {
        nombre: p.nombre, hora: p.hora, tParada: p.tParada,
        rLleg: '', rSal: '', viajeros: '', asistencias: '', pmr: []
      };
    });
  }

  if (window.HTIryo && typeof window.HTIryo.onMarchaChange === 'function') {
    window.HTIryo.onMarchaChange(function () {
      var march = window.HTIryo.getMarch();
      if (!march || !march.t || !window.REGISTRO) return;
      var c = svcCtx(true);
      if (!c) return;
      var svc = c.svc;
      // Mismo servicio ya asignado: re-aplicar SOLO si svc.paradas está vacío
      // (caso transversal: detectActiveLeg activó el tramo después del primer
      // onMarchaChange — re-evaluar ahora que HT.getActiveLegInfo da tramo).
      if (svc.servicioComercial === String(march.t)) {
        if (!svc.paradas || svc.paradas.length === 0) {
          applyMarchToSvc(svc, march.t);
          if (svc.paradas && svc.paradas.length > 0) {
            window.dispatchEvent(new CustomEvent('iryo:marchaApplied', { detail: march }));
            if (window.REGISTRO.refreshEditor) window.REGISTRO.refreshEditor();
          }
        }
        return;
      }

      function doApply() {
        applyMarchToSvc(svc, march.t);
        window.dispatchEvent(new CustomEvent('iryo:marchaApplied', { detail: march }));
        if (window.REGISTRO.refreshEditor) window.REGISTRO.refreshEditor();
      }

      if (!svc.servicioComercial) {
        // Sin servicio asignado → aplicar directo.
        doApply();
      } else if (serviceComplete(svc)) {
        // Servicio ya terminado → aplicar sin aviso.
        doApply();
      } else {
        // Servicio en curso → confirmar antes de reemplazar (modal propio,
        // no confirm() nativo que bloquea el hilo).
        var msg = 'Hay un servicio activo (' + svc.servicioComercial +
          '). ¿Reemplazar por ' + march.t + '?';
        if (window.appModal && window.appModal.confirm) {
          window.appModal.confirm({
            title: 'Cambiar servicio activo',
            message: msg,
            buttons: [
              { label: 'Cancelar', value: false, kind: 'neutral' },
              { label: 'Reemplazar', value: true, kind: 'danger' }
            ]
          }).then(function (ok) { if (ok) doApply(); });
        } else if (confirm(msg)) {
          doApply();
        }
      }
    });
  }
})();
