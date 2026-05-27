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

## Cross-feed entre módulos

Comunicación por **eventos custom globales** (no acoplamiento directo
entre `horario` y `registro`):

```js
// Disparar
window.dispatchEvent(new CustomEvent('iryo:openService', {
  detail: { num: '6010' }
}));

// Escuchar (en app.js)
window.addEventListener('iryo:openService', function(e) {
  // cambiar a pestaña Horario + cargar servicio
});
```

Eventos definidos en HANDOFF.md sección 5.

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
- Usar `/grill-me` para hacer 1-4 preguntas concretas con
  `AskUserQuestion` antes de tocar nada.

Si es claro:
- Hacer el cambio mínimo.
- Comprobar sintaxis.
- Commit + push.

Si abarca más de 3 puntos / supone refactor amplio:
- **Plan mode primero**: escribe plan en
  `C:\Users\david\.claude\plans\<nombre>.md`, lista
  decisiones cerradas, pasos, verificación. ExitPlanMode para
  aprobar.

## Skills útiles

| Skill | Cuándo |
|---|---|
| `/caveman full` | Sesiones largas → ahorra tokens. Activar al inicio. |
| `/cavecrew` | Investigar / construir / revisar sin gastar contexto del hilo. |
| `/grill-me` | Diseñar algo nuevo o ambiguo. |
| `mcp__Claude_Preview__*` | Servir local + screenshot. |

## TODO al iniciar el siguiente chat (pendiente de hacer)

1. Crear shell PWA: `index.html`, `manifest.webmanifest`, `sw.js`,
   iconos.
2. Extraer `data.js` desde HT (`<script id="data">`).
3. Copiar `horario.html` y `gps-tracking.js` íntegros desde HT.
4. Adaptar `rviryo.js` → `registro.js` (cambiar referencias de IDs
   `cal-pane` → `calendario-pane`, etc.).
5. Crear `app.js` con router de pestañas + cross-feed + importar
   legacy en Ajustes.
6. `.claude/launch.json` para `preview_start iryo-studio` (puerto
   8780).
7. Prueba E2E: 5 pestañas funcionan, cross-feed básico,
   importar JSON de RV funciona.

## Información del usuario

- **David Alameda** — `david.alameda01@gmail.com`. Maquinista Iryo.
- Tablet Samsung Android con S Pen.
- Windows 11, PowerShell + bash via WSL.
- Trabaja en español.
- Prefiere modo `/caveman full` cuando la sesión se alarga.

---

> FIN. Ahora ya puedes empezar — pero primero, lee
> `HT_HISTORIA.md` y `RV_HISTORIA.md` íntegros.
