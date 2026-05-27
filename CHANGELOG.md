# Changelog

Todos los cambios notables a este proyecto se documentan en este
archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y este proyecto sigue [SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Changed
- Refactor del nav: eliminado `#studio-nav`. Se reutiliza el nav nativo
  de HT añadiendo tabs `Registro` y `Calendario`.
- Sub-nav `Estadísticas` / `Ajustes` aparece como barra debajo del nav
  principal solo cuando la sección Calendario está activa.
- Botón `Registro`: si no hay turno abierto en el editor, se crea uno
  nuevo con la fecha del día actual y se carga automáticamente.

### Fixed
- Cabecera de HT vuelve a ocultarse correctamente fuera de la pestaña
  Horario (la regla `body:not(.tab-schedule) > header{display:none}`
  no aplicaba porque `<header>` estaba envuelto en `#studio-horario-pane`).
- Scroll restaurado en todas las pestañas.
- Paneles RV (Calendario, Registro, Estadísticas, Ajustes) ahora
  muestran el mismo estilo visual que la app RV original.
- Doble nav corregido (ya no hay barra extra solapando la parte
  superior de HT).

## [0.1.0] — 2026-05-27

### Added
- Fusión inicial HT + RV en PWA Iryo Studio.
- Shell PWA con Service Worker (network-first), manifest, iconos.
- `data.js` construye `window.RV_HORARIOS` desde `<script id="data">`
  embebido (Libro de Horarios HT).
- Cross-feed `iryo:openService` (Registro → Horario) y
  `iryo:marchaApplied` (HT → Registro).
- `window.HTIryo.showService(num)` y `window.REGISTRO.getActiveTurno()`
  expuestos para integración cruzada.
