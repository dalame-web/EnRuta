# HANDOFF — Iryo-Studio

> Documento de transferencia exhaustivo para que un chat de Claude
> Code nuevo pueda retomar el proyecto sin haber visto el chat
> anterior. **Leer ÍNTEGRAMENTE** antes de hacer ningún cambio.

## 0. Lectura mínima obligatoria

1. **Este HANDOFF.md** (resumen + reglas duras).
2. **`HT_HISTORIA.md`** (todo lo de HT, 461 líneas).
3. **`RV_HISTORIA.md`** (todo lo de RV, 8 iteraciones).
4. **`CLAUDE.md`** (instrucciones operativas Claude Code).

Cuando termines la lectura, di al usuario qué entiendes del proyecto
antes de empezar.

---

## 1. Resumen ejecutivo

**Iryo-Studio** es una **PWA unificada** que fusiona dos apps
existentes:

- **HT-Iryo** (Horario Teórico Iryo): consulta de marchas, marcaje
  de paso real por estación, DHLTV, GPS tracking. Repo:
  `github.com/dalame-web/ht-iryo`.
- **RV-Iryo** (Registro Viajes Iryo): registro estructurado de turnos
  con fecha, servicios, paradas, comprobaciones, observaciones. Repo:
  `github.com/dalame-web/RV-Iryo`.

Las dos apps **siguen vivas en paralelo** durante la transición.
Iryo-Studio se desarrolla en local hasta que sea estable. Cuando lo
sea, sustituirá a las dos.

**Repo de Iryo-Studio:** `https://github.com/dalame-web/Iryo-Studio`.
**Carpeta local:** `C:\Users\david\Downloads\Proyectos claude\Iryo Studio`.

**Usuario:** David Alameda (`david.alameda01@gmail.com`), maquinista
de Iryo. Tablet de trabajo: Samsung con S Pen (Android Chrome).

---

## 2. Estructura prevista del repo

```
/Iryo Studio
├── HANDOFF.md              ← este archivo (índice + reglas duras)
├── HT_HISTORIA.md          ← historia técnica completa de HT (461 líneas)
├── RV_HISTORIA.md          ← historia técnica completa de RV (8 iteraciones)
├── CLAUDE.md               ← instrucciones operativas para Claude
├── README.md               ← descripción pública del proyecto
├── .gitignore
│
├── index.html              ← shell PWA: header, nav 5 pestañas, paneles
├── horario.html            ← copia íntegra del index.html de HT (intocable)
├── gps-tracking.js         ← copia íntegra del gps de HT (PROHIBIDO TOCAR)
├── data.js                 ← <script id="data"> de HT (Libro de Horarios)
├── registro.js             ← módulo RV (turnos + calendario + stats)
├── app.js                  ← shell: router, ajustes globales, cross-feed
│
├── manifest.webmanifest
├── sw.js                   ← network-first + controllerchange reload
├── icon-192.png / icon-512.png
└── .claude/launch.json     ← preview server local
```

**Estado actual** (al cerrar este chat):
- ✅ `HT_HISTORIA.md` aportada por David desde el chat de HT.
- ✅ `RV_HISTORIA.md` generada en este chat.
- ✅ `HANDOFF.md` (este archivo) creado.
- ⏳ `CLAUDE.md`, `README.md`, `.gitignore` creados a continuación.
- ⏳ Repo git inicializado y conectado al remote.
- ⏳ Shell PWA (`index.html`, `app.js`, `sw.js`, manifest, iconos):
  pendiente — para el siguiente chat.
- ⏳ Módulos `horario.html`, `data.js`, `gps-tracking.js`, `registro.js`:
  pendiente — para el siguiente chat.

---

## 3. Reglas duras (PROHIBIDO incumplir)

1. **NO TOCAR `gps-tracking.js`**. Se copia íntegro desde HT-Iryo. Ni
   una línea. Si necesitas reaccionar a marcas GPS, hazlo desde fuera
   (escuchando localStorage o un evento custom global).
2. **NO TOCAR `horario.html`** (copia de HT). Si los IDs/clases
   colisionan con el shell, encapsular con prefijo / iframe; **nunca**
   editar el HTML original. Las pestañas ocultas (ADIF, Mapa) se
   conservan en `display:none` como están en HT.
3. **NO REINTRODUCIR el lápiz canvas overlay**. La implementación con
   `pointerType='pen'` capturaba fotos sin sentido. Queda
   explícitamente fuera de scope. El schema mantiene `s.dibujos` por
   compat pero no se renderiza ni se usa.
4. **Libro de Horarios = el de HT**. NO regenerar desde RV. El
   `<script id="data">` de HT tiene `km`, `vmax`, `c`, `tc`,
   `_l010cdi`, etc. Iryo-Studio usa ese, NO el `horarios.js` reducido
   de RV.

---

## 4. Pestañas (nav de Iryo-Studio)

| Orden | Pestaña | Pane | Origen |
|---|---|---|---|
| 1 | Horario | `#horario-pane` | HT-Iryo (`horario.html` inyectado) |
| 2 | Registro | `#registro-pane` | RV-Iryo (editor de turno) |
| 3 | Calendario | `#calendario-pane` | RV-Iryo (vista mes + lista) |
| 4 | Estadísticas | `#estadisticas-pane` | RV-Iryo (rango + métricas) |
| 5 | Ajustes | `#ajustes-pane` | mix HT + RV + Iryo-Studio |

> **Nota:** Registro / Calendario / Estadísticas son tres pestañas
> distintas pero comparten el módulo `registro.js`. Al cambiar de
> pestaña, `registro.js` re-renderiza el contenido apropiado en cada
> pane.

---

## 5. Cross-feed bidireccional

### 5.1 Registro → Horario

En el editor de turno, junto al select del Servicio Comercial,
botón **"Ver en Horario"**. Al pulsarlo:

1. `dispatchEvent(new CustomEvent('iryo:openService', {detail:{num:'6010'}}))`.
2. Shell cambia a pestaña Horario.
3. Llama a la API expuesta por HT (`window.HTIryo.showService(num)`
   o equivalente — depende de cómo expone HT su API).

### 5.2 Horario → Registro (con confirmación) — [C11]

Cuando en HT eliges una marcha y hay un turno activo en Registro:

1. HT dispara evento al cambiar de marcha.
2. Shell detecta turno activo (vía `REGISTRO.getActiveTurno()`).
3. Si el servicio actualmente expandido en el turno ya tiene
   `servicioComercial` distinto al nuevo: `confirm("Hay un servicio
   activo en el turno (6010). ¿Reemplazar por 6053?")`. Si NO →
   nada. Si SÍ → aplica.
4. Si está vacío → aplica directamente sin preguntar.

### 5.3 GPS → retraso automático

Cuando `gps-tracking.js` marca paso por estación:

1. Marca queda en `localStorage['ebula_punches_v2']` (clave de HT).
2. Iryo-Studio escucha cambios en esa clave (vía wrapper externo, no
   tocando GPS).
3. Si hay turno activo con servicio que coincide con la marcha
   marcada, calcula `marca_real - hora_teórica` y aplica como
   retraso a la parada correspondiente del turno.
4. NUNCA se sobreescribe un retraso ya introducido manualmente.

---

## 6. Modelo de datos compartido

Iryo-Studio escribe y lee ambos namespaces de localStorage:

### 6.1 De RV (turnos del maquinista)
- `rviryo_turnos_v1` — array de turnos.
- `rviryo_settings_v1` — preferencias (tema, teléfono, ramas...).
- `rviryo_horarios_v1` — override del libro embebido (no debería
  usarse en Studio).

### 6.2 De HT (marcas y log)
- `ebula_punches_v2` — marcas por estación (clave `grp|num|origen→destino`).
- `ebula_marksrc_v1` — fuente de cada marca (`manual`/`gps`/`est`).
- `ebula_gpslog_v1` — log de eventos GPS por marcha.
- `ebula_v2` — preferencias (idx del tren seleccionado).
- `ebula_pwa_dismissed_v1` — prompt PWA descartado.
- `ebula_auth_v1` (sessionStorage) — sesión PIN.

### 6.3 De Studio (nuevas)
- `iryostudio_settings_v1` — preferencias globales (tema unificado,
  pestaña activa por defecto, etc.).

> **Compatibilidad:** todas las claves de RV y HT se mantienen como
> están. Iryo-Studio no migra, solo lee/escribe sobre las mismas
> claves. Así, si en el futuro David vuelve a abrir RV o HT
> independientemente (en otra URL), los datos siguen ahí intactos.

---

## 7. Almacenamiento e importación legacy — [C12]

Mientras Iryo-Studio esté en desarrollo / no sea único:

- **Ajustes → Importar de RV-Iryo**: file input acepta el JSON
  exportado por RV. Lo escribe en `localStorage` con la clave
  `rviryo_turnos_v1`.
- **Ajustes → Importar de HT-Iryo**: si HT exporta marcas, mismo
  flujo con `ebula_punches_v2` etc.

Cuando Iryo-Studio sea la app única y estable, esta funcionalidad
**se retirará** de Ajustes.

---

## 8. Tecnología

- **Stack**: HTML + JavaScript vanilla (IIFE). Sin frameworks. Sin
  build. Sin npm. Solo `python -m http.server` para servir local.
- **Librerías de terceros (vía CDN)**:
  - Leaflet 1.9.4 (mapa de HT, oculto).
  - pdf.js 3.11.174 (lectura DHLTV de HT).
  - jsPDF 2.5.1 (exportar PDF de RV).
  - Google Fonts Poppins.
- **Service Worker network-first**: descarga fresco con conexión,
  cache fallback offline. `controllerchange` recarga la pestaña al
  detectar versión nueva → la tablet se actualiza sola tras cada
  `git push`.
- **localStorage** como persistencia. `navigator.storage.persist()`
  para evitar evicción del navegador.

---

## 9. Convenciones de código

- **IIFE**: `(function(){ 'use strict'; ... })()`. Variables y
  funciones encapsuladas.
- **Bindings declarativos**: HTML lleva `data-bind="srv.0.via"` y
  `data-action="cerrar"`. Handlers globales delegan a IDs.
- **Autosave** debounce 350ms en RV. `localStorage.setItem` directo.
- **Render completo** tras cada cambio importante (no virtual DOM).
- **Sin TypeScript**, sin tests automatizados. Verificación manual
  vía `preview_start`.

---

## 10. Skills útiles para Claude

- **`/caveman`**: modo conciso. Activar con `/caveman full` en sesiones
  largas para ahorrar contexto.
- **`/cavecrew`**: subagentes ultra-comprimidos para investigar,
  construir o revisar sin gastar contexto del hilo principal.
- **`/grill-me`**: cuando el usuario quiera diseñar algo nuevo.
- **`mcp__Claude_Preview__preview_start`**: arranca el server local
  desde `.claude/launch.json`.

---

## 11. Plan de implementación pendiente

Pasos que **NO se han hecho** en este chat (pendientes para el
siguiente):

1. Crear `index.html` (shell PWA + CSS + 5 paneles).
2. Crear `manifest.webmanifest` + `sw.js` + iconos.
3. Extraer `data.js` (Libro de Horarios) del `<script id="data">` de
   HT — copia íntegra como `window.HT_DATA = {...}`.
4. Copiar `horario.html` desde `index.html` de HT (intocable).
5. Copiar `gps-tracking.js` íntegro de HT.
6. Crear `registro.js` adaptando `rviryo.js` (mínimo refactor: cambiar
   IDs de panes a los del shell).
7. Crear `app.js` (router de pestañas, cross-feed, ajustes globales,
   importar legacy).
8. `.claude/launch.json` para preview local (puerto 8780).
9. Tests manuales: las 5 pestañas, cross-feed, importar RV.
10. Despliegue Netlify: **POSPUESTO** (`[C4]`). Cuando sea estable.

---

## 12. Reglas de UI

- **Theme**: dark por defecto. Light disponible via toggle.
- **Header**: "Iryo Studio" en `#e8201c` (rojo Iryo), subtítulo
  "PWA unificada".
- **Nav tabs**: estilo RV (subrayado rojo en activo).
- **Calendario**: días con turno tinte azul muy suave. Dormida tinte
  más fuerte. Toggle ▦/≡ alterna grid/lista.
- **Editor servicio**: card por estación con badge ORIGEN(verde)/
  PARADA(naranja)/DESTINO(rojo). Mini "+" verde para añadir parada.
- **Retrasos**: input `inputmode="text"` (permite `:`).
  `parseRetraso` acepta `5`/`9:25`/`925`/`0925`/`-2`.

---

## 13. Limitaciones conocidas

- **Lápiz fuera de scope** — [C7]. La implementación con
  `pointerType='pen'` capturaba fotos sin sentido. NO reintroducir.
- **SW cache** puede confundir durante desarrollo. Limpiar con
  DevTools → Application → Storage → Clear all.
- **localStorage 5-10MB** por origen. Suficiente para muchos años.
- **No cross-domain storage**. Migración legacy es manual (JSON
  export/import).
- **Samsung S Pen handwriting transcribe a texto** si está activado
  a nivel sistema. Si interfiere con el textarea de Observaciones,
  David debe desactivarlo en Ajustes Android.
- **Login PIN de HT**: HT tiene un overlay de PIN (no Keycloak — eso
  es otro proyecto distinto). Decidir si se mantiene en Iryo-Studio
  o se quita (HT_HISTORIA.md sección 5.1 lo describe).

---

## 14. Decisiones cerradas

Marcadas con `[C1]–[C13]` en el plan original (ver
`C:\Users\david\.claude\plans\mejoras-1-al-mover-expressive-sparkle.md`,
sección "Plan — Iryo-Studio").

Resumen:
- [C1] Libro de Horarios = el de HT (`data.js`).
- [C2] Cross-feed bidireccional Registro ↔ Horario.
- [C3] NO TOCAR GPS de HT.
- [C4] Netlify pospuesto.
- [C5] Estructura simplificada (pocos archivos).
- [C6] Historia HT (`HT_HISTORIA.md`) aportada.
- [C7] Lápiz fuera.
- [C8] Repo + carpeta ya creados.
- [C9] "Stats" → "Estadísticas".
- [C10] No borrar pestañas ocultas de HT.
- [C11] Cross-feed HT→RV con `confirm()`.
- [C12] Import legacy es temporal.
- [C13] `HT_HISTORIA.md` aportada vía chat externo.

---

## 15. Comandos clave para el próximo chat

```bash
# Servir local
cd "C:\Users\david\Downloads\Proyectos claude\Iryo Studio"
python -m http.server 8780

# Git
git status
git add -A
git commit -m "..."
git push

# Limpiar SW cache (en DevTools del navegador)
caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
```

---

## 16. Contacto / contexto del usuario

- **David Alameda Primo** — `david.alameda01@gmail.com`.
- Maquinista de Iryo (alta velocidad española).
- Tablet de trabajo: Samsung Android con S Pen.
- OS: Windows 11. Shell: PowerShell + bash via WSL.
- Carpeta padre proyectos: `C:\Users\david\Downloads\Proyectos claude\`.
- Prefiere modo `/caveman full` en sesiones largas.
- Trabaja en español.

---

> FIN del HANDOFF. Si has llegado hasta aquí, ya tienes el contexto
> suficiente. Sigue con `HT_HISTORIA.md` y `RV_HISTORIA.md` antes de
> tocar nada.
