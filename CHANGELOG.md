# Changelog

Todos los cambios notables a este proyecto se documentan en este
archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y este proyecto sigue [SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Added
- HT detecta el tramo activo de transversales (servicios con Atocha
  intermedia, ej. 6014 Barcelona→Sevilla). Cuando lo detecta como
  tramo 2 (Atocha→destino), oculta las paradas previas a Atocha y
  muestra la cabecera con origen=Atocha. **Detección por prioridad:**
  1. Punches (GPS o manual) post-Atocha → tramo 2 confirmado.
  2. Punches pre-Atocha → tramo 1 (vista completa).
  3. Sin punches: por hora actual. Si `nowMin >= salida desde Atocha − 60min`
     → tramo 2 (tolerancia amplia, el maquinista puede llegar hasta 1h antes).
- `HTIryo.getActiveLegInfo()` devuelve `{origen, destino, hSalida, hDestino}`
  del tramo activo, o `null` si recorrido completo. Usado por el cross-feed.

### Changed
- Cross-feed HT→Registro (`applyMarchToSvc`): en lugar de aplicar el
  primer tramo a ciegas con `.find()`, ahora respeta orden de prioridad:
  1. Si Registro ya tiene `svc.origen` → matchear ese tramo.
  2. Si HT detecta tramo activo (`getActiveLegInfo`) → usar ese.
  3. Si nada apunta a un tramo concreto en un transversal split, no
     inventa nada: deja `origen/destino/paradas` vacíos y el maquinista
     elige en el `<select>` del editor (que ya lista ambos por separado).

### Fixed
- Calendario con celdas verticales (33×92px) en vez de horizontales:
  el `#calendario-pane` se colapsaba a ~290px en vez de respetar
  `max-width:880px`. Causa: el pane es flex item de `body` (flex
  column) con `display:block` + `flex-basis:0`, lo que hacía que
  Chrome computase el ancho como `min-content` del grid interior.
  Fix: añadir `width:100%` al pane RV para que el ancho final sea
  `min(100%, 880px)`. Aplica a registro/calendario/estadísticas/ajustes.
- Salir del editor de Registro vía cualquier ruta (no solo "volver")
  ahora descarta el turno blank. Antes el flujo "click día →
  editor → sub-nav Calendario" dejaba el blank en `turnos[]` porque
  `setView` no llamaba a `discardEmptyEdit`. Ahora `setView` detecta
  cuando se sale de `'registro'` y lo descarta.
- Scroll del editor al abrir un turno: el scroll real está en
  `#registro-pane` (`.pane { overflow:auto }`), no en `window`.
  Resetear `pane.scrollTop = 0` además de `window.scrollTo`.

### Fixed
- Turno blank ya no ensucia el calendario: `discardEmptyEdit` se llama
  automáticamente al salir del tab Registro (antes solo se ejecutaba
  desde el botón "volver" del editor RV original, que no existe en
  Iryo Studio). Expuesto en `window.REGISTRO.discardEmptyEdit`.
- Defensa adicional en `renderCalendar`: filtra `turnosOfDay()` para
  ignorar turnos completamente vacíos antes de aplicar la clase
  `has-turno` o renderizar el badge "En curso". Eso evita que un
  turno blank residual estire la altura de la celda (vía
  `margin-top:auto` del `.estado`) y rompa el layout del grid.
- Scroll arriba al entrar al editor: estrategia multi-paso
  (`window.scrollTo` + `documentElement.scrollTop` + 2 niveles de
  `requestAnimationFrame`) para garantizar el scroll incluso si el
  browser restaura la posición previa del pane tras el cambio de
  `.active`. También `scrollTo(0,0)` en `onTabChange('registro')`.

### Added
- Icono PWA `icon.svg` con branding "IS" (rojo iryo, fondo redondeado).
  Referenciado primero en `manifest.webmanifest` y como favicon SVG en
  `index.html`. Los PNG quedan como fallback.

### Changed
- Pantalla Inicio: título "HT Iryo" → "Iryo Studio".
- Estadísticas: grid responsive — 2×2 en móvil, 4×1 en tablet/desktop
  (antes `auto-fit minmax(150px)` caía a una sola columna en pantallas
  estrechas).
- Botón `Reset punteo` en Horario: alineado verticalmente con el
  selector de tren y el botón GPS (`align-self:center`).

### Fixed
- Calendario: re-render adicional en el siguiente `requestAnimationFrame`
  al activar el tab. Soluciona el bug intermitente donde la primera
  vista del calendario (tras desbloquear PIN) salía mal calculada
  porque el pane estaba `display:none` cuando se midió el grid.
- Registro: al entrar al tab sin tocar nada, el turno blank ya NO se
  persiste en localStorage. Solo se guarda cuando el usuario añade
  algún dato (autosave). `discardEmptyEdit` lo limpia al salir si
  sigue vacío.
- Registro: scroll va arriba tras abrir el editor (antes podía quedar
  al final tapando la cabecera del turno).

### Added
- Opción `—` al inicio del selector de tren en Horario para arranque limpio.
  Por defecto la app abre sin servicio seleccionado: no inicia tracking GPS
  ni aplica cross-feed a Registro (turno con plantilla vacía).
- Confirm al cambiar el `<select>` Servicio Comercial en el editor de Registro
  cuando el servicio actual está en trayecto (`hDestino` futuro). Evita
  cambios involuntarios. Si se cancela, el select vuelve al servicio anterior.

### Fixed
- Icono ⚠ PMR ahora aparece **junto al nombre de la parada** (no junto a
  los botones +/🗑) y es más grande (font-size 18px, peso 700).

### Added
- Cross-feed Registro → Horario: al seleccionar un servicio en el editor de Registro
  (select Servicio Comercial), el tren activo en Horario se sincroniza al mismo
  servicio sin cambiar de pestaña. `HTIryo.showService(num, noNav)` admite ahora
  un segundo argumento para omitir el `switchTab`.
- Cross-feed retrasos Horario → Registro: cuando HT marca un paso por una parada
  (vía GPS o manual) o aplica un retraso provisional, los retrasos calculados
  (parada por parada) se aplican automáticamente al turno activo de Registro.
  Nueva API: `HTIryo.getStopDelays()` + evento `iryo:htDelaysChanged`.

### Fixed
- PMR ⚠: el icono no aparecía al seleccionar la parada de bajada porque
  `applyBind` no re-renderizaba. Ahora, cuando cambia `pmr.baja`, se llama
  a `refreshServicioCard(si)` para repintar la card con el ⚠ aplicado.
- Variable CSS `--iryo` no estaba definida en Iryo Studio → botones `primary` se veían grises. Añadida `--iryo:#e8201c` en `:root` y `body.light`.
- Cross-feed HT→Registro no actuaba si no había turno activo al cambiar de tab. Añadido `getOrCreateActiveTurno()` que crea turno si no existe.
- Cross-feed HT→Registro no se disparaba al entrar en Registro con tren ya cargado. Añadida `syncMarchaToRegistro()` que aplica la marcha al entrar en el tab si el turno está vacío.
- Comparación de nombres de paradas en iconos PMR mejorada con `normName()` para ignorar diferencias de guiones y espacios.

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
