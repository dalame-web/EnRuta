# Auditoría: LTV / Parado / Retraso

Análisis del código (solo lectura) de cómo la app trata el **retraso creciente**, el
estado **PARADO** y el **LTV**. Complementa `AUDITORIA-GPS-LIBRO.md`.

---

## 0. Aviso clave: "LTV" son DOS cosas distintas en el código

Primera fuente de confusión, así que se separa:

| | Qué es | Dónde | ¿Afecta al GPS/retraso? |
|---|---|---|---|
| **DHLTV** | Limitaciones de velocidad del PDF que se pintan en el libro | `horario.html` (`LTV_LIST`) | **No.** Solo visual |
| **`ltvWait`** | Heurística del GPS: "el tren está lejos cuando debería llegar; quizá una LTV lo frenó, no marco aún" | `gps-tracking.js` | **Sí**, bloquea el marcado |

Son **independientes**: `ltvWait` **no lee** el PDF. Toma el nombre de "LTV" porque
una limitación real produciría ese síntoma (tren lejos/lento), pero funciona solo por
**distancia**, no por el dato real de la LTV.

Objeto DHLTV (`horario.html:4432`): `{ line, codigo, trayecto, via, km_ini, km_fin,
vmax, motivo, observ }`.

---

## 1. Cómo trata el RETRASO que aumenta

El delta visible (`provisionalDelay`) se decide en `pollTick` (`gps-tracking.js:1206-1233`).
Con GPS y sin haber pasado aún la estación, hay **tres casos**:

1. **Va en hora** (`nowM ≤ eff`): `provisionalDelay = currentDelta()` → el icono queda
   "anclado" en la última marca, no avanza por reloj (`:1230`).
2. **Va tarde y SÍ se acerca** (distancia bajando): **no marca**;
   `provisionalDelay = currentDelta() + (ahora − previsto)` → *"Retraso creciendo:
   +X min · sin pasar aún"* (`:1223-1225`). Solo provisional; honesto, no finge el paso.
3. **Va tarde y NO se acerca** y venció `+giveup` (3-5 min): `estimateMark` → marca
   `est` (`:1219-1221`). Regla maestra: no dejar en blanco.

**Fórmula del retraso** (`:763`, `:525`): siempre *última marca real (`currentDelta`)
+ minutos extra sin pasar*. Nunca el delta crudo. Coherente en retraso provisional,
parado y estimación.

**Diagnóstico** (`app-logger.js`): cada cambio emite `retraso_provisional`; si lleva
**10 min sin cambiar** (`:23`, `:937`) emite `retraso_provisional_estancado` — aviso
de posible cuelgue.

---

## 2. Cómo decide que está PARADO

Detector "Bloque 4" (`gps-tracking.js:674-699`):

- **Entrada**: ≥3 lecturas finas "lentas" (velocidad ≤ **0,83 m/s ≈ 3 km/h**) durante
  **≥90 s** → `enterStoppedMode` (`:491`). Respaldo sin satélite: ≥3 lecturas celulares
  a <30 m entre sí durante 90 s.
- **Al entrar**: apaga el chip GPS, deja las **antenas** (`watchPosition`) escuchando,
  programa **verificación satelital cada 3 min**, y arranca el **contador de retraso
  cada 60 s** (`:512`).
- **Mientras PARADO**: se **bloquea TODO el marcado** (`estimateMark`, `catchUp`, CPA).
  El icono queda fijo en la última marca y el retraso **crece en pantalla** (`:519-530`).
- **Salida (arranque)**: antena detecta desplazamiento >50 m (2 callbacks, `:560`), **o**
  verificación satelital muestra >1 km o velocidad (`:662`), **o** una lectura fina con
  vel >3 km/h o >50 m.

`isStopped` tiene **prioridad máxima**: si está PARADO, `pollTick` hace `return` antes
de evaluar LTV/CPA (`:1074-1091`).

---

## 3. Cómo trata el LTV (`ltvWait`) — tren lejos

- **Disparo** (`:1131-1139`): al abrir la ventana, si la distancia a la estación > **5 km**
  (`LTV_FAR_THRESHOLD_M`) → `ltvWait=true`, *"esperando aproximación (posible LTV)"*.
- **Efecto**: bloquea `giveup`/`estimateMark` y CPA mientras esté lejos → **no marca
  `est` a la hora teórica** (evita marca falsa cuando una LTV retrasa de verdad).
  Mantiene el icono en la última marca.
- **Salida**: cuando la distancia baja de 5 km (`:1145`), o si `stronglyReceding`
  confirma que ya pasó alejándose (`:1197`).

---

## 4. Las tres guardas que suprimen el marcado

`isStopped`, `inDetour` y `ltvWait` son las tres condiciones que **bloquean** el
marcado estimado. Aparecen juntas en cada decisión: `:988`, `:1219`, `:1257`, `:1284`.
Coherente y deliberado: *no fabricar un paso cuando el tren está parado, desviado o lejos*.

---

## 5. Estimación de retraso por DHLTV: por qué es difícil (ETCS / LZB / balizas)

> Aportación del maquinista (dueño), capturada para diseño. No está implementado; es
> el motivo por el que **no basta** con leer los PK del PDF para estimar el retraso.

El DHLTV da PK nominales (`km_ini`, `km_fin`) y `vmax`. Pero **lo que el tren aplica
físicamente no coincide 1:1** con esos PK, por dos motivos encadenados:

1. **Refresco por balizas.** En líneas cuyo sistema refresca la información de velocidad
   **al pasar por balizas**, si la LTV cae **entre dos balizas**, el tren aplica la
   restricción en el **tramo entre balizas** (desde la baliza que la anuncia), no en los
   PK reales de la LTV. El maquinista **debe reducir la velocidad ANTES** de esa baliza.
   → La zona efectivamente restringida es **más amplia** que `[km_ini, km_fin]`.

2. **Sistema de señalización (ETCS vs LZB).** Según el sistema embarcado, los PK que el
   tren "ve" para la LTV son los **reales** o **más amplios**. La conversión PK-nominal →
   zona-aplicada **depende de la línea y su sistema**.

3. **Dinámica del tren.** No cambia de velocidad de golpe: **frena antes** del inicio y
   **acelera después** del final. El tiempo perdido se extiende por las **rampas** de
   deceleración/aceleración, más allá de la longitud nominal de la LTV.

**Consecuencia para cualquier estimador futuro de retraso por LTV:** usar solo
`[km_ini, km_fin]` y `vmax` **infravalora** el tiempo perdido. Un modelo fiel
necesitaría, como mínimo:
- el **sistema de señalización por línea** (ETCS L1/L2 o LZB),
- la **posición de las balizas** (para la zona efectiva cuando el refresco es por baliza),
- la **dinámica de frenado/aceleración** del tren (rampas).

Es **complejo y dependiente de datos** que el PDF DHLTV no contiene. Cualquier
implementación debe partir de datos **verificados por línea**, no de supuestos.

---

## 6. Riesgos y huecos (honestos)

**a) PARADO depende del GPS para entrar Y para salir.** En túnel (sin GPS ni antena)
no puede confirmar parado ni arranque. Si entró en PARADO antes del túnel, sale por
antena/satélite que **no llegan** dentro → puede quedar **congelado**. Es el hueco que
el **acelerómetro (Fase 1, `PLAN-ACELEROMETRO.md`)** viene a rellenar.

**b) `ltvWait` no tiene timeout.** Solo sale cuando la distancia baja de 5 km o
`stronglyReceding`. Si el tren queda retenido >5 km y se pierde el GPS, la estación no
se estima. Defendible (no inventar un paso visto a 5 km), pero es una decisión, no una
garantía de marcado.

**c) Umbral de parado bien calibrado.** 3 km/h durante 90 s = prácticamente detenido.
Una marcha reducida por señal (30-60 km/h) **no** dispara PARADO; solo el gateo
sostenido <3 km/h. Riesgo bajo.

**d) `ltvWait` y DHLTV desconectados.** La app **no** usa las LTV reales del PDF para
anticipar el retraso (ver §5: hacerlo bien es complejo). Hoy `ltvWait` actúa solo por
distancia.

---

## 7. Constantes clave

| Constante | Valor | Significado |
|---|---|---|
| `LTV_FAR_THRESHOLD_M` | 5000 m | Tren más lejos → `ltvWait` |
| `STOP_SPEED_MAX_MS` | 0,83 m/s (3 km/h) | Bajo esto = "lectura lenta" |
| `STOP_CONFIRM_MIN_MS` | 90 s | Lento sostenido → PARADO |
| `STOP_CONFIRM_MIN_READINGS` | 3 | Mínimo de lecturas lentas |
| `STOP_EXIT_DIST_M` | 50 m | Desplazamiento → arranque |
| `SAT_VERIFY_INTERVAL_MS` | 180 s | Verif satelital en PARADO |
| `SAT_VERIFY_EXIT_DIST_M` | 1000 m | Verif satelital > esto → arranque |
| `GIVEUP_MIN / MAX` | 3 / 5 min | Margen tras hora prevista → `est` |

---

## 8. Conclusión

El sistema es **coherente y conservador**: prioriza no fabricar pasos falsos (las tres
guardas), hace crecer el retraso de forma honesta, y separa bien parado/lejos/desviado.
El **único hueco real y grave** es el **(a)**: PARADO no puede observarse en túnel con
solo GPS — lo que el acelerómetro resuelve. La **estimación de retraso por DHLTV** (§5)
es deseable pero **compleja**: depende de ETCS/LZB, balizas y dinámica del tren; no se
puede hacer fiable solo con los PK del PDF. El resto son decisiones defendibles, no
errores.
