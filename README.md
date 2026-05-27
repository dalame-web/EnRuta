# Iryo-Studio

PWA unificada para maquinistas de Iryo (alta velocidad española).
Fusiona dos apps independientes en una sola:

- **HT-Iryo** — consulta del horario teórico, marcaje real por
  estación, GPS tracking, DHLTV.
- **RV-Iryo** — registro estructurado de turnos (jornadas laborales)
  con servicios, paradas, comprobaciones, observaciones, PMR,
  estadísticas y exportación PDF/HTML.

## Pestañas

1. **Horario** — marcha del tren seleccionado, paso real, GPS.
2. **Registro** — editor del turno actual.
3. **Calendario** — vista mensual + vista lista del histórico.
4. **Estadísticas** — métricas por rango de fechas.
5. **Ajustes** — apariencia, teléfono, ramas, libro de horarios,
   almacenamiento, exportar PDF (multi-select), copia, aplicación,
   borrar todo.

## Stack

- HTML + JavaScript vanilla (IIFE). Sin frameworks. Sin build.
- Service Worker network-first + `controllerchange` reload.
- localStorage como persistencia.
- Librerías de terceros vía CDN (Leaflet, pdf.js, jsPDF).

## Estado

⚠️ En desarrollo. Las dos apps originales (HT-Iryo y RV-Iryo) siguen
funcionando en paralelo. Iryo-Studio las sustituirá cuando sea
estable.

## Estructura del repo

Ver `HANDOFF.md` para el detalle exhaustivo.

## Para empezar a desarrollar

```bash
git clone https://github.com/dalame-web/Iryo-Studio.git
cd "Iryo Studio"
python -m http.server 8780
# Abrir http://localhost:8780
```

## Aviso legal

Herramienta no oficial. Su uso no sustituye la documentación oficial
de Iryo. Distribución fuera del ámbito interno prohibida.

## Autor

David Alameda Primo — `david.alameda01@gmail.com`.
