/* Iryo Studio — app.js
 * Router de pestañas externas + cross-feed HT ↔ Registro.
 */
(function () {
  'use strict';

  // === Router de pestañas Studio ===

  var studioNav = document.getElementById('studio-nav');
  var tabs = studioNav ? studioNav.querySelectorAll('.studio-tab-btn') : [];
  var horarioPane = document.getElementById('studio-horario-pane');
  var rvPane = document.getElementById('studio-rvpane');

  function updateNavButtons(name) {
    tabs.forEach(function (b) {
      b.classList.toggle('active', b.dataset.studioTab === name);
    });
  }

  function switchTab(name) {
    var isHT = (name === 'horario');
    if (horarioPane) horarioPane.classList.toggle('studio-hidden', !isHT);
    if (rvPane) rvPane.classList.toggle('studio-hidden', isHT);
    updateNavButtons(name);
    localStorage.setItem('iryostudio_active_tab', name);

    // Si cambiamos a una pestaña RV, pedirle a registro.js que renderice + muestre
    if (!isHT && window.REGISTRO && typeof window.REGISTRO.switchTo === 'function') {
      window.REGISTRO.switchTo(name);
    }
  }

  tabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      switchTab(btn.dataset.studioTab);
    });
  });

  // Cuando registro.js llama setView(), sincronizar el botón activo del Studio nav
  // Solo si ya estamos en la sección RV (no sobreescribir cuando Horario está activo)
  window.addEventListener('iryo:setView', function (e) {
    var current = localStorage.getItem('iryostudio_active_tab') || 'horario';
    if (current === 'horario') return;
    var viewToTab = {
      calendario: 'calendario',
      registro: 'registro',
      estadisticas: 'estadisticas',
      ajustes: 'ajustes'
    };
    var tab = viewToTab[e.detail && e.detail.view];
    if (tab) updateNavButtons(tab);
  });

  // Restaurar última pestaña activa
  var last = localStorage.getItem('iryostudio_active_tab') || 'horario';
  switchTab(last);

  // === Cross-feed: Registro → Horario ===
  window.addEventListener('iryo:openService', function (e) {
    var num = e.detail && e.detail.num;
    switchTab('horario');
    if (window.HTIryo && typeof window.HTIryo.showService === 'function' && num) {
      window.HTIryo.showService(num);
    }
  });

  // === Cross-feed: HT → Registro (con confirm) [C11] ===
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
