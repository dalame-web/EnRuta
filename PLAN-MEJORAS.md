# Plan de mejoras (investigación — sin implementar aún)

Hallazgos de la revisión del código para las mejoras pedidas. **Nada implementado**;
este documento es el registro previo. Cada mejora se marcará al hacerla.

> Nota: la lógica del libro está **duplicada** en `index.html` (start_url del PWA, lo
> que ve el maquinista) y en `horario.html`. Las mejoras visuales hay que aplicarlas en
> el que se use (a confirmar; probablemente `index.html`), y para mantener paridad,
> también en el otro.

---

## 1. Scroll del libro con GPS activo — fila activa "arriba y fija"

**Estado actual** (`index.html:4729-4738`, `horario.html:3703-3712`):
```js
if(activeIdx>=0 && !window._suppressAutoScroll){
  const tr = ...; const main = $('schedule-pane');
  if(trRect.top < mainRect.top+80 || trRect.bottom > mainRect.bottom-40){
    tr.scrollIntoView({block:'center', behavior:'smooth'});   // ← centra
  }
}
```
- Usa `block:'center'` → la fila activa queda **centrada**.
- Solo hace scroll cuando la fila **se sale** del rango `[top+80, bottom-40]`.

**Lo que pide el dueño:** la fila activa **arriba (no del todo), y que se mantenga ahí**.

**Propuesta:** sustituir el `scrollIntoView(center)` por un scroll manual que coloque la
fila a una fracción fija desde arriba (≈25-30 %): `main.scrollTop = tr.offsetTop −
main.clientHeight * 0.28`. Reajustar en cada `updatePosition` solo si se desvía de esa
posición objetivo (umbral, para no marear). Mantener `_suppressAutoScroll` (gracia de 3 s
tras scroll manual del usuario). **HECHO** (`index.html` + `horario.html`): fila fijada a
~28 % desde arriba, recalculada cada tick, umbral 24 px; se ven filas por encima.

---

## 2. Botones "Reset punteo" y "Detener localización" oscuros en modo claro

**Causa** (`index.html`):
- `button.bad` (Reset punteo, `:207`): `background:#3a1d1d` (rojo MUY oscuro, fijo).
- `button.gps-btn.tracking` (botón GPS cuando rastrea = "detener", `:213`):
  `background:#3a1d1d` igual.
- **No hay override** `body.light` para ninguno → en modo claro el fondo sigue oscuro.

**Propuesta:** añadir overrides en modo claro, p. ej.:
```css
body.light button.bad,
body.light button.gps-btn.tracking{ background:#fdecec; border-color:#d11; color:#b00; }
```
(rosa claro + texto/borde rojo, legible sobre blanco). **HECHO** (`index.html` +
`horario.html`): override `body.light` para `button.bad` y `button.gps-btn.tracking`
(fondo `#fdecec`, texto `#b02a1a`, borde `#c0392b`; hover invertido).

---

## 3. Cambiar el nombre de la app

"Iryo Studio" no describe la función. La app es: **libro de marcha digital + seguimiento
GPS + marcado de pasos + retrasos + mapa + ADIF en vivo + registro de viajes**, para
maquinistas. Sugerencias (sobrias, descriptivas; el dueño decide):

- **Marcha** / **Mi Marcha** — término ferroviario exacto del documento que maneja.
- **Libro de Marcha** / **LibroMarcha** — lo que es, literal.
- **Bitácora** / **Bitácora de Marcha** — registro del viaje.
- **EnRuta** — seguimiento en vivo.
- **PK** / **Punto y Marcha** — guiño al punto kilométrico.

Recomendación: **"Marcha"** o **"Libro de Marcha"** (claro para cualquier maquinista).
**Pendiente de decisión.**

---

## 4. Paradas intermedias: hora de llegada Y salida + retrasos/adelantos

**Hallazgo de datos:** en el libro de la marcha, cada estación tiene **una sola hora**
`s.h` y una **duración** de parada `s.c` (comercial) / `s.tc` (técnica). **NO hay campos
separados de llegada y salida** (`index.html:4448` la celda de hora muestra solo `s.h`;
`:4427-4431` la columna "Com" muestra la duración).

**Bloqueante — hay que aclarar:** ¿qué representa `s.h` en una parada comercial?
- ¿Hora de **llegada**? → salida = `h + c`.
- ¿Hora de **salida**? → llegada = `h − c`.
- ¿Hora de **paso**? → no aplica a paradas.

Esto **solo lo sabe el maquinista** (depende de cómo viene la marcha). No se inventa.

**Dato adicional:** el panel **ADIF** sí trae `arrival_time` y `departure_time` por
estación (`index.html:1944`), pero es otra fuente (tiempo real ADIF), no la marcha.

**Aclarado por el dueño (27-06):** `s.h` es la hora de **SALIDA**. La **llegada** =
`s.h − (c + tc)` (duración total de parada). Ej.: salida 20:50, comercial 2 min →
llegada 20:48.

**HECHO** (`index.html` + `horario.html`, libro `#rows`): en paradas intermedias
(`idx>0 && idx<lastIdx`, con `dwell>0`), la celda Teórica muestra **llegada** (arriba,
tenue) y **salida** (abajo, destacada) apiladas, calculando la llegada con `s.tm − dwell`.
Pasos/origen/destino siguen mostrando una sola hora.

> Nota: el retraso/adelanto se calcula hoy contra la salida (delta general). Marcar el
> retraso contra la LLEGADA por separado queda como afinado posterior si el dueño lo pide.
> **Trabajo paralelo (otra sesión):** el commit `a8d10f5` añadió "H. Llegada" en
> `registro.js` (módulo de **registro de viajes RV**, vista distinta del libro). No
> duplica este cambio.

### 4b. DOBLE MARCA real (llegada + salida) — corrección del dueño (27-06)

Lo de mostrar las horas teóricas está bien, **pero falta lo principal**: en una parada
intermedia hay que poder poner **DOS marcas reales**: la de **llegada** y la de **salida**.
Ej.: Cuenca-Fernando Zóbel, parada comercial 2 min → llegada real + salida real (dos
marcas), cada una con su retraso/adelanto.

**Lo que hay hoy (un solo slot por estación):**
- Almacén: `punches[tickKey][rowMarkKey(idx)]` = **una** hora; `markSource` = fuente
  (`index.html:4126-4153`).
- Render: cada `td.actual` tiene **un** slot (botón "marcar" o la marca con ×)
  (`applyPunches`, `:4590`).
- Manual: `punchAt(idx)` graba **una** marca (`:4780`). GPS: `HTIryo.setMark` **una**.
- El GPS marca el paso por CPA (≈ llegada al andén) y **avanza** a la siguiente; no hay
  concepto de "salida".

**Lo que implica el doble marcado (rediseño, toca el núcleo):**
1. **Almacén:** dos claves por parada, p. ej. `rowMarkKey(idx)+'|a'` (llegada) y `+'|d'`
   (salida); las estaciones de paso siguen con una sola.
2. **Render (`applyPunches`):** en paradas, la celda "Hora real" con **dos sub-marcas**
   (llegada / salida), cada una marcable y borrable.
3. **Manual (`punchAt`):** en paradas, dos botones ("Llegada" / "Salida").
4. **GPS (`gps-tracking.js`, lo más delicado):** el detector de **PARADO** ya sabe
   cuándo el tren **llega y se detiene** (`enterStoppedMode` = llegada) y cuándo
   **arranca** (`exitStoppedMode` = salida). Encaja perfecto, PERO hoy el GPS marca y
   **avanza**; habría que: marcar **llegada** al detenerse, **no avanzar**, esperar el
   arranque, marcar **salida**, y entonces avanzar. Cambio sensible del flujo GPS.
5. **`getStopDelays`:** usar la llegada y la salida **reales** (hoy deriva del único
   valor). El RV (`registro.js`) ya distingue `_rLleg`/`_rSal` → coordinar para no chocar.

**Decisión que necesita el dueño:** ¿cómo se ponen las dos marcas? (ver pregunta).

**Decisión del dueño (27-06):** **GPS automático + manual** (GPS marca llegada al parar y
salida al arrancar; el maquinista corrige a mano).

**FASE 1 HECHA (solo `index.html`, marcado MANUAL + estructura):**
- `isStopRow(idx)` + `markKeyK(idx,kind)`: la **salida** usa la clave base (compat total
  GPS/getStopDelays/RV); la **llegada** usa `clavebase|a`.
- `getMarkAt/setMarkAt/clearMarkAt` aceptan `kind` ('a' llegada / sin kind = salida).
- `applyPunches` + `punchSlotHtml`: en paradas, celda "Hora real" con **dos sub-marcas**
  apiladas (L=llegada / S=salida), cada una con su botón "marcar" y su × de borrado.
- `punchAt/clearPunch` con `kind`; manejador de clics lee `data-kind`. En paradas se
  marca solo con los botones (no al tocar la fila). CSS de los slots añadido.
- Validado: sintaxis OK; test lógico de claves (Cuenca parada → `|a` y base; pasos →
  clave única). Versiones studio-v25→v26, iryostudio-v12→v13, cache SW v32→v33.

**PENDIENTE:**
- **Probar Fase 1** en navegador/tablet (marcar L y S a mano en una parada).
- **Replicar en `horario.html`** (mismas funciones).
- **FASE 2 — GPS automático:** que el GPS marque la **llegada** (`|a`) al detenerse
  (`enterStoppedMode`) y la **salida** (clave base) al arrancar (`exitStoppedMode`),
  ampliando `HTIryo.setMark` con `kind` y ajustando el flujo en `gps-tracking.js`.
- Hoy en Fase 1 el GPS sigue marcando UNA (la salida/clave base); el doble automático es
  la Fase 2.

---

## 5. FUNCIÓN NUEVA — Botón "BSL": aviso de zona neutra / LTV con sonido

> Para cuando estén resueltas las mejoras anteriores.

**Objetivo:** botón "BSL" en el libro que, al acercarse a una **zona neutra (ZN)** o a una
**LTV (DHLTV)**, muestre una alerta/aviso y reproduzca un **sonido suave pero
identificable**, tanto si el horario avanza por **GPS** como **normal (por hora)**.

**Datos ya disponibles:**
- **Zonas neutras:** ya están en la marcha como filas con flags `_l010zn`/`_l030zn`/
  `_l040zn`/`_l042zn`/`_l050zn` y `k` + `k_fin` + `_zn_dir` (`index.html:4415`). Tienen
  índice dentro de `march.s`.
- **LTV:** en `LTV_LIST` (PDF DHLTV) con `{ line, km_ini, km_fin, vmax, via, motivo }`
  (`index.html:4432`).
- **Posición:** `activeIdx` (estación actual, por hora; `:4644-4654`) afinada por GPS.

**Decisiones del dueño (27-06):**
- **A — Anticipación: avisar 6 km ANTES** del PK de la zona neutra o de la LTV.
- **B — Sonido obligatorio** (aviso acústico para que el maquinista se dé cuenta).

**Retos / lo que hay que resolver (sin inventar):**
1. **Anticipación 6 km → hace falta el "km actual" del tren.** Hoy NO existe como tal.
   Para comparar "faltan 6 km al PK de la ZN/LTV" hay que estimar el km del tren:
   interpolando entre la estación anterior y la siguiente por sus `k` (proporción de
   tiempo/posición), o proyectando la posición GPS sobre la ruta y midiendo el km. Es el
   punto técnico principal a resolver.
2. **Sonido — aclaración de "lo bloquea":** no es que no se pueda; es que **los
   navegadores no dejan sonar audio "porque sí"** (política anti-autoplay): el sonido solo
   suena si antes hubo un **gesto del usuario** (un toque/clic) que "active" el audio. Se
   resuelve fácil: al pulsar **Iniciar seguimiento** o el botón **BSL**, se inicializa el
   `AudioContext`; a partir de ahí los avisos suenan solos. Tono suave por Web Audio
   (oscilador) o archivo corto. Hoy la app **no tiene nada de audio**, se añade de cero.
3. **Modo GPS y normal.** La detección debe funcionar con seguimiento GPS y por hora.
4. **No duplicar avisos.** Avisar una vez por ZN/LTV (como el `shownCodigos` de las LTV).

**Estado:** investigado, viable. Puntos finos: estimar el **km actual** (para los 6 km) y
**desbloquear el audio** con un gesto. **Pendiente de implementación** (para la siguiente
tanda, tras el cambio de nombre a "EnRuta").

---

## 6. Estilo hora llegada en paradas intermedias (§4 refinado)

**Pedido (28-06):** `t-arr` (llegada) aparece tenue y pequeña (11px, `--fg-dim`); `t-dep`
(salida) en negrita. El dueño quiere **mismo estilo para las dos** — misma fuente, mismo
peso, mismo color.

**Fix CSS:** en `index.html` y `horario.html`, eliminar `font-size:11px` y `color:var(--fg-dim)`
de la regla `td.time .t-arr`. **Pendiente de implementar.**

---

## 7. Celda "Hora real" paradas — centrado, separación y texto completo

**Pedido (28-06):**
- Las dos sub-marcas (L/S) están alineadas a la izquierda → centrar en la celda.
- Botones demasiado juntos → más separación entre slots.
- Etiquetas "L" y "S" → cambiar a "Llegada" y "Salida".

**Fix:**
- `td.actual.stop-cell`: `text-align:center` + `align-items:center`.
- `.mk-slot + .mk-slot`: aumentar `margin-top` a ≥ 6–8px.
- En `punchSlotHtml` (index.html), cambiar `label='L'` → `'Llegada'` y `'S'` → `'Salida'`.
  Ajustar `.mk-lbl` para texto más largo (quitar `min-width:9px`, dar más espacio).
- Mismo cambio en `horario.html` cuando se replique Fase 1.
**Pendiente de implementar.**

---

## 8. Registro: retrasos/adelantos desde marcas reales del libro

**Pedido (28-06):** las marcas reales GPS/manual del libro de horario (llegada + salida en
paradas intermedias) deben alimentar el campo de retraso/adelanto en `registro.js`, en vez
de quedar desconectadas.

**Análisis:**
- `registro.js` tiene sus propios campos `_rLleg` / `_rSal` (commit `a8d10f5`, sesión paralela).
- El libro guarda marcas en `localStorage` key `ebula_punches_v2` con estructura
  `punches[tickKey()][rowMarkKey(idx)]` (salida) y `punches[tickKey()][rowMarkKey(idx)+'|a']` (llegada).
- `tickKey()` = `curGrp|march.t|march.o→march.d` — mismo valor disponible en registro.js.
- **Mecanismo:** registro.js lee `ebula_punches_v2` desde localStorage, calcula delta contra
  `s.h` (salida) y `s.h − (c+tc)` (llegada) y muestra resultado. No hace falta IPC — comparten
  localStorage.
- **Riesgo:** hay que coordinar con la sesión paralela que toca `registro.js` para no chocar.
  No implementar sin confirmar que `a8d10f5` no usa `_rLleg`/`_rSal` de forma conflictiva.
**Pendiente de implementar (coordinar con sesión paralela primero).**

---

## 9. Scroll: reducir porcentaje de 28% a ~17%

**Pedido (28-06):** fila activa demasiado abajo (28%); quiere más arriba (15–20%).

**Fix:** en `index.html` y `horario.html`, cambiar `main.clientHeight * 0.28`
→ `main.clientHeight * 0.17` (≈ 17%). **Pendiente de implementar.**

---

## 10. Consumo de datos — reducción urgente (~2 GB en 15 días)

**Análisis (28-06):**

### Fuentes identificadas y propuesta de cambio

| Fuente | Código | Actual | Propuesto | Razón |
|---|---|---|---|---|
| Trenes ADIF (pestaña horario/mapa) | `AUTO_INTERVAL_MS` | 60 s | **300 s (5 min)** | Posición trenes no cambia tan rápido |
| Estado Red ADIF (via r.jina.ai) | `REFRESH_MS` | 120 s | **1200 s (20 min)** | Incidencias ADIF cambian poco; 20 min suficiente |
| Estado Red en `visibilitychange` | línea 6280 | siempre al volver | **Solo si >20 min desde último fetch** | Evita descarga en cada desbloqueo de pantalla |
| Estado Red guardia de pestaña | ninguna | se lanza siempre visible | **Solo si pestaña ADIF activa** | Igual que ADIF trenes |

**Decisiones del dueño (28-06):**
- `AUTO_INTERVAL_MS`: subir a 5 min (300 s). OK.
- `REFRESH_MS`: subir a 15–20 min. Elegido **20 min** (1200 s).
- `fetchLive` en `visibilitychange`: añadir guardia de tiempo mínimo.
- `fetchLive` guardia de pestaña: solo si ADIF activo.

### Tiles del mapa
Los tiles OSM **sí se cachean** en el SW (fetch handler guarda GET). Pero cada actualización
de versión de caché (nuevo `CACHE` key en `sw.js`) **borra toda la caché**, tiles incluidos.
Con ~33 versiones lanzadas, los tiles se re-descargan frecuentemente. Solución: caché
separada para tiles inmune a updates del SW. Trabajo extra — **pendiente como mejora futura**.

### Tamaño de la app en sí
Los 8 archivos del PRECACHE (`index.html` 6200 líneas, `horario.html` 5235 líneas,
`gps-tracking.js`, `app-logger.js`, etc.) son ~500–800 KB totales. No es la causa principal.
La causa principal son tiles + peticiones frecuentes a ADIF/jina.ai.

**Estado: pendiente de implementar (no tocar código aún — esperando OK del dueño).**

---

## Registro de cambios

- **2026-06-27** — Investigación inicial de las 4 mejoras + función BSL (este documento).
  Nada implementado aún. Punto 4 bloqueado a aclarar qué es `s.h` (llegada/salida/paso).
- **2026-06-27** — Implementados **§1 (scroll arriba fijo)**, **§2 (botones modo claro)** y
  **§4 (llegada/salida en paradas)** en `index.html` + `horario.html`. `s.h` aclarado =
  salida; llegada = `s.h − (c+tc)`. §3 (nombre "EnRuta") y §5 (BSL) quedan pendientes.
  Versiones: studio-v24→v25, iryostudio-v11→v12, cache SW v31→v32. Detectado trabajo
  paralelo en `registro.js` (commits `87c1a6f`, `a8d10f5`) que no entra en conflicto.
- **2026-06-27** — **§4b Fase 1 (doble marca llegada/salida, MANUAL)** implementada en
  `index.html` (ver §4b). Versiones studio-v25→v26, iryostudio-v12→v13, cache SW v32→v33.
  Pendiente: probar, replicar en `horario.html`, Fase 2 (GPS automático).
- **2026-06-27** — **Hallazgo de campo (servicio 6203, Valencia→Madrid):** las paradas de
  Valencia a Requena se marcan **a posteriori** (después de pasar la estación, no en ella).
  El dueño nota **asimetría de sentido**: "para bajar" (Madrid→Valencia) marcaba mejor que
  "para volver" (Valencia→Madrid, 6203). Reabre el problema conocido del marcado tardío
  (CPA confirma al alejarse + huecos de muestreo GPS; ya se subió `timeout` 10→15 s y
  `maximumAge` 0→3 s). **Pendiente de DATOS:** analizar el log del 6203 al terminar el
  servicio para ver si la asimetría es geometría de ruta (LINES), offset de coordenadas
  por sentido, o cadencia de sondeo. No tocar a ciegas. El acelerómetro (PLAN-ACELEROMETRO)
  también mitigaría este caso.
- **2026-06-28** — **Análisis consumo de datos (§10):** ~2 GB en 15 días. Causas: tiles SW
  borrados en cada update de versión + `fetchLive` cada 2 min sin guardia + `runFetch` cada
  60 s. Plan: `AUTO_INTERVAL_MS` 60s→300s, `REFRESH_MS` 120s→1200s, guardia `visibilitychange`.
  Sin tocar código hasta OK. Nuevas mejoras UI anotadas: §6 (estilo t-arr), §7 (centrado
  slots marca), §8 (registro desde punches), §9 (scroll 28%→17%). Todas pendientes.
