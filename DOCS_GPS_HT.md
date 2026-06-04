# Localización GPS y seguimiento en vivo — Iryo Studio (parte HT)

> Documento de referencia. Explica con exactitud cómo está implementada la localización y el seguimiento en tiempo real de la marcha. Describe qué archivos participan, qué hace cada función y cómo fluyen los datos entre ellos.

---

## Archivos implicados

| Archivo | Rol |
|---|---|
| `gps-tracking.js` | Módulo GPS completo. Gestiona geolocalización, ventanas de tiempo, marcado automático y el log. No se modifica (regla del proyecto). |
| `index.html` (IIFE HT, líneas ~3582–4700) | Núcleo de HT: define `punches`, `march`, `tickKey`, `updatePosition`, `applyPunches`, `buildMarchaPath`, `snapToPolyline`, `getPath`. Expone `window.HTIryo`. |

---

## Datos base: coordenadas y geometría de líneas

Dentro del IIFE de HT (línea 3656):

```javascript
const COORDS = JSON.parse(document.getElementById('coords').textContent);
const LINES  = JSON.parse(document.getElementById('lines').textContent);
```

- **`COORDS`**: diccionario `{ "NOMBRE ESTACIÓN": [lat, lng] }` de todas las estaciones conocidas. Embebido en el HTML como `<script id="coords">`.
- **`LINES`**: diccionario `{ "código_LAV": [[lat,lng], ...] }` con la polilínea de cada línea de Alta Velocidad (LAV). Embebido como `<script id="lines">`. Permite trazar la ruta exacta del tren siguiendo la geometría real de la vía en lugar de líneas rectas entre estaciones.

---

## Estado central de marcajes: `punches`

```javascript
let punches = {};    // { tickKey: { idx: "HH:MM" } }
let markSource = {}; // { tickKey: { idx: 'gps'|'manual'|'est' } }
```

- **`punches`**: hora real registrada por parada. La clave externa es `tickKey()`. La clave interna es el índice de la parada en `march.s`.
- **`markSource`**: indica cómo se obtuvo la marca: `'gps'` (automático), `'manual'` (el maquinista pulsó el botón), `'est'` (estimada por falta de señal GPS).

Persistencia: `localStorage['ebula_punches_v1']` y `localStorage['ebula_marksource_v1']`.

### `tickKey()` — identidad única de la marcha (línea 3967)

```javascript
function tickKey(){
  return march ? (curGrp+'|'+march.t+'|'+march.o+'→'+march.d) : '_NONE_';
}
```

Clave compuesta de grupo de tracción + número de tren + origen + destino. Garantiza que dos trenes distintos no compartan los mismos punches aunque tengan el mismo número. Sin march activo devuelve `'_NONE_'`.

---

## Geometría de la ruta: `buildMarchaPath` y `snapToPolyline`

### `buildMarchaPath(m)` (línea 4276)

Construye la lista de segmentos geométricos de la ruta del tren:

1. Filtra las paradas de `march.s` que tienen coordenadas en `COORDS`.
2. Para cada par consecutivo de paradas, busca qué LAV (`LINES`) minimiza la distancia combinada (snap de cada estación a cada línea). Elige la LAV con menor suma de distancias².
3. Extrae la sub-polilínea entre los dos puntos snap siguiendo el orden correcto (normal o invertido según el índice del snap).
4. Si ninguna línea supera el umbral de proximidad (0.5 grados²), usa línea recta entre las dos estaciones como fallback.
5. Devuelve un array de segmentos: `{ line, segPath:[[lat,lng],...], fromIdx, toIdx, fromName, toName, tFrom, tTo }`.

### `snapToPolyline(latlng, pts)` (línea 4256)

Proyecta un punto GPS sobre una polilínea:

```javascript
function snapToPolyline(latlng, pts){
  // Para cada segmento de la polilínea: proyección euclidiana 2D en lat/lng.
  // Devuelve { idx, t, dist, lat, lng }
  // dist = distancia² (buena aproximación para distancias cortas)
}
```

Usado por `gps-tracking.js` para determinar si el tren ha pasado una estación.

### `getPath(m)` (línea 4370)

```javascript
const _pathCache = {};
function getPath(m){
  const k = m.t+'|'+m.o+'→'+m.d;
  if(!_pathCache[k]) _pathCache[k] = buildMarchaPath(m);
  return _pathCache[k];
}
```

Cache de la ruta: no recalcula en cada sondeo GPS. Expuesto como `window.HTIryo.getPath`.

---

## Seguimiento en tiempo real: `updatePosition` (línea 4007)

Llamada cada segundo por `updateLive`. Calcula la posición actual del tren y actualiza la UI:

1. **Última parada marcada** (`lp`): índice de la parada con marca real más reciente (de `punches`).
2. **Retraso acumulado** (`delayMin`): diferencia entre la hora real (`punches[key][lp]`) y la hora teórica (`march.s[lp].tm`) de esa parada. Puede ser positivo (retraso) o negativo (adelanto).
3. **Hora efectiva** `effTm(i)`: hora teórica + `delayMin` para paradas i ≥ lp. Para i < lp: hora teórica pura.
4. **Parada activa** (`activeIdx`): la parada cuya hora efectiva está más cerca de la hora actual. Si el GPS está activo (`HTIryo.isTracking()`), la posición es la última marca real (no se extrapola por reloj).
5. Actualiza clases CSS en las filas `tr[data-idx]`: `now` (activa), `past` (pasadas), `next` (próxima).
6. Actualiza `#position-info` con nombre de parada, hora teórica, hora efectiva prevista y VMáx.
7. Calcula y muestra `#delta` (retraso/adelanto). Si `provisionalDelay` (publicado por el GPS) es mayor que el calculado por marcas, lo muestra marcado con "~" (provisional, no confirmado).
8. Avanza la barra de progreso `#progress`.
9. Auto-scroll a la fila activa si está fuera del área visible.

---

## El módulo GPS: `gps-tracking.js`

Módulo completamente independiente. Se conecta a `window.HTIryo` al cargarse. No tiene acceso directo a las variables internas de HT; todo pasa por la API.

### Parámetros de comportamiento

```javascript
var POLL_MS    = 30000;  // cada 30s ejecuta el ciclo de sondeo
var LEAD_MIN   = 2;      // abre ventana GPS 2 min antes de la hora efectiva
var GIVEUP_MIN = 3;      // sin señal GPS pasados 3 min post-hora → estima
var OFF_ROUTE  = 1e-3;   // umbral "fuera de ruta" (distancia² ~3 km)
var ARM_LEAD   = 3;      // aviso "Hora de salida" aparece 3 min antes
```

### Estado interno

```javascript
var tracking   = false;  // seguimiento activo o no
var windowOpen = false;  // ventana GPS abierta para la parada actual
var armed      = false;  // aviso de arranque inminente activo
var gpsNextIdx = -1;     // índice en march.s de la próxima parada a marcar
var gpsFailCount = 0;    // contador de fallos GPS consecutivos en ventana
```

### Flujo del ciclo: `pollTick()` (cada 30 segundos)

```
pollTick() se ejecuta cada 30 segundos mientras tracking = true
 │
 ├─ recomputeNext() → actualiza gpsNextIdx (primera parada sin marcar)
 │   Parada "seguible": tiene nombre, tiene coordenada en COORDS, tiene
 │   hora teórica (tm), no es dependencia CDI, idx > 0 (no es el origen).
 │
 ├─ Si gpsNextIdx = -1 → "Marcha completada", fin.
 │
 ├─ Calcular hora efectiva = march.s[gpsNextIdx].tm + currentDelta()
 │
 ├─ windowOpen = false → comprobar si es hora de abrir:
 │   Si nowMin >= effTime - 2min → windowOpen = true
 │   Si no → mostrar "Próxima: NOMBRE · hora prevista HH:MM"
 │
 └─ windowOpen = true → consultar GPS:
     GeoSource.getCurrent() → navigator.geolocation.getCurrentPosition()
     │
     ├─ Éxito (lat, lng obtenidos):
     │   └─ projectGps(lat, lng) → encuentra posición en la ruta
     │       ├─ dist² > OFF_ROUTE → "GPS fuera de ruta — ¿tren correcto?"
     │       ├─ passedOrigIdx >= gpsNextIdx → el tren pasó:
     │       │   autoMark(gpsNextIdx, skipped)
     │       │   └─ setMark(idx, "HH:MM", 'gps') → applyPunches + updatePosition
     │       └─ No pasó aún:
     │           Si nowMin > effTime + 0.5min → retraso provisional creciendo
     │           API.setProvisionalDelay(delta_actual + tiempo_extra) → #delta "~"
     │
     └─ Error (sin permisos, sin señal, timeout):
         gpsFailCount++
         Si nowMin >= effTime + GIVEUP_MIN (3min) → estimateMark(idx)
         │   API.setMark(idx, hora_efectiva, 'est') → marca estimada ("~HH:MM")
         └─ Si no → "Sin señal GPS cerca de NOMBRE…"
```

### `projectGps(lat, lng)` — detección de paso por una estación

```javascript
function projectGps(lat, lng){
  var m = API.getMarch();
  var path = API.getPath(m);      // ruta geométrica cacheada
  // Para cada segmento del path:
  //   snap = API.snapToPolyline([lat, lng], seg.segPath)
  //   Guardar el segmento con menor distancia al GPS
  // Si la distancia mínima > OFF_ROUTE → fuera de ruta
  // nearEnd: si la proyección está cerca del final del segmento → pasó el siguiente punto
  // passedFilt = índice en la lista filtrada (paradas con coordenadas)
  // filtOrig[passedFilt] → índice real en march.s
  return { passedOrigIdx, distDeg2 };
}
```

El resultado `passedOrigIdx` es el índice de la última parada con coordenadas que el tren ya ha superado. Si `passedOrigIdx >= gpsNextIdx`, se confirma el paso.

### Marcado automático: `autoMark(idx, skipped)`

```javascript
function autoMark(idx, skipped){
  // Si ya hay marca manual → conservarla, mostrar aviso conflicto
  // Si skipped = true (proyección saltó una parada) → estimateMark()
  // Si skipped = false → registrar hora actual como marca GPS:
  API.setMark(idx, "HH:MM", 'gps');
  windowOpen = false;
  recomputeNext();  // pasar a la siguiente parada
}
```

### Estimación sin señal: `estimateMark(idx)`

Si durante la ventana no se obtiene señal GPS y se supera el margen de 3 minutos:

```javascript
function estimateMark(idx){
  var eff = m.s[idx].tm + currentDelta();
  var hhmm = fmtHM(eff);  // hora efectiva como estimación
  API.setMark(idx, hhmm, 'est');
  // Muestra "~ HH:MM" en la tabla (tilde indica estimada)
}
```

### Retraso provisional durante la ventana

Cuando el GPS confirma que el tren todavía no llegó a la parada pero ya pasó su hora prevista:

```javascript
var prov = currentDelta() + (nowMin - eff);
API.setProvisionalDelay(prov);
// → HTIryo.setProvisionalDelay guarda provisionalDelay
// → updatePosition lo compara con delayMin (por marcas)
//    y si es mayor, muestra "~+Xm retraso" en #delta
```

### Wake Lock (pantalla siempre activa)

```javascript
navigator.wakeLock.request('screen')
```

Se solicita al iniciar el seguimiento. Si el dispositivo pierde el wake lock (pantalla apagada por batería baja, etc.), al volver al primer plano se muestra un botón en la sublínea GPS: "⚠ En 2.º plano: el seguimiento pudo pausarse — toca para reactivar".

### Aviso de arranque: `checkDeparture()`

Ejecutada cada 20 segundos cuando el seguimiento NO está activo. Calcula si la hora actual está dentro de los 3 minutos previos a la salida teórica del tren. Si sí, el botón GPS cambia a "● Hora de salida — Iniciar seguimiento" (con animación) para avisar al maquinista.

### Log automático: `ebula_gpslog_v1`

Cada evento significativo se guarda en `localStorage`:

```javascript
localStorage['ebula_gpslog_v1'] = {
  "tickKey1": [
    { t: "HH:MM:SS", tipo: "inicio", detalle: "6010 MAD→SEV" },
    { t: "HH:MM:SS", tipo: "paso",   detalle: "CÓRDOBA 12:34 · GPS" },
    { t: "HH:MM:SS", tipo: "retraso", detalle: "+5 min provisional hacia SEVILLA" },
    ...
  ]
}
```

Tipos: `inicio`, `fin`, `paso`, `sin_senal`, `fuera_ruta`, `retraso`, `conflicto`. Máximo 600 entradas por clave. Sin UI de consulta en esta versión.

---

## API expuesta: `window.HTIryo`

Contrato estable entre el IIFE de HT (`index.html`) y `gps-tracking.js`:

| Método | Definido en | Descripción |
|---|---|---|
| `getMarch()` | index.html | Devuelve `march` actual o `null` si no hay servicio seleccionado |
| `getPath(m)` | index.html | Ruta geométrica cacheada de la marcha (array de segmentos) |
| `snapToPolyline(latlng, pts)` | index.html | Proyecta punto GPS sobre polilínea |
| `nowMin()` | index.html | Hora actual en minutos desde medianoche |
| `getMark(idx)` | index.html | Hora marcada para la parada `idx` o `null` |
| `getMarkSource(idx)` | index.html | `'gps'`, `'manual'` o `'est'` |
| `setMark(idx, hhmm, source)` | index.html | Graba una marca. Limpia `provisionalDelay`. Dispara `iryo:htDelaysChanged`. |
| `setProvisionalDelay(min)` | index.html | Fija retraso provisional GPS. `null` para borrar. Dispara `iryo:htDelaysChanged`. |
| `isTracking()` | gps-tracking.js | `true` si el seguimiento GPS está activo |
| `logManualMark(idx)` | gps-tracking.js | Registra en el log una marca hecha a mano |
| `getActiveLegInfo()` | index.html | Tramo activo en transversales. `null` si recorrido completo. |
| `COORDS` | index.html | Diccionario `{ estación: [lat, lng] }` |
| `LINES` | index.html | Diccionario `{ código_LAV: [[lat,lng],...] }` |

---

## Flujo completo de un marcaje GPS (diagrama)

```
Cada 30s: pollTick()
 │
 ├─ recomputeNext() → gpsNextIdx = primera parada sin marcar
 │
 ├─ No ventana → ¿nowMin >= effTime - 2min? → abrir ventana
 │   └─ No → "Próxima: NOMBRE · prevista HH:MM"
 │
 └─ Ventana abierta → GeoSource.getCurrent()
     │
     ├─ OK: obtenemos (lat, lng)
     │   └─ projectGps() usando getPath() + snapToPolyline()
     │       ├─ dist > OFF_ROUTE → "GPS fuera de ruta"
     │       │
     │       ├─ passedOrigIdx >= gpsNextIdx → TREN PASÓ
     │       │   └─ autoMark(idx) → setMark(idx, now, 'gps')
     │       │       └─ applyPunches() + updatePosition() + iryo:htDelaysChanged
     │       │
     │       └─ No pasó aún
     │           └─ Si nowMin > effTime + 0.5min → setProvisionalDelay(prov)
     │               └─ updatePosition muestra "~+Xm retraso" en #delta
     │
     └─ Error GPS (sin permisos / sin señal / timeout)
         └─ Si nowMin >= effTime + 3min → estimateMark(idx)
             └─ setMark(idx, hora_efectiva, 'est') → "~HH:MM" en tabla
```

---

## Marcaje manual (desde la tabla de Horario)

El maquinista puede pulsar el botón "marcar" en la columna "Real" de cualquier parada:

1. `punchAt(idx)` en index.html registra la hora actual en `punches[tickKey()][idx]` con `source='manual'`.
2. Llama `API.logManualMark(idx)` para añadirlo al log GPS.
3. Llama `applyPunches()` para actualizar la apariencia de la tabla.
4. Llama `updatePosition()` para recalcular la posición activa y el delta.

Si el GPS intenta marcar automáticamente una parada que ya tiene marca manual (`autoMark`), la conserva y muestra un aviso de conflicto en la sublínea GPS.

---

## Relación con el cross-feed hacia Registro

Cuando `setMark` o `setProvisionalDelay` se ejecutan (por GPS o manual), disparan el evento `iryo:htDelaysChanged`. El listener en `app.js` recoge los retrasos actuales via `HTIryo.getStopDelays()` y los aplica al turno activo en Registro (`svc.rSalida`, `svc.rLlegDestino`, `paradas[i].rLleg/rSal`).

```
setMark(idx, hhmm) / setProvisionalDelay(min)
 └─ dispatchEvent('iryo:htDelaysChanged')
     └─ app.js listener
         └─ HTIryo.getStopDelays() → { rSalida, rLlegDestino, paradas:{nombre:{rLleg,rSal}} }
             └─ applyDelaysToSvc(svc, delays)
                 └─ REGISTRO.refreshEditor()
```
