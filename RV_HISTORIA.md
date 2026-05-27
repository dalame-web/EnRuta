# RV-Iryo — Historia técnica completa

> Export exhaustivo para integrar RV-Iryo como módulo en **Iryo-Studio**
> (PWA unificada que fusionará HT + RV). Cubre 8 iteraciones de
> desarrollo desde el diseño inicial hasta la versión actual.
> Repo origen: `https://github.com/dalame-web/RV-Iryo`.

---

## 1. Resumen ejecutivo

**Qué es:** PWA para que David (maquinista de Iryo) registre cada turno
de trabajo. Sustituye una ficha que llevaba a mano en la app Notes de
la tablet.

**Para quién:** maquinistas de Iryo. Cada turno = jornada laboral con
1 o 2 servicios (un servicio = un viaje en tren concreto, p. ej. el
6010 BCN→Atocha).

**Tecnología:** HTML + JavaScript vanilla (IIFE) en pocos archivos.
Sin frameworks. PWA con Service Worker network-first.

**Estado actual:** desplegado en Netlify, instalado en la tablet de
David como PWA. 8 iteraciones de mejoras tras pruebas en producción.

**Repos asociados:**
- `github.com/dalame-web/RV-Iryo` — versión actual desplegada.

**Carpeta local:** `C:\Users\david\Downloads\Proyectos claude\Registro viajes Iryo\`.

---

## 2. Arquitectura

```
Registro viajes Iryo/
├── index.html              shell PWA + CSS inline
├── rviryo.js               toda la lógica (~1300 líneas)
├── horarios.js             Libro de Horarios (window.RV_HORARIOS, 102 tramos)
├── horarios.json           mismo dato como .json (para "Actualizar" desde Ajustes)
├── _build_horarios.py      genera horarios.{js,json} desde HT
├── sw.js                   service worker network-first (rviryo-v3)
├── manifest.webmanifest    PWA standalone, theme rojo Iryo
├── icon-192.png / icon-512.png
└── .claude/launch.json     preview server (puerto 8770)
```

- **`rviryo.js`** — IIFE con todo: modelo de datos, render del
  calendario, vista lista, editor de turno (acordeón), exportación
  PDF (jsPDF vía CDN), exportación HTML legible, autosave a
  localStorage.
- **`horarios.js`** — `window.RV_HORARIOS = [Leg, ...]` con 102 tramos
  comerciales partidos al pasar por Madrid-Atocha (cambio de
  maquinista). Cada tramo: `{servicio, origen, destino, hSalida,
  hDestino, paradas:[{nombre, hora, tParada}]}`. Generado desde el
  `<script id="data">` de HT.
- **`_build_horarios.py`** — script de utilidad: lee
  `Proyecto david iryo/index.html` (HT), extrae las marchas, parte en
  Atocha, escribe `horarios.{js,json}`.

> **En Iryo-Studio:** este archivo deja de existir. Iryo-Studio usa
> directamente el `<script id="data">` de HT (más completo), sin
> regenerar nada.

---

## 3. Pestañas (nav)

| Pestaña | Pane | Función |
|---|---|---|
| Calendario | `#cal-pane` | Vista mensual + vista lista del histórico de turnos. Toggle ▦/≡ alterna. |
| Estadísticas | `#stats-pane` | Turnos, servicios, horas y retraso acumulado en un rango de fechas. |
| Ajustes | `#settings-pane` | Apariencia, teléfono, ramas, Libro de Horarios, almacenamiento, exportar PDF (multi-select), copia, aplicación (actualizar), borrar todo. |

**Pane "Editor"** (`#editor-pane`) no tiene pestaña — se abre al pulsar
un día del calendario o una fila de la lista.

---

## 4. Modelo de datos

`localStorage['rviryo_turnos_v1']` = `[Turno, ...]`.

### 4.1 Turno

```jsonc
{
  "id": "abc123",
  "estado": "en_curso" | "cerrado",
  "horaLTV": "",          // DEPRECATED — migrado a servicio[0].horaLTV en v7
  "servicios": [Servicio, ...]
}
```

### 4.2 Servicio

```jsonc
{
  "fecha": "2026-05-21",
  "servicioComercial": "6010",
  "origen": "BARCELONA-SANTS",
  "destino": "MADRID-P.ATOCHA-ALMUDENA GRANDES",
  "via": "4",
  "rama": "12",
  "hSalida": "09:20",
  "hDestino": "13:05",
  "rSalida": "5",          // retraso al salir (min, string)
  "rLlegDestino": "+3",    // retraso al destino (min, string)
  "horaLTV": "10:00",      // hora del DHLTV vigente
  "paradas": [Parada, ...],
  "n1": "Pedro",
  "viajeros": "250",       // en origen
  "asistencias": "5",
  "plazasH": "",           // DEPRECATED — reemplazado por pmr.length
  "pmr": [{"baja": "ZARAGOZA-DELICIAS"}, {"baja": "MADRID-P.ATOCHA"}],
  "comprobaciones": [true, false, ...],  // array 13 booleans
  "observaciones": "Sin incidencias",
  "dibujos": []            // DEPRECATED — lápiz canvas fuera de scope
}
```

### 4.3 Parada

```jsonc
{
  "nombre": "ZARAGOZA-DELICIAS",
  "hora": "10:49",         // hora de SALIDA (paso por señal de salida)
  "tParada": 1,            // min de parada comercial (del libro)
  "rLleg": "+3",           // retraso a la llegada (min)
  "rSal": "+2",            // retraso a la salida (min)
  "viajeros": "120",
  "asistencias": "1",
  "pmr": [{"baja": "MADRID-P.ATOCHA"}]
}
```

H. Llegada se **calcula**: `hora - tParada` (no se almacena).

### 4.4 Settings

`localStorage['rviryo_settings_v1']`:

```jsonc
{
  "theme": "dark" | "light",
  "telefono": "651 450 000",
  "ramas": ["01", "02", ..., "23"],
  "calView": "grid" | "list",
  "autoDownload": false,
  "lastBackup": "2026-05-26"
}
```

### 4.5 Constantes

- `K_TURNOS = 'rviryo_turnos_v1'`.
- `K_SETTINGS = 'rviryo_settings_v1'`.
- `K_HORARIOS = 'rviryo_horarios_v1'` (override del libro embebido).
- `APP_VERSION = 'rviryo-v3'`.
- `COMPROBACIONES = [13 strings]` (Arranque rama, Estado Pantógrafo, …).
- `DEFAULT_RAMAS = ['01'..'23']`.

### 4.6 Migración (`normTurno`)

Aplicada al cargar cada turno. Garantiza compat con datos antiguos:
- `t.horaLTV` → `s[0].horaLTV` (v7).
- `s.plazasH` numérico → `s.pmr = [{baja:''}, ...]` (v7).
- `s.paradas[i].pmr` faltante → `[]` (v8).
- `s.rSalida` faltante → `''` (v7).
- `s.dibujos` faltante → `[]` (compat; no se usa).
- `p.tParada` faltante → `0`.
- `p.viajeros / p.asistencias` faltantes → `''`.

---

## 5. Funcionalidades clave por iteración

### Iteración 1 — Esqueleto (creación inicial)

- PWA básica: shell, manifest, SW.
- Calendario mes con casillas día.
- Editor de turno con 1-2 servicios.
- Autosave a localStorage (debounce 350ms).
- Generación del Libro de Horarios desde HT (`_build_horarios.py`).
- Service Worker network-first + `controllerchange` reload para
  actualizaciones automáticas.

### Iteración 2 — Calendario denso + vista lista + acordeón

- Casillas del calendario muestran nº servicio + horas + estado.
- Toggle ▦/≡ → vista lista (una fila por turno).
- Editor: acordeón vertical de servicios (sólo uno expandido a la vez).
- Hora LTV rango 05:00–23:00.
- Título card servicio dinámico ("Servicio 6010" en vez de "Servicio 1").
- Viajeros/Asist/Plazas H por parada.
- Dictado por voz (Web Speech API es-ES).
- Lápiz canvas overlay (luego retirado).
- `navigator.storage.persist()` anti-evicción.
- Botón "Comprobar actualizaciones" en Ajustes.

### Iteración 3 — Quita banner respaldo + Turno mini-bar + auto-descarga

- Banner recordatorio retirado.
- Zona Turno (Hora LTV + Tel) reducida a una línea mini.
- Auto-descarga a `Descargas/` al cerrar turno (toggle).
- Card "Cómo se guardan tus datos" en Ajustes.

### Iteración 4 — Adelantos ocultos + dormida + toggle acordeón

- Solo se muestra `+Xm` cuando `rLlegDestino > 0` (adelantos ocultos).
- Helper `isDormida(t)` (turno con 2 servicios en fechas distintas).
- Casillas de dormida con tinte azul + 🌙 en cada día.
- Acordeón con toggle real (`svc-toggle`): card-title del servicio
  expandido es clickable y lo colapsa.

### Iteración 5 — Celda doble dormida + vista lista mejorada

- Dormida con 2 días misma fila → celda doble (`grid-column: span 2`).
- Caso borde (cruce semana/mes) → bordes naranja conectores
  (`pair-end-right`/`pair-end-left`).
- 🌙 solo en el primer día.
- Vista lista: sub-líneas por servicio dentro de cada turno.

### Iteración 6 — Configuración Ajustes + multi-PDF + LTV por servicio

- Cards Ajustes reordenadas (Apariencia → Borrar todo).
- "Zona peligrosa" renombrado a "Borrar todo".
- Exportar PDF con checkboxes (multi-select de turnos).
- HTML respaldo legible (junto al .json).
- Card "¿Turno o servicio?" eliminado.

### Iteración 7 — Rediseño completo del editor

- Hora LTV movido de turno a servicio (cada servicio su LTV).
- Editor: card por estación con badge ORIGEN(verde)/PARADA(naranja)/
  DESTINO(rojo) y sub-columnas (horas | pasajeros).
- Horas no editables (vienen del Libro); botón "+ Retraso" inline.
- `parseRetraso(raw)` flexible: minutos, HH:MM, HHMM.
- `s.rSalida` (retraso al salir del origen).
- PMR como lista detallada: cada PMR tiene select de parada bajada.
- Lápiz `pointerType='pen'` con canvas overlay (luego retirado).
- Stats: "Retraso acumulado" suma todos los retrasos.
- PDF y HTML reflejan nuevo modelo.

### Iteración 8 — Fixes editor (bug parser + PMR intermedias + nuevas paradas)

- **parseRetraso bug**: `925` (= 9:25) se interpretaba como 925 min.
  Reordenado: HH:MM y HHMM se detectan ANTES que entero suelto.
- `inputmode="text"` en retraso (no `numeric`) para permitir `:`.
- Teléfono empresa restaurado: centrado en cabecera entre "Calendario"
  y "Añadir 2º servicio".
- Paradas intermedias en NARANJA (badge + borde izq).
- Mini "+" verde junto a 🗑 → inserta parada ANTES de la actual.
  Destino tiene también mini "+" → añade al final. Botón grande
  "+ Añadir parada" eliminado.
- Parada nueva editable: nombre + H. Salida como inputs.
- **PMR también en paradas intermedias**: cada parada tiene su lista.
- Select PMR solo ofrece paradas POSTERIORES (no retroceder en la
  marcha). Origen → intermedias + destino. Parada i → paradas[i+1..]
  + destino.

---

## 6. Convenciones de código

- **Vanilla JS IIFE** (`(function(){ ... })()`). Sin frameworks, sin
  build.
- **Autosave 350ms debounce** (`autosave()`): cada cambio dispara un
  timeout; al expirar se persiste en localStorage. Silencioso (sin
  flash "Guardado" en cada autosave; sólo en momentos clave: cerrar
  turno, exportar copia, exportar PDF, guardar tel/ramas).
- **Render delegado**: handlers `onClick`, `onChange`, `onInput`
  delegados en `document`. Los elementos llevan `data-action="X"`
  para acciones y `data-bind="srv.0.via"` para binding bidireccional.
- **`applyBind(bind, value)`** entiende:
  - `horaLTV` → `t.horaLTV` (deprecado).
  - `srv.X.<campo>`
  - `srv.X.par.Y.<campo>`
  - `srv.X.par.Y.pmr.Z.baja`
  - `srv.X.chk.Y` (comprobaciones)
  - `srv.X.pmr.Y.baja`
- **`parseRetraso(raw)` → entero min**: detecta `5`, `9:25`, `925`,
  `0925`, `-2`.
- **`fmtRetraso(min) → "+Xm"`**.
- **`subMinutos(hora, min)`** calcula H. Llegada desde H. Salida.
- **SW network-first** + `controllerchange` reload: cualquier `git
  push` actualiza la tablet en su próxima conexión.

---

## 7. Bugs históricos resueltos

| # | Bug | Fix | Iteración |
|---|-----|-----|-----------|
| 1 | SW cache impedía ver código nuevo al actualizar | Cambio a network-first + `controllerchange` reload | 1 |
| 2 | Dropdown Servicio Comercial vacío en file:// (fetch fail) | Embeber `window.RV_HORARIOS` vía `<script src>` en vez de fetch | 1 |
| 3 | Adelantos `-Xm` mostraban negativos confusos | Mostrar solo si `rLlegDestino > 0` | 4 |
| 4 | Dormida no se veía como mismo turno en vista mes | Celda doble + bordes conectores | 5 |
| 5 | `parseRetraso('925')` → 925 min (debería ser 565) | Reordenar: HHMM antes que entero suelto | 8 |
| 6 | Teclado numérico no permitía `:` | `inputmode="text"` | 8 |
| 7 | Parada nueva no editable | Inputs editables cuando hora/nombre vacíos | 8 |
| 8 | PMR solo en origen | Lista PMR también en cada parada intermedia | 8 |
| 9 | Select PMR ofrecía paradas previas (sin lógica) | Solo paradas posteriores al owner | 8 |

---

## 8. Limitaciones conocidas

- **Service Worker cache agresivo en desarrollo**: el cache HTTP del
  navegador interfiere con cambios. Limpiar con DevTools al desarrollar.
- **localStorage 5-10MB** por dominio. Suficiente para muchos años de
  turnos (texto + checks). Los dibujos a mano alzada quedaron fuera
  precisamente por consumo.
- **Lápiz canvas overlay NO funciona como debe**: la implementación
  con `pointerType='pen'` capturaba fotos sin sentido en la tablet de
  David. Excluido para Iryo-Studio.
- **No cross-domain storage**: una app en otro dominio Netlify no lee
  el localStorage de RV.
- **PWA web Android no puede escribir en `/storage/.../RVIryo/`**:
  solo a `Descargas/`.

---

## 9. UI / Reglas visuales

- **Theme dark default** (paleta GitHub-ish): `--bg #0d1117`,
  `--panel #161b22`, `--accent #58a6ff`, `--iryo #e8201c`.
- **Light theme** disponible (toggle en Ajustes).
- **Tabs nav**: Calendario · Estadísticas · Ajustes. Pane Editor
  abierto por interacción.
- **Calendario mensual**: lunes-primero, casilla `min-height:92px`.
  Cada día con turno tinte azul muy suave. Dormida tinte más fuerte.
- **Badges estaciones**: ORIGEN verde, PARADA naranja, DESTINO rojo.
- **Acordeón** con toggle: tap en cabecera del expandido lo colapsa.
- **Retrasos** con `parseRetraso` flexible.
- **Botones añadir**: mini "+" verde junto a la papelera 🗑 de cada
  parada.

---

## 10. TODOs heredados (fuera de alcance en iteraciones previas)

- Sincronización cloud (Fase 2).
- Autorrelleno desde turnos anteriores (similares).
- Drag-and-drop para reordenar paradas.
- OCR de los dibujos del lápiz (lápiz queda fuera).
- Recordar la última PMR creada o auto-completar destinos.
- Cruce con HT Iryo → **HECHO en Iryo-Studio**.

---

## 11. Decisiones de diseño con peso histórico

- **Un turno = 1 o 2 servicios**: no fijo. Casos: ida, vuelta, ida+vuelta
  mismo día, dormida (1 servicio cada día en 2 días).
- **Fecha por servicio (no por turno)**: una dormida tiene fechas
  distintas por servicio.
- **Servicio Comercial dropdown** desde el Libro de Horarios.
  Autocompleta `origen`, `destino`, `hSalida`, `hDestino`, paradas
  (con `tParada`).
- **Servicios siempre hasta Atocha**: maquinistas cambian en Madrid.
  Por eso `_build_horarios.py` parte en Atocha → 102 tramos de 93
  servicios originales.
- **Comprobaciones siempre 13** (orden fijo según ficha real del
  maquinista).
- **Persistencia agresiva**: `navigator.storage.persist()` + auto-
  descarga opcional + export manual. Tres capas.
