# Changelog

Todos los cambios notables a este proyecto se documentan en este
archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y este proyecto sigue [SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Fixed
- **Pérdida de turnos al actualizar la app** (`ebulaClearAllData`): `localStorage.clear()` reemplazado
  por borrado selectivo con allowlist. Se preservan `rviryo_turnos_v1`, `rviryo_settings_v1`,
  `ebula_auth_v1`, `ebula_theme`, `ebula_overlay_collapsed` e `iryostudio_active_tab`.
  Las claves efímeras de HT (punches, marcas, ADIF, DHLTV) siguen borrándose al cerrar.
  Elimina el riesgo de pérdida de datos en cada actualización de SW.

### Removed
- **Lápiz S-Pen / canvas overlay en Observaciones** (`registro.js`): eliminados pen-draw handler,
  render de canvas y miniaturas de dibujos. Cumple la regla #3 de CLAUDE.md. El campo `dibujos`
  permanece en el schema por compatibilidad con datos existentes.
- **`parseLTVText()`** (`index.html`): parser de LTV por texto plano sin llamadores (~60 líneas).
  Solo se usa `parseLTVPdf`.
- **`findLTVsForStop()`** (`index.html`): función huérfana (~5 líneas). La inyección LTV usa
  filtro inline.
- **`paradasHtml()` + `refreshParadas()`** (`registro.js`): ~34 líneas de código muerto.
  `refreshParadas` buscaba un ID (`paradas-N`) que ya no existe en el DOM.
- **`K_HORARIOS` legacy** (`registro.js`): constante y limpieza de migración ya consumida (~3 líneas).
- **CSS canvas/dibujos** (`index.html`): `.obs-canvas`, `.obs-wrapper.pen-active`, `.dibujos-list`,
  `.dibujo-thumb` eliminados.

### Removed
- **Ajustes → "Libro de Horarios"**: se elimina la tarjeta con los botones
  "Actualizar (archivo .json)" y "Restaurar original". En la app unificada el
  libro se genera siempre desde el Horario (`window.RV_HORARIOS`); cargar un
  `.json` propio solo descoordinaba Registro y Horario. `loadHorarios()` ahora
  descarta cualquier libro propio guardado en versiones anteriores.

### Changed
- **Orden de pestañas**: Registro pasa a estar justo después de Horario
  (antes estaba tras Mapa). Calendario se mantiene al final.
- **Actualización sin reinicio**: cuando hay versión nueva, aparece un aviso
  verde discreto abajo ("Nueva versión disponible — Actualizar") en vez de
  obligar a cerrar y reabrir la app. Al pulsar Actualizar, el nuevo Service
  Worker toma el control y la app recarga una sola vez. Se comprueba si hay
  versión nueva al volver a la app. (`sw.js`: el SW nuevo espera en vez de
  activarse solo; el cliente lo activa con `SKIP_WAITING`.)

### Added (unificación HT → Studio — iryostudio-v2)
- **Sistema estable de marcas (HOR-001)**: las marcas de paso se guardan ahora
  por nombre de estación + km en vez de por número de fila. Las marcas sobreviven
  a actualizaciones del horario y se migran automáticamente.
- **Popup de confirmación propio** (`appModal`): sustituye al cuadro feo del
  navegador en "Borrar punteo", "Cambiar de tren" y "Eliminar limitaciones DHLTV".
- **Pestaña CRC**: tabla de teléfonos GSM-R por línea y trayecto (L010, L030,
  L040, L042, L050).
- **Botón ⏱ Seguimiento ON/OFF**: permite activar/desactivar el resaltado de
  posición actual en el cuadro de marcha, con estado persistido.
- **Estado de la Red** (pestaña ADIF): avisos de circulación de ADIF filtrados
  para alta velocidad; caché offline; popup si hay avisos nuevos.
- **Popup "servicio anterior en curso"**: al reabrir la app con marcas guardadas
  pregunta si continuar o empezar de nuevo; si continúa, reanuda el GPS.
- **Confirmación al cambiar de tren**: si hay marcas guardadas, pregunta antes
  de borrarlas junto con el log GPS del servicio.
- **Paradas mixtas** (comercial + técnica): celda "5+2" con gradiente verde→naranja.
- **Versión en pantalla de inicio**: muestra `ebula-v82 | iryostudio-v2 | loc.-V17`.
- `app-logger.js` portado de HT (registro de eventos + webhook Make.com).
- `gps-tracking.js` actualizado a la versión de HT con todas las mejoras GPS.
- `horario.html` actualizado a la versión actual de HT.


### Fixed (seguimiento GPS — auditoría exhaustiva)
- **G1 (crítico)**: `autoMark` ya no llama `estimateMark` cuando el GPS
  reporta parada saltada. Las marcas confirmadas por GPS se hacen **siempre
  con hora real** y `source:'gps'`. Antes: 1 de cada N marcas era real, las
  demás se rellenaban con hora teórica (a veces 2-3h obsoleta).
- **G2 (crítico)**: `pollTick` procesa **todas las paradas confirmadas por
  GPS en un solo tick** (loop hasta `passedOrigIdx`). Antes: 1 parada cada
  30s, un AVE Madrid-Sevilla tardaba ~47 min en cascadear todas las paradas.
  Ahora en milisegundos.
- **G3 (grave)**: `HTIryo.showService(num, true)` ahora dispara
  `_dispatchMarchaChange` cuando cambia el tren → `gps-tracking.js` para el
  tracking automáticamente. Antes el tracking seguía activo con el march
  viejo, marcando paradas equivocadas.
- **G4**: `provisionalDelay=0` ya no sobrescribe un adelanto calculado. El
  delta visible muestra correctamente "−2:00 adelanto" cuando corresponde.
- **G5**: filtro de precisión GPS. Posiciones con `accuracy > 200m` (típico
  de cellular fallback) son descartadas; subline muestra "GPS impreciso
  (Xm) — esperando mejor señal". Antes se aceptaban lecturas de 1-2 km.

### Added (diagnóstico GPS)
- **Diferenciación visual de marcas** en la tabla de Horario:
  - `📡 HH:MM` (verde): marca confirmada por GPS.
  - `✋ HH:MM` (azul): marca manual del maquinista.
  - `~ HH:MM` (cursiva): estimada (sin señal GPS, calculada de teórica + delta).
  Antes manual y GPS eran indistinguibles visualmente.
- **Mensajes específicos de error GPS** en el subline. El maquinista sabe
  el motivo real del fallo:
  - `⚠ Permiso de ubicación denegado — revisa ajustes del navegador` (code 1).
  - `⚠ GPS no disponible — activa la ubicación o sal del túnel` (code 2).
  - `⏱ GPS lento (>10s) — débil cobertura` (code 3).
- **Detección proactiva de permisos al arrancar**:
  `HTIryo.checkGpsPermission()` usa `navigator.permissions.query`. Al cargar
  la app, el subline muestra el estado del permiso (`📍 Permiso GPS OK`,
  `⚠ Permiso GPS denegado`, `📍 GPS sin permiso aún`) antes de iniciar
  tracking. Reactivo a cambios del usuario en ajustes del navegador.

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
