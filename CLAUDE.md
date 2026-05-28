# CLAUDE.md — Instrucciones operativas Claude Code (Iryo-Studio)

> **PRIMER PASO OBLIGATORIO**: leer `HANDOFF.md`, `HT_HISTORIA.md` y
> `RV_HISTORIA.md` ANTES de hacer cualquier cambio. No empieces a
> codificar sin ese contexto.

---

## Reglas duras (PROHIBIDO incumplir)

1. **NO TOCAR `gps-tracking.js`.** Es copia íntegra de HT-Iryo. Ni
   una línea. Si necesitas reaccionar al GPS, hazlo desde fuera
   (escuchando `localStorage` o eventos custom).
2. **NO TOCAR `horario.html`.** Copia del `index.html` de HT. Si los
   IDs colisionan con el shell, encapsular con iframe; NUNCA editar
   el HTML original. Las pestañas ocultas (ADIF, Mapa) se conservan
   tal cual.
3. **NO REINTRODUCIR el lápiz canvas overlay** (`pointerType='pen'`
   con `s.dibujos`). Está fuera de scope porque la implementación
   capturaba fotos sin sentido en la tablet. El schema mantiene
   `s.dibujos` por compat pero NO se renderiza.
4. **Libro de Horarios = `data.js`** (extraído del `<script id="data">`
   de HT, con `km`/`vmax`/`c`/`tc`/`_l010cdi`). NO regenerar nada
   desde RV. NO usar el `horarios.js` reducido de RV.
5. **NO renombrar claves de localStorage de RV o HT**: `rviryo_*`,
   `ebula_*`. Iryo-Studio escribe sobre ellas. Renombrar rompe la
   migración y el fallback al uso individual de RV/HT en paralelo.

## Stack técnico

- **HTML + JavaScript vanilla (IIFE)**. Sin frameworks. Sin build.
  Sin npm. Sin TypeScript.
- **Service Worker** network-first + `controllerchange` reload.
- **localStorage** como persistencia. `navigator.storage.persist()`.
- **Librerías de terceros vía CDN** (Leaflet, pdf.js, jsPDF, Google
  Fonts). NO instalar nada local.

## Estructura del repo

```
HANDOFF.md          ← contexto general
HT_HISTORIA.md      ← historia HT
RV_HISTORIA.md      ← historia RV
CLAUDE.md           ← este archivo
README.md           ← descripción pública
.gitignore

index.html          ← shell PWA + CSS + 5 paneles
horario.html        ← copia HT (NO TOCAR)
gps-tracking.js     ← copia HT (NO TOCAR)
data.js             ← Libro de Horarios HT (window.HT_DATA)
registro.js         ← módulo RV adaptado
app.js              ← shell: router, ajustes, cross-feed

manifest.webmanifest
sw.js
icon-192.png / icon-512.png
.claude/launch.json
```

## Cómo desarrollar

### Servir local
```bash
cd "C:\Users\david\Downloads\Proyectos claude\Iryo Studio"
python -m http.server 8780
```

O bien `preview_start iryo-studio` si está configurado en
`.claude/launch.json`.

### Limpiar Service Worker / cache durante desarrollo
En DevTools del navegador:
```js
caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
```
Luego `location.reload()`.

### Comprobar sintaxis JS sin servir
```bash
node -e "new Function(require('fs').readFileSync('app.js','utf8'))"
```

### Commit & push
```bash
git status
git add -A
git commit -m "Mensaje claro y conciso"
git push
```

El remote ya está conectado a `https://github.com/dalame-web/Iryo-Studio.git`.

## Convenciones de código

- **IIFE**: `(function(){ 'use strict'; ... })()`. Variables y
  funciones encapsuladas dentro de cada módulo (`app.js`,
  `registro.js`).
- **Bindings declarativos**: `data-bind="srv.0.via"`,
  `data-action="cerrar"`. Handlers globales delegan a `data-action`.
- **Render completo** tras cada cambio en RV (no virtual DOM).
- **Autosave** 350ms debounce con `setTimeout`.
- **No flash "Guardado" en cada autosave** — solo en momentos clave
  (cerrar turno, exportar, etc.). Ver iteración 7 de RV.
- **CSS variables** para tema dark/light (`--bg`, `--panel`,
  `--accent`, `--iryo #e8201c`).
- **Service Worker network-first**: descarga fresco con conexión,
  cache fallback offline.

## Arquitectura — nav unificado HT + panes RV

- **Sin nav propio de Studio.** Reutilizamos el nav nativo de HT
  (`<div class="tabs">`) añadiendo dos botones `Registro` y
  `Calendario`. HT's `switchTab(name)` solo toca `body.tab-X` y
  `.pane.active` — no valida nombres, así que acepta los nuevos.
- **Panes RV** (`#registro-pane`, `#calendario-pane`,
  `#estadisticas-pane`, `#ajustes-pane`) son hijos directos de
  `<body>`, hermanos de los panes HT. Se muestran solo con `.active`.
- **MutationObserver en `app.js`** observa `body.className`. Cuando
  HT cambia `body.tab-X`, dispara `onTabChange(name)` → llama a
  `window.REGISTRO.switchTo(name)` y `syncSubnav(name)`.
- **Capture listener** sobre `.tab[data-tab]` clicks limpia las
  EXTRA_TABS (las 4 de RV) antes de que HT procese el click —
  evita que body acumule múltiples `tab-X`.
- **Sub-nav `#cal-subnav`** (Calendario / Estadísticas / Ajustes) es
  visible solo cuando `body` tiene `tab-calendario`, `tab-registro`,
  `tab-estadisticas` o `tab-ajustes`. CSS puro.
- **Login PIN** (`body.locked`) oculta todo menos `#login-overlay`.

## APIs de cross-feed entre módulos

Comunicación vía **eventos custom globales** (sin acoplamiento
directo). Estos son los contratos estables — no romper sin avisar.

### Eventos

| Evento | Payload | Origen → destino |
|---|---|---|
| `iryo:openService` | `{ num }` | Registro/externo → app.js cambia a Horario + `HTIryo.showService(num)` |
| `iryo:registroServiceChanged` | `{ num }` | `registro.js autofillServicio` → app.js sincroniza HT sin cambiar tab |
| `iryo:marchaApplied` | march | app.js tras aplicar marcha HT al turno activo |
| `iryo:htDelaysChanged` | (vacío) | HT `setMark` / `setProvisionalDelay` → app.js aplica retrasos al turno |
| `iryo:setView` | `{ view }` | RV `setView` (no usado para nav — solo señal interna) |

### `window.HTIryo` (definido en `index.html` IIFE)

- `getMarch()` → `march` actual o `null` si "— Sin servicio —".
- `showService(num, noNav)` — busca y carga servicio. `noNav=true`
  para sincronizar sin cambiar de pestaña.
- `getStopDelays()` → `{ rSalida, rLlegDestino, paradas: {nombre: {rLleg,rSal}} }`
  con retrasos calculados de paradas comerciales.
- `getMark(idx)` / `setMark(idx, hhmm, source)` — punches por parada.
- `setProvisionalDelay(min)` — retraso global desde GPS.
- `onMarchaChange(cb)` / `_dispatchMarchaChange()` — pub/sub interno.

### `window.REGISTRO` (definido en `registro.js` IIFE)

- `getActiveTurno()` → turno con `estado === 'en_curso'` o null.
- `getOrCreateActiveTurno()` → idem, pero crea uno con fecha de hoy
  si no existe (usado por cross-feed desde HT para no fallar).
- `setView(v)` / `switchTo(v)` — `v ∈ {calendario, registro, estadisticas, ajustes}`.
  `switchTo` renderiza y activa; `setView` solo activa.
- `refreshEditor()` — re-renderiza si `editId != null`.

## Estados críticos del modelo

- **`march = null`** en HT cuando `curIdx = -1` (opción "—" del
  selector). Todas las funciones HT que usan `march.X` requieren
  guard. Punto de entrada: `tickKey()` devuelve `'_NONE_'`,
  `renderHeader/Rows/updatePosition` salen temprano.
- **`s.servicioComercial === ''`** = servicio sin asignar. Es la
  señal para que `syncMarchaToRegistro` aplique la marcha activa
  sin pedir confirmación.
- **`s.hDestino < now`** = servicio terminado. Cross-feed HT→Registro
  no pide confirm. `s.hDestino > now` + servicio asignado = confirm
  obligatorio antes de reemplazar (lógica replicada en `app.js
  onMarchaChange` y en `registro.js onChange` del select Servicio).

## Cuando el usuario reporte un bug

1. Reproducir en `preview_start`.
2. Limpiar SW + cache (cache HTTP del navegador puede confundir).
3. Verificar en consola del navegador.
4. Fix con el mínimo cambio posible.
5. **Sintaxis check** con `node -e "new Function(...)"` antes de
   commit.
6. Commit + push. La tablet se actualiza sola al abrir la app
   (network-first SW).

## Cuando el usuario pida un cambio

Si es complejo o tiene varias interpretaciones posibles:
- Usar `/grill-me` con 1-4 preguntas concretas vía `AskUserQuestion`
  antes de tocar código.

Si es claro:
- Hacer el cambio mínimo.
- Sintaxis check.
- Bump `?v=` en `index.html` si tocaste `app.js` o `registro.js`.
- Actualizar `CHANGELOG.md` sección `[Unreleased]`.
- Commit + push (formato Conventional Commits + Co-Authored-By).

Si abarca más de 3 puntos / supone refactor amplio:
- **Plan mode primero**: escribe plan en
  `C:\Users\david\.claude\plans\<nombre>.md`, lista decisiones
  cerradas, pasos, verificación E2E. `ExitPlanMode` para aprobar.
- El usuario espera ver el plan antes de ejecutar refactors.

### Patrones específicos del usuario

- **Reporta varios bugs en bloque numerado** ("Mejoras: 1. ... 2. ...").
  Atacar todos en una ronda salvo que pida lo contrario.
- **Diferencia "preview de Claude Code" vs "Chrome real"**: a veces
  los fallos son del preview, no del código. Si reporta "RV no carga"
  o "todo está roto", preguntar primero si lo probó en Chrome directo.
- **Idioma**: SIEMPRE español de España. Nunca cambiar a inglés, ni
  siquiera tras compactación de contexto. Memoria persistente en
  `~/.claude/projects/.../memory/feedback_idioma_espanol.md`.

## Skills útiles

| Skill | Cuándo |
|---|---|
| `/caveman full` | Sesiones largas → ahorra tokens. Activar al inicio. |
| `/cavecrew` | Investigar / construir / revisar sin gastar contexto del hilo. |
| `/grill-me` | Diseñar algo nuevo o ambiguo. |
| `mcp__Claude_Preview__*` | Servir local + screenshot. |

## Cache busting tras cambiar JS

Cada edición a `app.js` o `registro.js` debe acompañarse de un bump
del query string en los `<script>` de `index.html`:

```html
<script src="registro.js?v=YYYYMMDDHHMM"></script>
<script src="app.js?v=YYYYMMDDHHMM"></script>
```

El Service Worker es network-first, así que sirve la versión fresca,
pero el navegador puede cachear por URL. El bump fuerza la descarga.
Mantener `CHANGELOG.md` (Keep a Changelog) en cada commit que toque
comportamiento visible.

## Información del usuario

- **David Alameda** — `david.alameda01@gmail.com`. Maquinista Iryo.
- Tablet Samsung Android con S Pen.
- Windows 11, PowerShell + bash via WSL.
- Trabaja en español.
- Prefiere modo `/caveman full` cuando la sesión se alarga.

---

> FIN. Ahora ya puedes empezar — pero primero, lee
> `HT_HISTORIA.md` y `RV_HISTORIA.md` íntegros.
