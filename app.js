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

  // Aplica la marcha activa de HT al turno si éste no tiene servicio asignado.
  // Se llama al entrar en el tab Registro (sync pasivo, sin pedir confirmación).
  function syncMarchaToRegistro() {
    if (!window.HTIryo || !window.REGISTRO) return;
    var march = window.HTIryo.getMarch();
    if (!march || !march.t) return;
    var turno = window.REGISTRO.getOrCreateActiveTurno
      ? window.REGISTRO.getOrCreateActiveTurno()
      : window.REGISTRO.getActiveTurno();
    if (!turno) return;
    var svc = turno.servicios && turno.servicios[0];
    if (!svc || svc.servicioComercial) return; // solo si el turno está vacío
    applyMarchToSvc(svc, march.t);
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
    if (name === 'registro') {
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
  function applyDelaysToSvc(svc, delays) {
    if (!svc || !delays) return;
    if (delays.rSalida) svc.rSalida = delays.rSalida;
    if (delays.rLlegDestino) svc.rLlegDestino = delays.rLlegDestino;
    (svc.paradas || []).forEach(function (p) {
      var d = delays.paradas && delays.paradas[p.nombre];
      if (d) { p.rLleg = d.rLleg; p.rSal = d.rSal; }
    });
  }

  window.addEventListener('iryo:htDelaysChanged', function () {
    if (!window.HTIryo || !window.HTIryo.getStopDelays || !window.REGISTRO) return;
    var delays = window.HTIryo.getStopDelays();
    if (!delays) return;
    var turno = window.REGISTRO.getActiveTurno && window.REGISTRO.getActiveTurno();
    if (!turno) return;
    var svc = turno.servicios && turno.servicios[0];
    if (!svc) return;
    applyDelaysToSvc(svc, delays);
    if (window.REGISTRO.refreshEditor) window.REGISTRO.refreshEditor();
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

  // Copia todos los datos del tramo HT al servicio del turno activo.
  function applyMarchToSvc(svc, marchT) {
    var tramo = (window.RV_HORARIOS || []).find(function (h) {
      return h.servicio === String(marchT);
    });
    svc.servicioComercial = String(marchT);
    if (tramo) {
      svc.origen   = tramo.origen;
      svc.destino  = tramo.destino;
      svc.hSalida  = tramo.hSalida;
      svc.hDestino = tramo.hDestino;
      // Paradas intermedias: horas teóricas como referencia; rLleg/rSal vacíos para editar.
      svc.paradas = tramo.paradas.map(function (p) {
        return {
          nombre: p.nombre,
          hora: p.hora,
          tParada: p.tParada,
          rLleg: '',
          rSal: '',
          viajeros: '',
          asistencias: '',
          pmr: []
        };
      });
    }
  }

  if (window.HTIryo && typeof window.HTIryo.onMarchaChange === 'function') {
    window.HTIryo.onMarchaChange(function () {
      var march = window.HTIryo.getMarch();
      if (!march || !march.t || !window.REGISTRO) return;
      var turno = window.REGISTRO.getOrCreateActiveTurno
        ? window.REGISTRO.getOrCreateActiveTurno()
        : window.REGISTRO.getActiveTurno();
      if (!turno) return;
      var svc = turno.servicios && turno.servicios[0];
      if (!svc) return;
      // Mismo servicio ya asignado: no hacer nada.
      if (svc.servicioComercial === String(march.t)) return;

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
        // Servicio en curso → confirmar antes de reemplazar.
        if (confirm('Hay un servicio activo (' + svc.servicioComercial +
            '). ¿Reemplazar por ' + march.t + '?')) {
          doApply();
        }
      }
    });
  }
})();
