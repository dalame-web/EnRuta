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

  function onTabChange(name) {
    if (name === lastTab) return;
    lastTab = name;
    localStorage.setItem('iryostudio_active_tab', name);

    if (name === 'calendario' || name === 'registro'
        || name === 'estadisticas' || name === 'ajustes') {
      if (window.REGISTRO && typeof window.REGISTRO.switchTo === 'function') {
        window.REGISTRO.switchTo(name);
      }
    }
    if (name === 'calendario' || name === 'estadisticas' || name === 'ajustes') {
      syncSubnav(name);
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

  // === Cross-feed: HT → Registro (con confirm) ===
  if (window.HTIryo && typeof window.HTIryo.onMarchaChange === 'function') {
    window.HTIryo.onMarchaChange(function () {
      var march = window.HTIryo.getMarch();
      if (!march || !window.REGISTRO) return;
      var turno = window.REGISTRO.getActiveTurno();
      if (!turno) return;
      var svc = turno.servicios && turno.servicios[0];
      if (!svc) return;
      if (svc.servicioComercial && svc.servicioComercial !== march.t) {
        if (confirm('Hay un servicio activo en el turno (' + svc.servicioComercial +
            '). ¿Reemplazar por ' + march.t + '?')) {
          svc.servicioComercial = march.t;
          window.dispatchEvent(new CustomEvent('iryo:marchaApplied', { detail: march }));
        }
      } else if (!svc.servicioComercial) {
        svc.servicioComercial = march.t;
        window.dispatchEvent(new CustomEvent('iryo:marchaApplied', { detail: march }));
      }
    });
  }
})();
