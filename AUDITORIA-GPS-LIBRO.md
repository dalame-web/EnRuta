# Auditoría: GPS → Libro de Horario
> Documento de estudio. No modifica código. Fecha: 2026-06-26.
> Objetivo: entender por qué el marcado GPS en el libro de horario falla,
> separando capas, flujos y conflictos con citas de líneas reales.

---

## 1. ARQUITECTURA — Tres capas independientes

```
┌──────────────────────────────────────────────────────────┐
│  gps-tracking.js  (IIFE, aislado)                        │
│  Toda la lógica GPS: ventanas, CPA, LTV, PARADO, desvío  │
│  Solo LEE la API. Solo ESCRIBE via API.setMark y          │
│  API.setProvisionalDelay.                                 │
└───────────────────────┬──────────────────────────────────┘
                        │  window.HTIryo  (API bridge)
┌───────────────────────▼──────────────────────────────────┐
│  horario.html  (libro del maquinista)                    │
│  Define window.HTIryo en línea 4261.                     │
│  Gestiona marcas, render del libro, icono de posición.   │
└──────────────────────────────────────────────────────────┘
```

**Regla de oro**: el GPS nunca toca el DOM directamente. Solo llama
`API.setMark(idx, hhmm, src)` y `API.setProvisionalDelay(min)`.
Si la marca se guarda pero no se ve, el problema está en el libro.
Si la marca nunca se guarda, el problema está en el GPS.

---

## 2. API BRIDGE — `window.HTIryo` (horario.html:4261)

El libro expone este objeto antes de cargar `gps-tracking.js`.
El GPS lo captura al inicio: `var API = window.HTIryo;` [gps:14].

| Función | Dirección | Qué hace |
|---|---|---|
| `API.getMarch()` | Libro → GPS (leer) | Devuelve el objeto `march` activo |
| `API.COORDS` | Libro → GPS (leer) | Coordenadas `{nombre: [lat, lng]}` |
| `API.LINES` | Libro → GPS (leer) | Geometría de vías (polilíneas) |
| `API.getPath(m)` | Libro → GPS (leer) | `buildMarchaPath`: segmentos de ruta |
| `API.snapToPolyline(latlng, pts)` | Libro → GPS (leer) | Proyecta punto sobre segmento |
| `API.nowMin()` | Libro → GPS (leer) | Hora actual en minutos |
| `API.getTickKey()` | Libro → GPS (leer) | Clave del servicio activo |
| `API.getMark(idx)` | Libro → GPS (leer) | Marca almacenada para la fila idx |
| `API.getMarkSource(idx)` | Libro → GPS (leer) | Fuente: 'gps' / 'est' / 'manual' |
| `API.setMark(idx, hhmm, src)` | GPS → Libro (escribir) | **Guarda marca + re-render** |
| `API.setProvisionalDelay(min)` | GPS → Libro (escribir) | Delta provisional + `updatePosition()` |
| `API.isTracking()` | GPS → Libro (leer) | `true` si el seguimiento GPS está activo |
| `API.logManualMark(idx)` | Libro → GPS (escribir) | Reengancha suelo al marcar a mano |
| `API.onMarchaChange(cb)` | Libro → GPS | Registra callback al cambiar marcha |
| `API.startTracking()` | Libro → GPS | Reanuda GPS (LOC-011) |
| `API.enableHourFollow()` | GPS → Libro | Activa seguimiento por hora al arrancar |
| `API.forceLiveTime()` | GPS → Libro | Fuerza hora real si estaba en modo manual |

---

## 3. FLUJO COMPLETO DE UNA MARCA GPS

```
pollTick() [gps:866]
  │
  ├─ guard: !tracking || isStopped || preWindowDeferred → abort
  │
  ├─ recomputeNext() [gps:284] — calcula gpsNextIdx
  │
  ├─ ¿windowOpen? → si no: ¿nowM >= eff - LEAD_MIN(2)? → abrir ventana
  │                         si no: return (sin sondear GPS)
  │
  ├─ GeoSource.getCurrent() [gps:182] — lectura GPS (hasta 10 s)
  │
  ├─ Filtros de calidad [gps:949]:
  │   accuracy > 1500 m  → poorReading
  │   sin speed (coarse) → poorReading
  │   accuracy > umbral(velocidad) → poorReading
  │   Si poorReading → gpsFailCount++ → ¿giveup? → estimateMark
  │
  ├─ projectGps(lat, lng) [gps:314]
  │   → API.getPath(m) → buildMarchaPath → snap a polilínea
  │   → devuelve { passedOrigIdx } o null si fuera de ruta (> 3 km)
  │
  ├─ cpaUpdateHistory(distM, pos, nowMs) [gps:393]
  ├─ cpaDetectPass() [gps:425] — detecta mínimo de distancia
  │
  ├─ ¿alreadyPassed?
  │   = passedOrigIdx > gpsNextIdx  (geometría: pasó varias)
  │   ó cpa.passed                  (CPA confirmó el mínimo)
  │   ó passedOrigIdx == gpsNextIdx && receding (geometría exacta + alejándose)
  │
  ├─ ¿stronglyReceding? [gps:1117]
  │   = geometría no confirma PERO 3 lecturas con distancia subiendo > 400 m
  │
  ├─ ¿ltvWait? → distM > 5 km primera vez → bloquear hasta aproximación
  │
  ├─ Ramas de marca:
  │   passedOrigIdx > gpsNextIdx → autoMark en cadena [gps:1148]
  │   cpa.passed                 → autoMark con timestamp CPA [gps:1158]
  │   passedOrigIdx == gpsNextIdx → si acercándose: esperar; si alejándose: autoMark backdatada
  │   stronglyReceding            → autoMark backdatada + catchUp [gps:1195]
  │   ninguno pero hora vencida  → estimateMark [gps:1214]
  │
  └─ autoMark(idx, skipped, atMs) [gps:720]
       → API.setMark(idx, hhmm, 'gps') [gps:734]
           → setMarkAt(idx, hhmm, 'gps') [hor:3453]
           → provisionalDelay = markDelay(idx, hhmm) [hor:4281]  ← FIX C
           → savePunches(); saveMarkSource()  [hor:4282]
           → applyPunches()  [hor:3506]  ← PINTA EN DOM
           → updatePosition()  [hor:3543]  ← ICONO + DELTA
       → recomputeNext() [gps:741]  ← avanza al siguiente objetivo
```

---

## 4. CÓMO SE ALMACENAN LAS MARCAS

### Claves de almacenamiento
```
punches[tickKey()][rowMarkKey(idx)] = "HH:MM"
markSource[tickKey()][rowMarkKey(idx)] = 'gps' | 'est' | 'manual'
```

**tickKey()** [hor:3424]: identifica el servicio activo.
```js
function tickKey(){ return curGrp+'|'+march.t+'|'+march.o+'→'+march.d }
// Ejemplo: "grupo1|04512|Madrid-Puerta Atocha→Málaga-María Zambrano"
```

**rowMarkKey(idx)** [hor:3434]: identifica la fila de forma estable.
```js
// base = "nombre|km"  — no depende del índice numérico
// si la misma dependencia aparece dos veces: base + "|1", "|2"...
```
> ¿Por qué clave estable? `injectBoxAnns(march)` hace `splice` en `march.s`
> al renderizar, desplazando índices. Una clave por índice se rompería al
> publicar una nueva versión con una fila nueva insertada a mitad de ruta.

**Persistencia**: `localStorage`. Se carga al iniciar (`loadPunches`) y se guarda
en cada marca (`savePunches`). Sobrevive a recargas de página.

---

## 5. CÓMO `applyPunches` PINTA LAS MARCAS [hor:3506]

```js
function applyPunches(){
  const key = tickKey();
  const trPunches = punches[key]||{};
  document.querySelectorAll('#rows td.actual').forEach(td=>{
    if(!td.dataset.idx) return;        // ← CDI/ZN/boxann: NO tienen data-idx → se saltan
    if(td.dataset.noMark) return;      // ← filas sin nombre
    const idx = +td.dataset.idx;
    const nk = rowMarkKey(idx);
    const p = nk != null ? trPunches[nk] : undefined;
    if(p){
      // pinta: "📡 HH:MM" (gps) / "~ HH:MM" (est) / "✋ HH:MM" (manual)
    } else {
      // muestra botón "marcar"
    }
  });
}
```

**Condición para que una marca sea visible**:
1. La fila tiene `<td class="actual" data-idx="N">` en el DOM.
2. `tickKey()` al pintar == `tickKey()` al guardar.
3. `rowMarkKey(N)` al pintar == `rowMarkKey(N)` al guardar.
4. La marca está en `punches[tickKey][rowMarkKey]`.

Si cualquiera de estas condiciones falla → la marca existe en memoria pero no se ve.

---

## 6. MÁQUINA DE ESTADOS DEL GPS — Variables críticas

| Variable | Valor inicial | Efecto sobre el marcado |
|---|---|---|
| `gpsNextIdx` | -1 | **-1 = nada se marca**. `recomputeNext()` lo recalcula en cada tick. |
| `trackFloorIdx` | -1 | Índice mínimo markable. Si es muy alto, salta estaciones al inicio. |
| `floorConfirmed` | false | Hasta que sea `true`, no se marca nada (guarda del relevo). |
| `windowOpen` | false | La ventana se abre 2 min antes de la hora efectiva. Fuera de ella, no se sondea GPS. |
| `ltvWait` | false | Primera lectura > 5 km → bloquea marca y giveup hasta acercarse. |
| `isStopped` | false | PARADO confirmado → bloquea `estimateMark` y `catchUp`. |
| `inDetour` | false | DESVÍO → suspende marcado automático. |
| `provisionalDelay` | null | **`!= null` → icono clavado en `lp`** (última estación marcada). `null` → icono avanza por tiempo. |
| `pollInFlight` | false | Cerrojo: solo un `getCurrentPosition` en vuelo a la vez. |

### Condiciones para que `pollTick` llegue a sondear el GPS
Todas deben cumplirse:
- `tracking == true` (iniciado con botón o LOC-011)
- `isStopped == false`
- `preWindowDeferred == false`
- `pollInFlight == false` (o el watchdog lo libera tras 20 s)
- `gpsNextIdx >= 0` (hay estación pendiente)
- `windowOpen == true` (o `nowM >= eff - LEAD_MIN`)

Si alguna falla, el GPS no sondea. Si el GPS no sondea, no hay marca.

---

## 7. CONFLICTOS IDENTIFICADOS

---

### CONFLICTO E' — Asimetría `isMarkable` vs. `data-idx` ⚠️ PENDIENTE

**Síntoma**: GPS guarda una marca, no aparece en el libro.

**Causa**:

`isMarkable()` [gps:236] decide qué filas sigue el GPS:
```js
function isMarkable(m, i){
  var s = m.s[i];
  return !!(i > 0 && s && s.n && API.COORDS[s.n] && s.tm != null && !s._l010cdi);
}
```
Excluye filas `_l010cdi`. **No excluye** `_l010zn`, `_l030zn`, `_l040zn`, `_l042zn`, `_l050zn`.

`renderRows()` [hor:3206] construye la celda de marca:
```js
const actualCell = isMarker          // isMarker = isCdi || isZn || isBoxann
  ? '<td class="actual"></td>'        // ← SIN data-idx
  : `<td class="actual" data-idx="${idx}">...`  // ← CON data-idx
```

**El conflicto**: si una fila ZN tiene `s.n && COORDS[s.n] && s.tm != null`:
- GPS: `isMarkable` devuelve `true` → la marca
- Libro: `applyPunches` ve `!td.dataset.idx` → la salta → invisible

**Impacto potencial**: depende de si hay ZN con nombre en COORDS y hora teórica.
Las ZN típicamente no tienen coordenada propia → `COORDS[s.n]` es `undefined` →
`isMarkable` devuelve `false`. Pero si alguna ZN tiene nombre coincidente en COORDS
y tiene `s.tm`, el GPS la marcaría silenciosamente.

**Verificar**: buscar en las marchas reales filas con `_l010zn`/`_l030zn`/etc.
que también tengan `s.n` y `COORDS[s.n]`.

---

### CONFLICTO E — Geometría nudo Córdoba-Alcolea ⚠️ PENDIENTE

**Síntoma**: el GPS no reconoce el paso por Alcolea/BIF.Málaga. Atasco.

**Causa**:

`projectGps()` [gps:314] usa `API.getPath(m)` → `buildMarchaPath`:
```js
// buildMarchaPath [hor:3876]:
const stops = m.s.filter(s=>s.n && COORDS[s.n]);
for(let i=0; i<stops.length-1; i++){
  const a = COORDS[stops[i].n], b = COORDS[stops[i+1].n];
  // Si LINES[stops[i].n+stops[i+1].n] existe → usa esa polilínea
  // Si no → recta entre a y b
}
```

En el nudo Córdoba-Alcolea: la vía real hace una curva/bifurcación que
la recta entre estaciones no representa. El tren puede estar a 3+ km de
la recta estando perfectamente en ruta → `snap.dist > OFF_ROUTE (3 km)` →
`projectGps` devuelve `null` → no hay `passedOrigIdx`.

Sin geometría, el único detector activo es CPA. Si el tren pasa por el nudo
en pocas lecturas (velocidad LAV, ventana de 2 min), el CPA no acumula historia
suficiente para confirmar el mínimo → no marca.

FIX1 ([gps:1117]) mitiga esto: si 3 lecturas consecutivas muestran distancia
creciendo > 400 m, marca aunque la geometría no lo confirme. Pero la marca
puede salir 1-2 min tarde (backdatada con `distM / speed`).

**Causa raíz**: datos faltantes en `LINES`, no bug de lógica.

---

### CONFLICTO A — Icono "pegado" en la última marca ✅ INTENCIONAL

**Síntoma**: el 📍 no avanza, se queda en la estación anterior.

**Causa**: comportamiento diseñado.

En `updatePosition()` [hor:3625-3638]:
```js
if(HTIryo.isTracking() && lp >= 0){
  if(provisionalDelay != null){
    activeIdx = lp;   // ← icono clavado en última marca
  }
}
```

El GPS fija `provisionalDelay != null` mientras confirma que el tren
no ha pasado la siguiente estación [gps:1224]:
```js
API.setProvisionalDelay(currentDelta());  // != null → clava el icono
```

**Por qué es intencional**: no se puede fingir el paso por B hasta que GPS
o estimateMark lo confirmen. El icono clavado en A es correcto.

**Cuándo parece bug**: si `autoMark`/`estimateMark` nunca avanza `lp`
(conflictos E o E'), entonces `provisionalDelay` sigue fijado y el icono
se queda para siempre. El síntoma del icono clavado es consecuencia de que
el marcado no funciona, no la causa.

---

### CONFLICTO C — Delta que parpadea ✅ ARREGLADO (FIX C)

**Síntoma**: el retraso mostrado salta a 0 al marcar una estación.

**Causa original**: `API.setMark` ponía `provisionalDelay = null` al marcar.
`updatePosition` usaba entonces `delayMin` (de la marca nueva) pero había
un ciclo donde provisionalDelay=null → icono avanzaba → parecía que el tren
llegó en hora.

**FIX C aplicado**:
```js
// horario.html:4281 — dentro de API.setMark
provisionalDelay = markDelay(idx, hhmm);  // marca - teórica (min)
```
```js
// horario.html:3735 — dentro de punchAt (marca manual)
provisionalDelay = HTIryo.isTracking() ? markDelay(idx, ...) : null;
```

FIX C se aplica en ambos caminos (GPS y manual). En `clearPunch` se pone
a `null` [hor:3753] — correcto, la marca desaparece.

---

### RIESGO — FIX3 (GPS off → marcar por hora) no actúa si GPS cuelga

FIX3 [hor:3582] tiene la guarda:
```js
if(liveMode && trackingOn && !(HTIryo.isTracking && HTIryo.isTracking()))
```

Si el GPS se congela (error de permiso, chip colgado) sin llamar a
`stopTracking()`, `isTracking()` devuelve `true` aunque el GPS no funcione.
En ese estado: FIX3 no actúa (cree que el GPS está trabajando) y el GPS
tampoco marca (está colgado). Resultado: estaciones sin marca.

**Hoy**: no hay watchdog que detecte "tracking=true pero sin ticks en N min".
El maquinista tendría que pulsar "Parar" y "Iniciar" manualmente.

---

### RIESGO — `march.s` mutado por `injectBoxAnns` con GPS activo

`renderRows()` [hor:3149] llama `injectBoxAnns(march)` que hace `Array.splice`
sobre `march.s`. Esto desplaza todos los índices posteriores al punto de inserción.

El GPS usa índices numéricos (`gpsNextIdx`, `trackFloorIdx`, etc.) que apuntan
a `march.s`. Si `renderRows` se volviera a llamar con el GPS activo, los índices
quedarían apuntando a filas equivocadas.

**Por qué no falla hoy**: `renderRows` solo se llama al cambiar de marcha, y
`API.onMarchaChange` llama `stopTracking()` primero [gps:1571]. El GPS se reinicia
con los índices correctos después de que `injectBoxAnns` termine.

**Riesgo latente**: si en el futuro se llama `renderRows` por otro motivo con el
GPS activo, los índices quedan corruptos silenciosamente.

---

### RIESGO LOC-011 — DESCARTADO (segunda lectura)

La secuencia de inicialización de horario.html es completamente síncrona.
`march` se asigna en `renderHeader()` [hor:3047], que se llama en la cadena
de init [hor:4247] ANTES de que `window.HTIryo` se exponga [hor:4259].
`gps-tracking.js` solo carga después de que el script de horario.html termine.
Para cuando `setTimeout(startTracking, 800)` dispara, `march` lleva cientos
de ms disponible. **No hay race condition.**

---

### ASIMETRÍA — `currentDelta()` GPS vs. `delayMin` libro

Ambos calculan el retraso/adelanto actual de la misma forma (HOR-002):
- GPS: `currentDelta()` [gps:247]: última marca real; si no hay, última est.
- Libro: `delayMin` en `updatePosition()` [hor:3547]: `lpReal >= 0 ? lpReal : lp`.

Los criterios son equivalentes. Sin conflicto confirmado.

**Pero**: cuando hay un `provisionalDelay` activo (GPS fijó su valor),
`updatePosition` usa ese número directamente para el delta visible [hor:3687].
Si `provisionalDelay` (GPS) y `delayMin` (libro) divergen —p.ej. por un
desfase en `currentDelta()`— el delta en pantalla puede saltar al entrar/salir
del estado de `provisionalDelay`.

---

## 8. TABLA COMPLETA: QUIÉN LLAMA A QUÉ

| Llamante | Función llamada | Archivo:línea | Resultado |
|---|---|---|---|
| `autoMark` | `API.setMark(idx, hhmm, 'gps')` | gps:734 | Guarda + pinta marca GPS |
| `estimateMark` | `API.setMark(idx, hhmm, 'est')` | gps:761 | Guarda + pinta marca estimada |
| `pollTick` (en hora) | `API.setProvisionalDelay(currentDelta())` | gps:1224 | Clava icono en lp |
| `pollTick` (retraso) | `API.setProvisionalDelay(prov)` | gps:1217 | Actualiza delta provisional |
| `pollTick` (sin señal ×2) | `API.setProvisionalDelay(null)` | gps:1243 | Libera icono → avanza por tiempo |
| `stopTracking` | `API.setProvisionalDelay(null)` | gps:1409 | Libera icono al parar |
| `runCheckpoint` | `API.setProvisionalDelay(provDelay)` | gps:831 | Actualiza delta en mitad de tramo |
| `updateStoppedDelay` | `API.setProvisionalDelay(prov)` | gps:520 | Delta crece durante PARADO |
| `punchAt` (libro) | `setMarkAt(idx, hhmm, 'manual')` | hor:3732 | Guarda marca manual |
| `punchAt` (libro) | `HTIryo.logManualMark(idx)` | hor:3748 | Reengancha suelo GPS |
| `updatePosition` FIX3 | `setMarkAt(i, e, 'est')` | hor:3594 | Marca por hora (GPS off) |
| `API.setMark` | `applyPunches(); updatePosition()` | hor:4283 | Re-render DOM completo |
| `API.setProvisionalDelay` | `updatePosition()` | hor:4274 | Actualiza icono/delta inmediatamente |

---

---

## 9. HALLAZGOS ADICIONALES (segunda lectura)

### `injectBoxAnns` es idempotente — mito descartado
`injectBoxAnns(march)` [hor:2895] tiene el guard `if(!march || march.__boxannDone) return`.
Después de la primera llamada pone `march.__boxannDone = true`.
→ **No puede mutar `march.s` dos veces.** El riesgo de índices desplazados con GPS activo
no existe en la práctica.

### LOC-011 NO tiene race condition — mito descartado
La secuencia de inicialización de horario.html es **síncrona**:
```
4245: buildAllMarchas()
4247: renderHeader()      ← march = entry.m   (ya disponible)
4254: renderRows()        ← injectBoxAnns(march) (march.s ya mutado)
4259: window.HTIryo = {...}
      ← AQUÍ carga gps-tracking.js (var API = window.HTIryo)
      ← gps-tracking.js llama setTimeout(startTracking, 800)
```
En los 800 ms que esperan, `march` está disponible desde el inicio.
El LOC-011 de LOC-011 en horario.html espera incluso más (1200 ms) y pide confirmación.

### `trackingOn` persiste en localStorage — riesgo FIX3
`savePrefs()` [hor:3011] guarda `{idx, tracking}` en localStorage `'ebula_v2'`.
`loadPrefs()` [hor:3006] lo restaura al arrancar.

**Si el maquinista apagó el seguimiento por hora antes de cerrar la app**, al reabrir
`trackingOn = false`. Con GPS también apagado, FIX3 no marcaría nada porque:
```js
if(liveMode && trackingOn && !(HTIryo.isTracking()))  // ← trackingOn=false → no entra
```
El maquinista vería el libro sin ningún marcado y sin mensaje de error.
**Es correcto por diseño** (el maquinista apagó el seguimiento), pero puede confundir.

### `_pathCache` — nunca se limpia pero es seguro
`getPath(m)` [hor:3969] guarda `buildMarchaPath(m)` en `_pathCache[k]`
con clave `m.t+'|'+m.o+'→'+m.d`. El cache no se borra nunca en la sesión.

Riesgo teórico: si dos marchas distintas tienen el mismo `t|o→d` (grupos diferentes),
compartirían el camino. **Pero `buildAllMarchas` deduplica** con la misma clave [hor:3018],
así que nunca hay dos marchas con el mismo identificador en `ALL_MARCHAS`. Seguro.

Boxann rows tienen `n:''` → filtradas en `buildMarchaPath` → el path es independiente
de `injectBoxAnns`. El cache no puede quedar obsoleto por eso.

### `buildMarchaPath` — cómo decide qué línea usar [hor:3882-3918]
Para cada par de estaciones consecutivas (ambas en COORDS), busca en **todos los
segmentos de LINES** cuál tiene la menor suma de distancias snap desde ambos extremos:
```js
const score = sa.dist + sb.dist;   // sa.dist = distancia² (grados) del punto A al segmento
if(bestLine && bestScore < 0.5){   // umbral: 0.5 grados² ≈ √0.5 ≈ 0.71° ≈ ~79 km
  // usa la geometría del segmento de línea
} else {
  // fallback: recta entre A y B
}
```

El umbral de 0.5 es muy generoso: si una estación está a menos de ~55 km del segmento
(en la componente perpendicular), pasará el umbral. En la práctica, estaciones LAV están
en sus líneas, así que `sa.dist ≈ 0` y el umbral pasa con facilidad.

**El problema del nudo Córdoba-Alcolea**: la bifurcación implica que la línea Madrid-Sevilla
y la línea Madrid-Málaga son **dos segmentos distintos** en LINES. La estación Córdoba
pertenece a ambas, pero Alcolea (o BIF.Málaga) solo pertenece a la línea Málaga.
Para el tramo Córdoba → Alcolea, el algoritmo busca en qué línea ambos puntos snappean
bien. Si BIF.Málaga no está en la línea Madrid-Sevilla, ese segmento puntúa mal.
Si LINES no tiene un segmento que conecte directamente Córdoba y Alcolea, la puntuación
del mejor segmento puede seguir siendo alta → fallback a recta → `projectGps` falla.

### `snapToPolyline` usa distancia euclidiana plana [hor:3855]
```js
const d = (px-latlng[1])*(px-latlng[1]) + (py-latlng[0])*(py-latlng[0]);
```
No usa haversine. Error en España (~40°N): ~15% en distancias E-O (km/grado lon < km/grado lat).
Para la comparación `best.dist > OFF_ROUTE (1e-3)`, el umbral equivale a `√1e-3 ≈ 0.032°`.
En latitud: ~3.5 km. En longitud: ~3.0 km (ligeramente menor).
**El umbral efectivo es asimétrico** (más estricto en dirección E-O que N-S).
Para LAV norte-sur (Madrid-Sevilla, Madrid-Málaga): el error es menor porque la dirección
principal está en el eje mejor representado.

### Dos caminos distintos para LOC-011
**Camino A** [gps:1665]: `setTimeout(startTracking, 800)` — recarga accidental (F5, update PWA).
El GPS arranca sin preguntar. El maquinista puede no darse cuenta.

**Camino B** [hor:4375]: recarga tras cierre real → diálogo "Continuar/Empezar de nuevo" →
si elige Continuar: `setTimeout(HTIryo.startTracking, 300)`.

**Sin sincronizar**: si la sesión tiene el centinela (`ebula_servicio_activo`) Y la app
detecta cierre real (el centinela no existe), ¿cuál gana? El camino A solo se activa en
gps-tracking.js donde sí existe el centinela; el camino B se activa cuando el centinela
NO existe (cierre real). Son mutuamente excluyentes. Correcto.

### FIX3 también excluye ZN en `updatePosition` [hor:3590]
```js
if(s._l010cdi||s._l010zn||s._l030zn||s._l040zn||s._l042zn||s._l050zn||s._boxann) continue;
```
FIX3 no marca ZN por tiempo aunque el GPS esté apagado. Consistente.
Pero `isMarkable()` del GPS no tiene esta exclusión (conflicto E' arriba).

---

## 10. PENDIENTES DE VERIFICAR (con método)

| # | Pregunta | Cómo verificarlo |
|---|---|---|
| 1 | ¿Hay filas ZN en marchas reales con `s.n && COORDS[s.n] && s.tm != null`? | Consola del navegador: `window.HTIryo.getMarch().s.filter(s=>s._l010zn&&s.n&&window.HTIryo.COORDS[s.n]&&s.tm!=null)` |
| 2 | ¿`LINES` cubre el segmento Córdoba-Alcolea? | Consola: `window.HTIryo.getPath(window.HTIryo.getMarch())` → buscar segmentos con `line: null` (recta = sin geometría real). Si Córdoba→Alcolea aparece → confirmado. |
| 3 | ¿`diag_setmark` aparece en logs post studio-v15? | Tablet: `JSON.parse(localStorage.getItem('ebula_gpslog_v1'))` → buscar entradas `tipo:"diag_setmark"`. |
| 4 | ¿`trackingOn` está a `true` al iniciar el servicio? | Tablet: `JSON.parse(localStorage.getItem('ebula_v2'))` → campo `tracking`. Si `false`, FIX3 no actúa. |
| 5 | ¿`buildMarchaPath` cae a recta en el nudo? | Ya cubierto en el punto 2: segmentos con `line: null` son rectas de fallback. |

---

## 10. RESUMEN DE PROBLEMAS POR GRAVEDAD

| Gravedad | Conflicto | Estado | Descripción |
|---|---|---|---|
| 🔴 Alta | **E — Geometría nudo** | PENDIENTE (mitigado FIX1) | `projectGps` retorna null → CPA puede no acumular → no marca |
| 🟡 Media | **E' — ZN invisible** | PENDIENTE | Si ZN tiene coords+hora, GPS la marca pero el libro no la pinta |
| 🟡 Media | **GPS cuelga sin watchdog** | Sin fix | `isTracking()=true` pero sin ticks → FIX3 no actúa, GPS tampoco |
| ✅ Ok | **LOC-011 race condition** | DESCARTADO | `march` se inicializa síncronamente antes de que gps-tracking.js cargue |
| 🟢 Baja | **injectBoxAnns con GPS activo** | Latente | Solo fallaría si `renderRows` se llama con GPS en marcha |
| ✅ Ok | **C — Delta parpadea** | ARREGLADO (FIX C) | `markDelay` en vez de null |
| ✅ Ok | **A — Icono clavado** | INTENCIONAL | Es la regla del dueño: no fingir el paso |
| ✅ Ok | **B — LTV clavado** | ARREGLADO (FIX1/GPS-004) | `stronglyReceding` desbloquea el atasco |
| 🟠 Nueva | **API incompleta en app.js** | Sin fix | `showService`, `getStopDelays`, `getActiveLegInfo` no existen en HTIryo |
| 🟡 Nueva | **Click en ZN → marca invisible** | Latente | `bind()` permite punchAt sobre filas CDI/ZN aunque no tengan botón visible |
| 🟢 Nueva | **diffPunches usa índice NaN** | Cosmético | app-logger.js usa `+k` con claves `"nombre|km"` → log incorrecto, no afecta marcado |

---

## 11. HALLAZGOS TERCERA LECTURA (archivos restantes)

### `app-logger.js` — capa de diagnóstico que envuelve HTIryo

`app-logger.js` se carga en la línea 5232, **justo antes** de `gps-tracking.js` (línea 5233).
Envuelve varios métodos de `window.HTIryo` con wrappers de logging:

```
HTIryo.setMark           → [app-logger wrapper] → origSetMark (horario.html)
HTIryo.setProvisionalDelay → [app-logger wrapper] → origSPD
HTIryo.logManualMark     → [app-logger wrapper] → origLMM
```

Cuando GPS llama `API.setMark(idx, hhmm, 'gps')`, el flujo real es:
```
gps-tracking.js:734 → app-logger.js:597 (log+wrap) → horario.html:4279 (diag GPS-005) → setMarkAt → applyPunches
```

**El DIAG GPS-005** [hor:4279-4299] dentro de `setMark` registra si la celda
`#rows td.actual[data-idx="N"]` existe en el DOM, y si contiene la clase `punched`.
Esto es diagnóstico directo del problema de marca invisible. Si en los logs del tablet
aparece `cellFound: false`, es CONFLICT E en acción.

**Importante**: el flag `setMarkInProgress = true` en el wrapper bloquea que
`localStorage.setItem` intercepte el guardado de punches como una "acción de usuario".
Así el log solo cuenta marcas GPS una vez, no dos.

---

### `app-logger.js:diffPunches` — índice NaN en los logs (bug diagnóstico)

```js
// app-logger.js:528
return { type: 'alta', idx: +k, hhmm: newP[k] };
// k = rowMarkKey = "CÓRDOBA|358.000"  → +k = NaN
```

Las claves de `punches` son del tipo `"CÓRDOBA CENTRAL|358.100"`, no números.
`+k = NaN` → el log de `marca_alta_tabla` siempre tiene `idx: NaN, name: null`.

**Impacto**: solo afecta a los logs de diagnóstico enviados al webhook. No afecta
al marcado en sí. Las marcas se guardan correctamente aunque los logs muestren NaN.

---

### `app.js` — tres funciones de HTIryo que no existen

`app.js` referencia estas tres funciones de `window.HTIryo` que **no están definidas**
en el API de horario.html:

| Función referenciada | En app.js línea | Guarda antes de llamar | Efecto de su ausencia |
|---|---|---|---|
| `HTIryo.showService(num)` | app:152 | `typeof HTIryo.showService === 'function'` | Click en "Abrir en horario" desde Registro no funciona |
| `HTIryo.getStopDelays()` | app:187 | `!window.HTIryo.getStopDelays` | Retrasos GPS no se sincronizan al Registro |
| `HTIryo.getActiveLegInfo()` | app:246 | `typeof HTIryo.getActiveLegInfo === 'function'` | Transversal Atocha: no detecta tramo activo |

---

## 12. INVESTIGACIÓN: MARCADO A POSTERIORI EN SERVICIO 6203 (Valencia→Madrid) — 2026-06-27

### Resumen del hallazgo

**Síntoma**: Servicio 6203 (Valencia-Joaquín Sorolla → Madrid-Chamartín) marcaba las paradas entre Valencia y Requena con **retraso de 24–55 segundos** después del teórico, aunque sin pérdida de GPS. La misma estación (ej. CHIVA) se marcaría a tiempo en sentido Madrid→Valencia.

**Root cause identificada**: Mecanismo de protección `geo_defer` que espera al mínimo CPA (Closest Point of Approach), pero ese mínimo se alcanza **tardíamente** cuando la geometría y coordenadas de la estación están desplazadas de la vía real y el tren se aproxima desde el lado opuesto.

---

### Datos del log NDJSON (iryo-6203-2026-06-27.ndjson)

Servicio: `6203 | VALENCIA-JOAQUIN SOROLLA→MADRID-CHAMARTIN-CLARA CAMP.`
Fecha: 2026-06-27 · Hora inicio: 19:54:00 (GPS) · Ruta: 101 estaciones + bifurcaciones

**Paradas analizadas (Valencia→Requena):**

| Parada | Índice | Teórico | Evento geo_defer | CPA detectado | Marca GPS | Retraso |
|---|---|---|---|---|---|---|
| **BIF. JESUS-AGUJA** | 1 | 19:56 | — | — | 19:56:03 | +3s (marginal) |
| **BIF. JESUS** | 2 | 19:56 | — | — | 19:56:03 | +3s (marginal) |
| **BIF. XATIVA** | 9 | 20:00 | 20:00:03 (distancia 70m) | 20:00:24 (dist 981m) | 20:00:24 | **+24s** ⚠️ |
| **PCA TORRENT** | 15 | 20:03 | 20:02:43 (distancia 57m) | 20:03:02 (dist 1406m) | 20:02 | ~0s ✓ |
| **CHIVA-A. V.** | 17 | 20:05 | 20:04:36 (distancia 363m) | 20:04:55 (dist 1057m) | 20:04:55 | **+55s** ⚠️ |
| **PCA BUÑOL** | 18 | 20:09 | 20:07:48 (distancia 1876m) | 20:09:33 `cpa-gap` (dist 9272m) | 20:08 | Tardío + GPS interrumpido |
| **SIETE AGUAS-A. V.** | 19 | 20:13 | 20:11:13 (distancia 937m) | (geo_defer → marca directa) | 20:11:13 | **−2m** adelantado |
| **PCA EL REBOLLAR** | 21 | 20:15 | (tras LTV wait) | 20:13:10 (dist 1330m) | 20:12 | **−3m** adelantado |

**Patrón observado**:
- Evento `geo_defer`: "geometría indica paso pero la distancia aún baja (N m); esperando mínimo CPA"
- Evento `cpa`: se dispara cuando la distancia ha vuelto a subir, confirmando el mínimo
- **Distancia al CPA: 900–1400m** (anormalmente grande para "paso")
- Las primeras paradas (JESUS, XATIVA) marcan tardío
- Tras aproximarse a Requena, el patrón invierte: marca **adelantada**
- **PCA BUÑOL**: GPS se pierde durante CPA (`cpa-gap`), marca incompleta

---

### Mecanismo técnico: `geo_defer` en gps-tracking.js

El flujo de detección en el GPS (gps-tracking.js:950–1050):

```js
// projectGps devuelve { passedOrigIdx, ... }
// que indica cuántas estaciones se pasaron por geometría
if(passedOrigIdx == gpsNextIdx && distM < 200){
  // Caso ideal: geometría confirma EXACTAMENTE la siguiente estación
  //    y está cerquita (<200m) → marcar inmediatamente
  mark(gpsNextIdx)
} else if(passedOrigIdx == gpsNextIdx && distM >= 200){
  // ⚠️ geo_defer: geometría dice que pasamos la siguiente,
  //    pero la distancia es GRANDE → esperar al mínimo CPA
  //    [evento: "geometría indica paso pero la distancia aún baja"]
  cpaUpdateHistory(distM)
  // En la siguiente lectura (30+ seg después):
} else if(cpa.passed){
  // CPA confirmó que la distancia subió desde su anterior mínimo
  // → marcar con timestamp del mínimo
  mark(gpsNextIdx, atMs=cpaMindAtMs)
}
```

**El problema**: cuando la coordenada de la estación está desplazada (ej. en el andén S1 pero mapeada 200m hacia el norte) **y el tren se aproxima desde el sur**, el `projectGps` lo detecta "pasado" cuando aún está lejos. El GPS espera prudentemente al mínimo CPA, pero ese mínimo se alcanza **después de que el tren ha pasado la estación real** (porque la coordenada está adelantada).

---

### Hipótesis de offset de coordenadas

Evidencia directa del log:

1. **Valencia → Requena**: marca tardía (XATIVA +24s, CHIVA +55s, BUÑOL perdida de GPS)
   - Sentido: norte (aproximación desde el sur)
   - Patrón: geo_defer espera; CPA se detecta a 900–1400m

2. **Requena → Madrid** (observación post-Requena en el mismo log):
   - SIETE AGUAS: adelantado (−2m)
   - PCA EL REBOLLAR: adelantado (−3m)
   - Patrón invierte

**Causa probable**: las coordenadas de las paradas Valencia→Requena están desplazadas de la vía real en una dirección consistente. El tren que viene del sur las ve "delante" cuando en realidad aún no las alcanzó. En sentido opuesto (norte→sur), pasaría "antes" de la coordenada.

---

### Diferencia vs. HT-Iryo original

El documento HT_HISTORIA.md describe un mecanismo GPS **verificado en tren real** y sin este problema reportado. La diferencia en Iryo-Studio puede ser:

1. **Versión de datos.js (Libro de Horarios)**: ¿David usó coordenadas COORDS más nuevas o del repositorio original?
2. **Diferencias en LINES (geometrías LAV)**: ¿La polilínea de la ruta Valencia→Madrid está completa y precisa?
3. **Estado de la tablet**: ¿Receptor GPS con ligero sesgo sistémico?

---

### Cómo verificar la causa raíz

**Paso 1: Comparar con servicio 6183 (mismo sentido, otro día)**

Necesitamos los logs NDJSON del servicio 6183 (Valencia→Madrid):
- ¿Marca a posteriori en las mismas estaciones?
- ¿Misma distancia en los CPA?
- ¿Mismos eventos geo_defer?

Si sí → **causa geométrica/offset confirmada**.
Si no → **causa específica de la ruta/condiciones 6203**.

**Paso 2: Inspeccionar coordenadas vs. mapas reales**

En la tablet o en Chrome:
```js
// Ver coordenadas de XATIVA, CHIVA, TORRENT
const c = window.HTIryo.COORDS;
console.log({ 
  xativa: c["BIF. XATIVA"],
  chiva: c["CHIVA-A. V."],
  torrent: c["PCA TORRENT"]
});
// Comparar con Google Maps / OSM y ver si hay desplazamiento
```

**Paso 3: Inspeccionar LINES**

```js
// Ver si existe geometría real para Valencia→Madrid
const path = window.HTIryo.getPath(window.HTIryo.getMarch());
path.segments.forEach((seg, i) => {
  if(!seg.line) console.log(`Segmento ${i}: RECTA (sin geometría)`);
});
// Si la mayoría son rectas → falta LINES completo
```

---

### Mitigación (corto plazo)

**Opción 1: Reducir margen de geo_defer** (menos prudente)

Hoy: espera al CPA si `distM >= 200m`. 
Cambio: `if(distM >= 500m)` → aceptar CPA más rápidamente si está cerca.

**Riesgo**: falsos positivos si la vía hace una curva aguda (nudo Córdoba-Alcolea).

**Opción 2: Usar acelerómetro + GPS** (Fase 3 de PLAN-ACELEROMETRO)

El acelerómetro detectaría "tren frenando → aproximación a estación" independiente de GPS.
Combinado con CPA GPS, confirmaría el paso sin esperar un mínimo lejano.

**Opción 3: Marcar en `geo_defer` si la distancia empieza a bajar**

Hoy: espera al mínimo (distancia sube dos veces). 
Cambio: si `distM < 300m` en el evento geo_defer → marcar ya.

---

### Análisis Comparativo: 6203 vs 6183 (SEGUNDA LECTURA CRÍTICA)

Servicio 6183 (2026-06-26, Valencia→Madrid, mismo sentido que 6203):

| Parada | Índice | Teórico 6183 | CPA detectado | Marca 6183 | Retraso 6183 | vs. 6203 |
|---|---|---|---|---|---|---|
| **BIF. JESUS-AGUJA** | 1 | 17:58 | — | 17:58:29 | **+29s** tardío | 6203: +3s |
| **BIF. JESUS** | 2 | 18:00 | `cpa-gap` (134m) | 17:59:33 | **−27s** adelantado | 6203: +3s |
| **BIF. XATIVA** | 9 | 18:05 | (largo outage, loss 168s) | 18:03:48 | **−77s** adelantado | 6203: +24s ⚠️ |
| **PCA TORRENT** | 15 | 18:08 | 1168m | 18:06:32 | **−88s** adelantado | 6203: ~0s ✓ |
| **CHIVA-A. V.** | 17 | 18:10 | 943m | 18:08:25 | **−95s** adelantado | 6203: +55s ⚠️ |
| **PCA BUÑOL** | 18 | 18:13 | `cpa-gap` (10039m, loss 167s) | 18:10:ish | **−180s** adelantado | 6203: tardío |
| **SIETE AGUAS-A. V.** | 19 | 18:17 | 824m | 18:14:42 | **−138s** adelantado | 6203: −2m adelantado ✓ |

**HALLAZGO INVERSIVO CRÍTICO**:
- **6203**: marca **tardío** (+24s, +55s) en Valencia→Requena
- **6183**: marca **adelantado** (−77s, −95s, −138s) en **las mismas estaciones**

**La hipótesis de offset de coordenadas se DESCARTA**. Un offset geométrico afectaría ambos servicios igual. Aquí **el patrón es opuesto**.

**Hipótesis revisada**:
1. **Reloj de la tablet desincronizado o deriva temporal entre servicios**: 6203 va "lento" en tiempo, 6183 "rápido"
2. **Diferencia en hora de salida real vs teórica**: 6203 salió tarde, 6183 a tiempo
3. **Velocidad media diferente**: 6183 fue más rápido (menos tiempo entre estaciones), 6203 más lento

**Evidencia de velocidad**:
- 6203: velocidades típicas 70–81 m/s (252–292 km/h), viajó ~120 min
- 6183: velocidades típicas 75–82 m/s (270–295 km/h), viajó ~115 min
- 6203 fue **5–10 min más lento** en el tramo Valencia→Requena

**La diferencia no es geométrica. Es TEMPORAL**: 6203 acumuló retraso desde el inicio (reloj o salida); 6183 fue a tiempo o adelantado.

---

### Decisión de largo plazo

La causa raíz es **diferencia de tiempos entre servicios**, no geometría:

**Opción A — Revisar hora de salida real vs teórica en la tablet**
```
6203: ¿salida real > salida teórica (19:54)?
6183: ¿salida real ≈ salida teórica (17:57)?
```

**Opción B — Revisar sincronización NTP de la tablet**
Si la hora del dispositivo estaba desincronizada en 6203 (p.ej. 30s atrás), todas las marcas
GPS marcarían 30s tardío vs teórico, sin que sea un problema del GPS.

**Opción C — Revisar aceleración/frenada del tren real**
6203 pudo haber frenado más (retrasos por trenes anteriores, esperas en bifurcaciones).
6183 rodó rápido todo el tramo.

La mitigación es **no modificar gps-tracking.js**. El problema es externo (timing, condiciones de ruta).
El GPS detecta correctamente; solo acumula el retraso que el tren real lleva.

Las tres llamadas tienen guardas de existencia → no hay crash.
Pero las funcionalidades de cross-tab (Horario ↔ Registro) no operan completamente.

**No es un bug del marcado GPS** directamente. Es deuda pendiente de la integración
con el módulo de Registro.

---

### `app.js` — cross-feed delay sí llega a `_doDelayCrossfeed`

Aunque `getStopDelays` no existe, el event handler de `iryo:htDelaysChanged`
[app:202] sí existe. El problema es que nadie en horario.html dispara ese evento.

Búsqueda en horario.html: **`iryo:htDelaysChanged` no se despacha en ningún sitio**.
Igual con `iryo:legChanged`. Estos eventos están en el receptor (app.js) pero nadie
los emite → el cross-feed de retrasos es código muerto por ahora.

---

### `boxann.js` — boxann stops tienen `n: ''`

[boxann.js:7, hor:2944]: las filas de recuadro se crean con `n: ''` (nombre vacío).
```js
{ k: kc, n: '', _boxann: { v: def[0], g: def[1], x: def[2], a: kmA, b: kmB } }
```

`isMarkable()` en GPS requiere `s.n && API.COORDS[s.n]`.
Con `n = ''`: `s.n = ''` (falsy) → `isMarkable` devuelve `false` → el GPS nunca sigue boxann rows.
**Conflicto E' está protegido contra boxann.** Las ZN siguen siendo el único vector de riesgo.

---

### `renderRows` envuelto por LTV después del init — seguro

[hor:4833]:
```js
const _originalRenderRows = renderRows;
renderRows = function(){ _originalRenderRows(); /* + inyección filas LTV */ };
```

Cuando `handleLTVUpload` llama `renderRows()`:
1. `_originalRenderRows()` → `injectBoxAnns(march)` (idempotente: guard `__boxannDone`)
2. Se insertan filas `<tr class="ltv-row" data-ltv="NNNNNN">` **sin** `data-idx`
3. `applyPunches()` ignora filas sin `data-idx` en la TD → no hay interferencia con marcas GPS

Las filas LTV tampoco tienen `tr.dataset.idx` → `bind()` [hor:4168] las ignora:
```js
if(!tr.dataset.idx) return; // ignorar filas LTV
```
Seguro. La inyección LTV no corrompe índices GPS ni marcas existentes.

---

### `bind()` — click en filas CDI/ZN llama `punchAt`

En `renderRows` [hor:3178]: **todas** las filas `<tr>` reciben `tr.dataset.idx = idx`,
incluidas CDI/ZN/boxann.

En `bind()` [hor:4164-4172]:
```js
const tr = e.target.closest('tr'); if(!tr) return;
if(!tr.dataset.idx) return;  // ← solo filtra filas LTV (no tienen tr.dataset.idx)
punchAt(+tr.dataset.idx);    // ← CDI/ZN/boxann SÍ llegan aquí
```

Si alguien hace click en el área de una fila CDI/ZN, llama `punchAt(idx)`.
`punchAt` llama `setMarkAt` → guarda la marca.
`applyPunches` no la puede pintar (no hay `td.actual[data-idx]` para ese idx).

En la práctica, las filas CDI/ZN tienen `<td class="actual"></td>` sin botón visible
→ es difícil hacer click "útil" en ellas. Pero si el maquinista toca esa área en tablet,
se crea una marca invisible en localStorage. La marca persistiría en la sesión.

---

### `app-logger.js:isLastMarkableStation` — misma asimetría que `isMarkable`

```js
// app-logger.js:566
if(s.n && coords[s.n] && s.tm != null && !s._l010cdi) return false;
```

Misma exclusión incompleta: omite ZN y boxann (aunque boxann no importa porque `n = ''`).
Solo afecta a cuándo app-logger decide enviar el log automáticamente al terminar el servicio.
No afecta al marcado GPS.

---

## 12. EXPLICACIÓN SIMPLE CON EJEMPLOS

*(Para entender los problemas sin tecnicismos)*

---

### Cómo funciona el marcado en términos simples

Imagina que el libro de horario es una **hoja de papel** con columnas:
`Estación | KM | Hora teórica | Hora real`.

El GPS, cuando detecta que has pasado una estación, escribe un post-it con la hora en
un cajón oculto (`localStorage`). El label del post-it es `"CÓRDOBA|358.000"` (nombre+km).

Después de escribir en el cajón, el libro busca en la hoja de papel la celda con ese nombre
para pegar el post-it visible. **Si la celda no existe o no tiene etiqueta** (`data-idx`),
el post-it queda en el cajón para siempre. Desde fuera parece que el GPS no marcó nada.

---

### CONFLICTO E — El mapa tiene un camino equivocado (Córdoba)

**El problema, con ejemplo:**

El GPS sabe dónde estás (lat/lng). Para saber cuánto te falta para Alcolea, tiene que
proyectar tu posición sobre el camino teórico del tren.

El camino se construye así: para cada par de estaciones (Córdoba → Alcolea),
la app busca si tiene dibujada una carretera exacta entre ellas. Si no la tiene,
**traza una línea recta**.

En el nudo de Córdoba, la vía real hace una curva hacia el sur-este (ramal Málaga)
que no está en la línea recta entre Córdoba y Alcolea. El tren real puede estar a
**4-5 km de la línea recta**, aunque va por el camino correcto.

La app ve: "Este tren está a 4 km de la ruta teórica → debe estar en DESVÍO → no marco".

**Resultado:** el GPS no detecta el paso por Alcolea / BIF.Málaga y el libro se queda
sin marca en esa estación. El icono de posición se clava en Córdoba.

**FIX1 como red de seguridad:** si 3 lecturas seguidas muestran que te vas alejando de
Alcolea más de 400 metros (estás en el lado ya pasado), marca aunque la geometría falle.
Funciona pero la marca puede salir 1-2 minutos tarde.

**La solución definitiva:** añadir la geometría real de la bifurcación a los datos de
`LINES`. No es un bug de código, es un dato que falta.

---

### CONFLICTO E' — Marca guardada pero invisible (ZN)

**El problema, con ejemplo:**

Imagina que el horario tiene una fila especial: "ZONA NEUTRA LAV-010 km 250-260".
No es una estación comercial, es una señal técnica de la vía.

El GPS tiene una lista de qué filas seguir (`isMarkable`). La lista dice:
> "Sigue todas las filas que tienen nombre, coordenadas y hora teórica, EXCEPTO las
> que tengan la etiqueta `_l010cdi`".

Pero las filas de Zona Neutra tienen la etiqueta `_l010zn`, no `_l010cdi`.
Si una ZN tuviera nombre (p.ej. "ZN L010") y esa palabra estuviera en el mapa de
coordenadas, el GPS la seguiría.

Cuando el GPS detectara el paso por esa ZN, guardaría la marca en el cajón
(`localStorage["ZN L010|250.000"] = "12:35"`).

Luego el libro mira el DOM para pintar la marca. Pero la fila de ZN tiene una celda
sin etiqueta (`<td class="actual"></td>` sin `data-idx`). La búsqueda del libro dice:
"Sin etiqueta → ignoro esta celda".

**Resultado:** marca en el cajón, nada visible en pantalla.

**En la práctica:** las ZN típicamente tienen nombre vacío o técnico que no está en
el mapa de coordenadas → `isMarkable` devuelve `false` → el GPS ni siquiera lo intenta.
El riesgo existe en teoría pero probablemente no pasa en las marchas actuales.

**Para confirmar:** en la consola del navegador:
```js
window.HTIryo.getMarch().s.filter(s =>
  (s._l010zn || s._l030zn || s._l040zn || s._l042zn || s._l050zn)
  && s.n && window.HTIryo.COORDS[s.n] && s.tm != null
)
```
Si devuelve un array vacío → el riesgo no está activo. Si devuelve elementos → hay ZN marcables.

---

### GPS cuelga sin watchdog

**El problema, con ejemplo:**

El GPS está marcando bien. De repente, la tablet pierde la señal GPS (túnel, batería baja,
Android apaga el sensor). El GPS no llama a "Parar" porque no sabe que falló — simplemente
no recibe más lecturas.

El libro pregunta "¿está el GPS activo?" → `isTracking()` devuelve `true` → ok.
El GPS no marca porque no recibe coordenadas.
El FIX3 (marcar por el reloj) pregunta "¿está el GPS activo?" → `true` → no actúo.

**Resultado:** nadie marca nada. El maquinista ve el libro sin marcas pero tampoco
hay mensaje de error. Tiene que pulsar "Parar GPS" y "Iniciar GPS" para resetear.

**Lo que falta:** un watchdog. Si `isTracking()=true` pero no hay ninguna lectura GPS
en N minutos, el sistema debería:
1. Marcar el estado como "GPS colgado"
2. Activar FIX3 (marcar por hora) como fallback
3. Mostrar un aviso al maquinista

Hoy ese watchdog no existe.

---

### API incompleta: funciones prometidas pero no implementadas

**El problema, con ejemplo:**

`app.js` (el módulo de pestaña Registro) está preparado para llamar a:
- `HTIryo.showService(num)` — "muéstrame el servicio 6011 en el horario"
- `HTIryo.getStopDelays()` — "dame los retrasos actuales por parada"
- `HTIryo.getActiveLegInfo()` — "¿en qué tramo está el tren ahora?"

Pero `horario.html` nunca definió esas funciones en `window.HTIryo`.

`app.js` lo detecta antes de llamar (comprueba si la función existe) y simplemente
no hace nada. No hay error visible, solo funcionalidades silenciosamente inoperativas:
- Hacer click en "Ver en horario" desde el Registro no cambia la pestaña al tren correcto.
- Los retrasos marcados por GPS no se propagan automáticamente a la ficha del servicio.
- En servicios transversales (Atocha: dos tramos), no se detecta el tramo activo.

**No es el bug que impide las marcas.** Es trabajo pendiente de integración.

---

### Por qué el icono 📍 se queda pegado en la última estación

**El comportamiento esperado:**

Cuando el GPS sabe que el tren está entre Córdoba y Alcolea, **no puede fingir** que
el tren ya llegó a Alcolea. El retraso que muestra sería inventado.

La app hace esto intencionalmente: clava el icono en la última estación marcada (Córdoba)
y muestra el retraso real de esa estación hasta que sepa algo nuevo.

**Cuándo parece un bug:** si el GPS nunca detecta el paso por Alcolea (conflicto E),
el icono se queda en Córdoba **para siempre** en ese servicio. Es la consecuencia del
conflicto E, no un bug independiente.

---

### El logger de diagnóstico (app-logger.js)

La app tiene un sistema de diagnóstico que registra todo lo que hace el GPS y lo
envía a un servidor cuando el servicio termina. Hay un bug menor en cómo registra
los cambios de marca:

```
Cajón: "CÓRDOBA|358.000" = "12:35"
Logger intenta convertir la clave a número: +"CÓRDOBA|358.000" = NaN
Logger anota: { idx: NaN, name: null, hhmm: "12:35" }
```

Esto hace que los logs de diagnóstico tengan `idx: NaN` en lugar del índice correcto,
dificultando el diagnóstico a distancia. El marcado en sí no se ve afectado.

---

## 13. VERIFICACIÓN FINAL — Lista de comandos de consola

Ejecutar en el navegador con el horario cargado y el servicio activo:

```js
// 1. ¿Hay ZN actualmente markables por el GPS? (debería devolver [])
window.HTIryo.getMarch().s.filter(s =>
  (s._l010zn || s._l030zn || s._l040zn || s._l042zn || s._l050zn)
  && s.n && window.HTIryo.COORDS[s.n] && s.tm != null
)

// 2. ¿Qué ruta usa el GPS para esta marcha? ¿Hay segmentos con recta (line:null)?
JSON.stringify(window.HTIryo.getPath(window.HTIryo.getMarch()).map(
  seg => ({ from: seg.from, to: seg.to, line: seg.line || 'RECTA' })
))

// 3. ¿El DIAG GPS-005 detectó marcas no pintadas? (cellFound: false)
JSON.parse(localStorage.getItem('ebula_gpslog_v1') || '{}')

// 4. ¿trackingOn está activo?
JSON.parse(localStorage.getItem('ebula_v2') || '{}')

// 5. ¿Qué marcas hay guardadas en este servicio?
var tk = window.HTIryo.getTickKey();
JSON.parse(localStorage.getItem('ebula_punches_v2') || '{}')[tk]

// 6. ¿El GPS está rastreando ahora mismo?
window.HTIryo.isTracking()

// 7. ¿Cuál es la siguiente estación objetivo del GPS?
// (solo si gps-tracking.js expone estado interno, sino usar logs)
localStorage.getItem('ebula_gpslog_v1')
```
