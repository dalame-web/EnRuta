# Changelog

Todos los cambios notables a este proyecto se documentan en este
archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y este proyecto sigue [SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Added
- Botón `📅 Calendario` en la pantalla de Inicio junto a `Ver horario` y `DHLTV`.
- Cross-feed completo HT → Registro: al cambiar de servicio en Horario se copian
  número de servicio, origen, destino, horas teóricas y todas las paradas intermedias
  con sus horas al turno activo en Registro.
- Aviso condicional en cross-feed HT → Registro: solo muestra `confirm()` si el
  servicio del turno aún no ha llegado a destino (`hDestino` > hora actual). Si el
  servicio ya terminó, el cambio se aplica directamente sin aviso.
- `window.REGISTRO.refreshEditor()` expuesto para re-renderizar el editor tras
  aplicar datos externos.
- Sub-nav `Calendario / Estadísticas / Ajustes` ahora también visible en la pestaña
  `Registro` (con `Calendario` activo en el sub-nav).
- Icono `⚠` junto al nombre de la estación en el editor de Registro cuando un PMR
  tiene indicado que baja en esa parada.

### Changed
- Refactor del nav: eliminado `#studio-nav`. Se reutiliza el nav nativo
  de HT añadiendo tabs `Registro` y `Calendario`.
- Sub-nav `Estadísticas` / `Ajustes` aparece como barra debajo del nav
  principal solo cuando la sección Calendario o Registro está activa.
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
- Botones de Ajustes (`button.btn`) con el estilo correcto del original RV
  (`border-radius:8px`, `padding:11px 16px`, colores primario/danger/ghost).

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
