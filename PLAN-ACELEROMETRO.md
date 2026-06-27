# Plan: detección de movimiento por acelerómetro en túnel (sin GPS)

Documento de diseño. La **Fase 1 (medir)** se implementa ya; las fases siguientes
quedan descritas para decidirlas con datos reales, no a ojo.

## 1. Problema y límite de observabilidad

En túneles largos (p. ej. salida de Madrid-Chamartín → PCA Entrevías, ~9,8 km) no
hay GPS **ni cobertura celular**. La estimación de posición por horario o por
"última velocidad conocida" es **a ciegas (open-loop)**: funciona si el tren
circula como en el gráfico, pero **falla si dentro del túnel paran al tren**
(gráfico de trenes, falta de vía en Chamartín) **o lo meten a velocidad reducida**
por señalización. Con GPS solo, el móvil **no puede observar** ese parón/ralentí.

Conclusión honesta: **con GPS solo, es irresoluble.** Hace falta otra fuente.

## 2. La fuente que sí lo observa: el acelerómetro

Un tren en marcha **vibra**; uno parado **no**. El móvil puede distinguir
parado/movimiento **sin GPS ni cobertura**, solo con el acelerómetro
(`DeviceMotionEvent`). Referencias: SubwayPS (posicionamiento en metro), dead
reckoning ferroviario, detección de paradas de vehículo por acelerómetro.

Lo que el acelerómetro **sí** hace fiable: binario **parado vs. en movimiento**.
Lo que **no** hace fiable: velocidad exacta (integrar aceleración deriva rápido).
Tri-estado parado/lento/línea: posible por energía de vibración, pero aproximado
y dependiente de tren/vía/soporte.

## 3. Realidad de la API (verificado en MDN)

- `DeviceMotionEvent` expone `accelerationIncludingGravity` (universal),
  `acceleration` (puede ser `null` sin giroscopio), `rotationRate` e `interval`
  (ms reales entre muestras — se usa ese, no se asume frecuencia).
- **Requiere HTTPS** (contexto seguro). La app ya va en HTTPS. ✅
- **Permiso**: Android/Chrome (la tablet) no pide permiso; iOS exige
  `DeviceMotionEvent.requestPermission()` dentro de un **gesto de usuario** (por eso
  conviene pedirlo en el botón Inicio). Best-effort en el código.
- Se mide la **magnitud** `|a| = √(x²+y²+z²)` y su **RMS respecto a la media móvil**
  (la vibración), que es **independiente de la orientación** del soporte.

## 4. Calibración: auto-supervisada con el GPS como "verdad"

En vez de calibrar una vez (o cada día a mano), se calibra **en continuo** usando
los tramos con GPS, que son la mayoría del viaje:

- GPS `speed ≈ 0` (parada en estación) → actualiza el **suelo de vibración parado**.
- GPS `speed > V` → aprende la **firma de movimiento** (idealmente curva RMS↔vel).
- Al perder GPS (túnel) → clasifica con los umbrales aprendidos **minutos antes,
  en el mismo tren, soporte y día**.

Respuesta a "¿una vez o cada día?": **ninguna manual** — se recalibra solo en cada
parada y cada tramo con GPS. Las anclas del maquinista (app abierta = parado;
botón Inicio) sirven solo de **arranque (bootstrap)** hasta que llegan las primeras
etiquetas del GPS. (El botón Inicio NO es fiable como "movimiento": se suele pulsar
aún parado en el andén; por eso la verdad la pone el GPS, no el botón.)

## 5. Bloqueo por interacción táctil (anti-ruido)

Estando parado, el maquinista usa la tablet (mira el libro, rellena el registro…).
Tocar/mover la tablet mete **vibración falsa** que contaminaría el suelo de parado.
Por eso: **mientras se interactúa con la pantalla, se deja de medir (standby)**;
cuando se detecta que no se toca durante un margen, se vuelve a medir. Se detecta
con eventos de puntero/táctil; tras el último toque hay un **cooldown** antes de
reanudar.

Límite honesto: solo capta el toque en pantalla. Si se levanta la tablet del
soporte sin tocar la pantalla, no lo detecta — por eso el móvil debe ir **fijo**.

## 6. Fases

**Fase 1 — MEDIR (se implementa ahora, sin cambiar el marcado).**
Registrar en el log una muestra agregada `{ rms, n, interval_ms, gps_speed_mps,
gps_state, standby }`. **Cadencia adaptativa** para no inflar el log: el sensor se
mide siempre (es barato), pero se REGISTRA **ligero con GPS (cada 60 s)** —datos de
campo abierto redundantes— y **denso sin GPS (cada 15 s)**, que es el túnel donde el
dato importa. El acelerómetro gasta poco frente al GPS/pantalla ya activos, así que
el coste real es el tamaño de log, que esta cadencia mantiene bajo. Con varios viajes
(incluido el túnel de Chamartín) se ven los umbrales **reales** parado/movimiento y
se fijan con números. **Cero riesgo** para el marcado actual.

**Fase 2 — CLASIFICAR.** Con los umbrales medidos, un clasificador parado/movimiento
con ventana de confirmación (la literatura usa 8–22 s para "parado") e histéresis.

**Fase 3 — INTEGRAR (sin romper lo existente).**
- Añadir el acelerómetro como **segunda vía** para entrar/salir de PARADO cuando
  **no hay GPS** (rellena el hueco exacto del túnel; hoy salir de PARADO exige fix
  satelital que en el túnel no llega).
- Durante apagón GPS: acelerómetro=parado → congelar icono, no marcar;
  =movimiento → avanzar estimado por horario, marcado "estimado".
- La **marca definitiva** de las estaciones del túnel se **difiere a la salida**
  (el `catchUp` actual ya reconcilia con el GPS real). El acelerómetro solo evita
  que el icono derive mientras tanto.

## 7. Esquema de log de la Fase 1

Categoría nueva `accel`:
- `accel/inicio` `{ supported }` — al arrancar el seguimiento.
- `accel/permiso_denegado` `{}` — solo iOS, si se deniega.
- `accel/vibracion` `{ rms, n, interval_ms, gps_speed_mps, gps_state, standby, supported }`
  cada 60 s con GPS / 15 s sin GPS. `rms` = vibración (RMS de |a|−media);
  `standby=true` si la ventana se cerró tocando la pantalla (muestra a descartar).

## 8. Límites honestos (resumen)

- Velocidad reducida exacta: no. Binario parado/movimiento: sí.
- Requiere móvil **fijo** en soporte. Suelto = ruido.
- Umbrales dependen de tren/vía/soporte → calibración continua, no fija.
- Un sensor físico real nunca es el de papel: los umbrales se fijan con datos
  medidos (Fase 1), no por teoría.

## 9. Fuentes

- DeviceMotionEvent — MDN.
- SubwayPS (arXiv 1904.01675) — posicionamiento smartphone en metro.
- Classification Algorithms for Detecting Vehicle Stops from Smartphone
  Accelerometer Data.
- Dead-reckoning keeps train positioning on track — International Railway Journal.
- Zero motion detection for vehicle navigation (US5991692).
