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

## Registro de cambios

- **2026-06-27** — Investigación inicial de las 4 mejoras + función BSL (este documento).
  Nada implementado aún. Punto 4 bloqueado a aclarar qué es `s.h` (llegada/salida/paso).
- **2026-06-27** — Implementados **§1 (scroll arriba fijo)**, **§2 (botones modo claro)** y
  **§4 (llegada/salida en paradas)** en `index.html` + `horario.html`. `s.h` aclarado =
  salida; llegada = `s.h − (c+tc)`. §3 (nombre "EnRuta") y §5 (BSL) quedan pendientes.
  Versiones: studio-v24→v25, iryostudio-v11→v12, cache SW v31→v32. Detectado trabajo
  paralelo en `registro.js` (commits `87c1a6f`, `a8d10f5`) que no entra en conflicto.
