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
tras scroll manual del usuario). **Pendiente.**

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
(rosa claro + texto/borde rojo, legible sobre blanco). Verificar tonos con el resto del
tema claro. **Pendiente.**

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

**Propuesta (una vez aclarado `h`):** en paradas comerciales, mostrar **llegada** y
**salida** (derivando la que falte con `c`/`tc`), y permitir/mostrar marca real y
retraso/adelanto contra **ambas**. Cambia el render del libro y la lógica de marcado.
**Pendiente + requiere aclaración.**

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

**Retos / lo que hay que resolver (sin inventar):**
1. **Anticipación.** El aviso debe salir **antes** de llegar (el dueño ya señaló que se
   reduce velocidad ANTES de la baliza). Hay que decidir el margen: por estaciones, por
   tiempo, o por km estimado. Para km exacto haría falta estimar el **km actual** del tren
   (interpolar entre estaciones por `k`, o sacar km de la proyección GPS) — hoy NO existe
   ese "km actual" como tal.
2. **Sonido.** Hoy **no hay audio** en la app. Habría que añadir Web Audio API (un tono
   suave por oscilador, o un archivo corto). **Caveat real:** los navegadores **bloquean
   el audio** hasta un gesto del usuario; el AudioContext se "desbloquea" al pulsar
   "Iniciar seguimiento" o el propio botón BSL. Sin ese gesto, el sonido no sonará.
3. **Modo GPS y normal.** La detección debe funcionar con seguimiento GPS y por hora.
4. **No duplicar avisos.** Avisar una vez por ZN/LTV (como el `shownCodigos` de las LTV).

**Estado:** investigado, viable con los datos actuales; el punto fino es la anticipación
(km actual) y desbloquear el audio. **Pendiente de diseño detallado e implementación.**

---

## Registro de cambios

- **2026-06-27** — Investigación inicial de las 4 mejoras + función BSL (este documento).
  Nada implementado aún. Punto 4 bloqueado a aclarar qué es `s.h` (llegada/salida/paso).
