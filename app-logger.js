/* HT Iryo — Log de diagnóstico de sesión (temporal, para pruebas).
 *
 * Sin invasión: no toca gps-tracking.js. Engancha por wrapping de
 * navigator.geolocation, navigator.wakeLock, localStorage.setItem y los
 * métodos públicos de window.HTIryo.
 *
 * Para desinstalar: borrar este archivo + 1 <meta> + 1 <script> en index.html
 * + 1 línea en sw.js. Cero código residual.
 */
(function(){
  'use strict';

  var LOG_KEY              = 'ebula_applog_v1';
  var TOSEND_KEY           = 'ebula_applog_tosend_v1';
  var WEBHOOK_URL          = 'https://hook.us2.make.com/ymy82plw4x1qks43kmfvhitkpbhnwrbm';
  var MAX_ENTRIES          = 6000;    // tope de entradas del log activo (blinda Barcelona–Atocha)
  var TRIM_TO              = 4800;    // al superar el tope, recorta a las últimas N (hysteresis)
  var PULSE_INTERVAL_MS    = 60000;   // 60 s entre pulsos de resumen GPS
  var ZOMBIE_TIMEOUT_MS    = 22000;   // watchdog zombie-call en getCurrentPosition
  var SIGNAL_LOST_THR_S    = 30;      // sin fix N segundos → signal_lost
  var GPS_GOOD_ACCURACY_M  = 50;      // por debajo → tipo 'gps'
  var GPS_CELL_ACCURACY_M  = 100;     // por encima → tipo 'cell'
  var PROV_STALE_MIN       = 10;      // retraso provisional sin cambiar N min → aviso

  // ---- Utilidades --------------------------------------------------------------
  function nowIso(){ return new Date().toISOString(); }
  function nowMs(){  return Date.now(); }
  function randId(){ return Math.random().toString(16).slice(2, 10); }
  // Fecha local "YYYY-MM-DD" (no UTC): evita clasificar como "día anterior" un
  // servicio de madrugada hora España que en UTC cae el día previo.
  function localDateStr(d){
    d = d || new Date();
    if(isNaN(d)) return null;
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    var dd = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  // ---- Meta versión ------------------------------------------------------------
  var sessionId = randId();
  var swVersion = 'unknown';
  try {
    var metaEl = document.querySelector('meta[name="ebula-version"]');
    if(metaEl && metaEl.getAttribute('content')) swVersion = metaEl.getAttribute('content');
  } catch(e){}

  // ---- Cuota de localStorage ---------------------------------------------------
  var quotaExceeded = false;

  // Caché en memoria del log activo: evita un JSON.parse del array completo en
  // CADA evento (antes el guardado era O(n²)). Se mantiene sincronizada con
  // localStorage, que se sigue escribiendo en cada append para no perder
  // durabilidad si Android mata la app. IMPORTANTE: toda limpieza de LOG_KEY
  // debe pasar por clearLogArr() para no dejar la caché desincronizada.
  var logArr = null;

  function loadLogArr(){
    if(logArr !== null) return logArr;
    try { logArr = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch(e){ logArr = []; }
    if(!logArr || logArr.constructor !== Array) logArr = [];
    return logArr;
  }

  function clearLogArr(){
    logArr = [];
    try { localStorage.removeItem(LOG_KEY); } catch(e){}
  }

  function appendEntry(level, cat, msg, data){
    try {
      var arr = loadLogArr();
      var entry = { ts: nowIso(), level: level, cat: cat, msg: msg };
      if(data != null) entry.data = data;
      arr.push(entry);
      if(arr.length > MAX_ENTRIES){ arr = arr.slice(-TRIM_TO); logArr = arr; }
      try {
        localStorage.setItem(LOG_KEY, JSON.stringify(arr));
        quotaExceeded = false;
      } catch(qe){
        if(!quotaExceeded){
          quotaExceeded = true;
          try { sessionStorage.setItem('ebula_quota_exceeded', '1'); } catch(e){}
          arr = arr.slice(-500); logArr = arr;
          try { localStorage.setItem(LOG_KEY, JSON.stringify(arr)); quotaExceeded = false; } catch(e){}
        }
      }
    } catch(e){}
  }

  var AppLogger = {
    log: appendEntry,
    clear: function(){ clearLogArr(); },
    getSessionId: function(){ return sessionId; }
  };
  window.AppLogger = AppLogger;

  // ---- Máquina de estados GPS --------------------------------------------------
  // Estados: idle | seeking | gps | cell | assisted | lost | stopped_watch | pre_window
  var gpsState   = 'idle';
  var gpsStateTs = nowMs();
  var timeInState = {};

  function setGpsState(newState, detail){
    if(newState === gpsState) return;
    var now = nowMs();
    var elapsed = now - gpsStateTs;
    timeInState[gpsState] = (timeInState[gpsState] || 0) + elapsed;
    var prev = gpsState;
    gpsState   = newState;
    gpsStateTs = now;
    appendEntry('info', 'gps', 'state_change', {
      from: prev, to: newState,
      elapsed_s: Math.round(elapsed / 100) / 10,
      detail: detail || undefined
    });
  }

  // ---- Batería -----------------------------------------------------------------
  var batteryLevel   = null;
  var batteryCharging = null;
  (function(){
    if(!navigator.getBattery) return;
    navigator.getBattery().then(function(b){
      batteryLevel   = Math.round(b.level * 100);
      batteryCharging = b.charging;
      b.addEventListener('levelchange',   function(){ batteryLevel   = Math.round(b.level * 100); });
      b.addEventListener('chargingchange',function(){ batteryCharging = b.charging; });
    }).catch(function(){});
  })();

  function getBattery(){
    if(batteryLevel === null) return undefined;
    return { pct: batteryLevel, charging: batteryCharging };
  }

  // ---- Tipo de conexión --------------------------------------------------------
  var connType = null;
  (function(){
    try {
      var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if(!conn) return;
      connType = conn.effectiveType || conn.type || null;
      conn.addEventListener('change', function(){
        connType = conn.effectiveType || conn.type || null;
        appendEntry('info', 'lifecycle', 'connection_change', { type: connType });
      });
    } catch(e){}
  })();

  // ---- Variables de estado GPS en sesión ---------------------------------------
  var wakelockActive  = false;
  var lastGpsTs       = null;   // nowMs() del último fix OK
  var _logSentForThisService = false; // evita doble envío (isLastMarkableStation + tracking_stop)
  var lastGpsCoords   = null;
  var lastFixType     = null;   // 'gps'|'cell'|'assisted'
  var consecutiveErrors = 0;
  var signalLostTs    = null;   // cuándo entramos en 'lost'
  var trackingStartTs = null;
  var ttffEmitted     = false;
  var lastGpsSpeed    = null;   // m/s del último fix fine — correlación con vibración (acelerómetro)

  // ---- Pulse (resumen cada 60 s) -----------------------------------------------
  var pulseWindow = [];
  var pulseTimer  = null;
  var markCountdown = 0;  // log N lecturas individuales post-marca / post-recovered

  // ---- Estadísticas de sesión --------------------------------------------------
  function resetStats(){
    return {
      total_fixes: 0, gps_fixes: 0, cell_fixes: 0, assisted_fixes: 0,
      errors: 0, zombie_calls: 0,
      signal_lost_count: 0, signal_lost_total_s: 0,
      min_accuracy_m: null, max_accuracy_m: null,
      ttff_s: null
    };
  }
  var sessionStats = resetStats();

  // ---- Control de retraso provisional estancado --------------------------------
  var lastProvChangeTs = null;
  var currentProv      = null;
  var provStaleWarned  = false;

  // ---- Clasificación de fix ---------------------------------------------------
  function getFixType(c){
    if(!c) return 'unknown';
    if(c.accuracy < GPS_GOOD_ACCURACY_M && (c.speed !== null || c.heading !== null)) return 'gps';
    if(c.accuracy > GPS_CELL_ACCURACY_M || (c.speed === null && c.heading === null))  return 'cell';
    return 'assisted';
  }
  function stateFromFixType(ft){
    if(ft === 'gps')  return 'gps';
    if(ft === 'cell') return 'cell';
    return 'assisted';
  }

  // ---- Motor de hipótesis (causa de pérdida de GPS) ---------------------------
  function lossHypothesis(){
    var ev  = [];
    var cause = 'receptor_sin_respuesta';
    var conf  = 'low';
    if(batteryLevel !== null && batteryLevel < 20 && !batteryCharging){
      ev.push('battery_low:' + batteryLevel + '%');
      cause = 'battery_throttle'; conf = 'medium';
    }
    if(document.hidden){
      ev.push('screen_hidden');
      if(!wakelockActive){
        ev.push('wakelock_inactive');
        cause = 'throttle_pantalla_apagada'; conf = 'high';
      } else {
        if(cause !== 'battery_throttle'){ cause = 'throttle_background'; conf = 'medium'; }
      }
    }
    if(consecutiveErrors > 0) ev.push('consecutive_errors:' + consecutiveErrors);
    if(lastFixType === 'cell'){
      ev.push('last_fix_was_cell');
      if(cause === 'receptor_sin_respuesta'){ cause = 'perdida_cobertura_celular'; conf = 'low'; }
    }
    return { cause: cause, confidence: conf, evidence: ev };
  }

  // ---- Signal lost / recovered -------------------------------------------------
  function checkSignalLost(){
    var states = { idle:1, lost:1, stopped_watch:1, pre_window:1 };
    if(states[gpsState]) return;
    if(!lastGpsTs) return;
    var elapsed = (nowMs() - lastGpsTs) / 1000;
    if(elapsed < SIGNAL_LOST_THR_S) return;
    signalLostTs = lastGpsTs;
    sessionStats.signal_lost_count++;
    setGpsState('lost');
    var hyp = lossHypothesis();
    appendEntry('warn', 'gps', 'signal_lost', {
      last_fix_s_ago: Math.round(elapsed),
      last_fix_type: lastFixType,
      hypothesis: hyp.cause,
      confidence: hyp.confidence,
      evidence: hyp.evidence,
      wakelock: wakelockActive,
      visible: !document.hidden,
      battery: getBattery(),
      consecutive_errors: consecutiveErrors
    });
  }

  function handleRecovery(fixType, c, latencyMs){
    if(gpsState !== 'lost') return;
    var outageS = signalLostTs ? Math.round((nowMs() - signalLostTs) / 1000) : null;
    sessionStats.signal_lost_total_s += (outageS || 0);
    appendEntry('info', 'gps', 'signal_recovered', {
      outage_s: outageS,
      new_fix_type: fixType,
      accuracy_m: c ? Math.round(c.accuracy) : null,
      call_latency_ms: latencyMs,
      battery: getBattery()
    });
    setGpsState(stateFromFixType(fixType), 'recovery');
    markCountdown = 3;
    signalLostTs = null;
  }

  // ---- Pulse emisor ------------------------------------------------------------
  function emitPulse(){
    if(!pulseWindow.length) return;
    var accList = pulseWindow.map(function(r){ return r.accuracy; }).filter(function(a){ return a != null; });
    var typeDist = {};
    for(var i = 0; i < pulseWindow.length; i++){
      var t = pulseWindow[i].fix_type || 'unknown';
      typeDist[t] = (typeDist[t] || 0) + 1;
    }
    appendEntry('info', 'gps', 'pulse', {
      n: pulseWindow.length,
      accuracy_m: {
        min: accList.length ? Math.round(Math.min.apply(null, accList)) : null,
        max: accList.length ? Math.round(Math.max.apply(null, accList)) : null,
        avg: accList.length ? Math.round(accList.reduce(function(s,a){ return s+a; },0)/accList.length) : null
      },
      fix_types: typeDist,
      gps_state: gpsState,
      wakelock: wakelockActive,
      visible: !document.hidden,
      battery: getBattery()
    });
    pulseWindow = [];
  }

  function startPulse(){ if(pulseTimer) clearInterval(pulseTimer); pulseTimer = setInterval(emitPulse, PULSE_INTERVAL_MS); }
  function stopPulse(){  if(pulseTimer){ clearInterval(pulseTimer); pulseTimer = null; } emitPulse(); }

  // ---- Acelerómetro: medición de vibración (FASE 1 — solo medir) ----------------
  // Objetivo: registrar el RMS de vibración junto a la velocidad GPS para calibrar
  // con datos reales el umbral parado/movimiento usable en túnel (sin GPS). NO
  // cambia el marcado. Ver PLAN-ACELEROMETRO.md.
  var ACCEL_EMIT_MS           = 20000;  // muestra agregada cada 20 s
  var ACCEL_TOUCH_COOLDOWN_MS = 4000;   // tras tocar la pantalla, standby N s (anti-ruido)
  var accelSupported = (typeof window.DeviceMotionEvent !== 'undefined');
  var accelOn        = false;
  var accelTimer     = null;
  var accelSamples   = [];   // magnitudes |a| de la ventana actual
  var accelIntervals = [];   // event.interval reportados (ms)
  var lastTouchTs    = 0;

  // Bloqueo por interacción: si se está tocando la tablet, las muestras son ruido.
  function accelInteracting(){ return (nowMs() - lastTouchTs) < ACCEL_TOUCH_COOLDOWN_MS; }
  ['pointerdown','pointermove','touchstart','touchmove','wheel','keydown'].forEach(function(evt){
    try { window.addEventListener(evt, function(){ lastTouchTs = nowMs(); }, { passive:true, capture:true }); } catch(e){}
  });

  function onDeviceMotion(ev){
    if(accelInteracting()) return;   // standby mientras se interactúa
    var a = ev.accelerationIncludingGravity;
    if(!a || a.x == null) return;
    var mag = Math.sqrt(a.x*a.x + a.y*a.y + a.z*a.z);
    accelSamples.push(mag);
    if(ev.interval) accelIntervals.push(ev.interval);
    if(accelSamples.length > 4000) accelSamples.shift();   // cap defensivo (60Hz·20s≈1200)
  }

  function emitAccelSample(){
    var n = accelSamples.length;
    var rms = null;
    if(n >= 5){
      var sum = 0, i; for(i=0;i<n;i++) sum += accelSamples[i];
      var mean = sum / n;
      var sq = 0; for(i=0;i<n;i++){ var d = accelSamples[i]-mean; sq += d*d; }
      rms = Math.sqrt(sq / n);
    }
    var avgInt = accelIntervals.length
      ? accelIntervals.reduce(function(s,v){ return s+v; },0)/accelIntervals.length : null;
    appendEntry('info', 'accel', 'vibracion', {
      rms: rms != null ? Math.round(rms*1000)/1000 : null,
      n: n,
      interval_ms: avgInt != null ? Math.round(avgInt*10)/10 : null,
      gps_speed_mps: lastGpsSpeed != null ? Math.round(lastGpsSpeed*10)/10 : null,
      gps_state: gpsState,
      standby: accelInteracting(),
      supported: accelSupported
    });
    accelSamples = []; accelIntervals = [];
  }

  function attachAccel(){
    if(accelOn) return;
    accelOn = true;
    window.addEventListener('devicemotion', onDeviceMotion);
    accelTimer = setInterval(emitAccelSample, ACCEL_EMIT_MS);
    appendEntry('info', 'accel', 'inicio', { supported: true });
  }

  function startAccel(){
    if(!accelSupported || accelOn) return;
    // iOS exige permiso en gesto de usuario; en Android no hace falta. Best-effort.
    try {
      if(typeof DeviceMotionEvent.requestPermission === 'function'){
        DeviceMotionEvent.requestPermission().then(function(st){
          if(st === 'granted') attachAccel();
          else appendEntry('warn', 'accel', 'permiso_denegado', {});
        }).catch(function(){ /* sin gesto: se reintentará en el próximo arranque */ });
      } else {
        attachAccel();
      }
    } catch(e){ try { attachAccel(); } catch(e2){} }
  }

  function stopAccel(){
    if(!accelOn) return;
    accelOn = false;
    window.removeEventListener('devicemotion', onDeviceMotion);
    if(accelTimer){ clearInterval(accelTimer); accelTimer = null; }
    emitAccelSample();   // volcar la última ventana
  }

  // ---- Manejadores de fix/error GPS -------------------------------------------
  function onGpsFix(pos, mode, callLatencyMs){
    try {
      var now    = nowMs();
      var c      = pos && pos.coords;
      var fixType = getFixType(c);
      var staleMs = (pos && pos.timestamp) ? (now - pos.timestamp) : null;
      var prevState  = gpsState;
      var fixTypeChanged = (fixType !== lastFixType);

      consecutiveErrors = 0;

      // TTFF: primer fix desde tracking_start
      if(!ttffEmitted && trackingStartTs){
        ttffEmitted = true;
        var ttffS = Math.round((now - trackingStartTs) / 100) / 10;
        sessionStats.ttff_s = ttffS;
        appendEntry('info', 'gps', 'ttff', {
          ttff_s: ttffS, fix_type: fixType,
          accuracy_m: c ? Math.round(c.accuracy) : null,
          call_latency_ms: callLatencyMs
        });
        setGpsState(stateFromFixType(fixType), 'first_fix');
      } else if(prevState === 'lost'){
        handleRecovery(fixType, c, callLatencyMs);
      } else if(prevState === 'seeking' || prevState === 'stopped_watch' || prevState === 'pre_window'){
        setGpsState(stateFromFixType(fixType), 'fix_after_' + prevState);
      } else if(fixTypeChanged && (prevState === 'gps' || prevState === 'cell' || prevState === 'assisted')){
        setGpsState(stateFromFixType(fixType), 'fix_type_change');
      }

      // Acumuladores
      lastGpsTs     = now;
      lastGpsCoords = c;
      lastFixType   = fixType;
      if(c && c.speed != null) lastGpsSpeed = c.speed;   // etiqueta de velocidad para el acelerómetro

      sessionStats.total_fixes++;
      if(fixType === 'gps')      sessionStats.gps_fixes++;
      else if(fixType === 'cell') sessionStats.cell_fixes++;
      else                        sessionStats.assisted_fixes++;
      if(c && c.accuracy != null){
        if(sessionStats.min_accuracy_m === null || c.accuracy < sessionStats.min_accuracy_m) sessionStats.min_accuracy_m = c.accuracy;
        if(sessionStats.max_accuracy_m === null || c.accuracy > sessionStats.max_accuracy_m) sessionStats.max_accuracy_m = c.accuracy;
      }

      // Añadir al pulso
      if(c) pulseWindow.push({ fix_type: fixType, accuracy: c.accuracy, ts: pos.timestamp });

      // Decidir si logear individualmente
      var logIndividual = fixTypeChanged ||
                          (markCountdown > 0) ||
                          (callLatencyMs !== null && callLatencyMs > 5000) ||
                          (staleMs !== null && staleMs > 3000);
      if(markCountdown > 0) markCountdown--;

      if(logIndividual){
        appendEntry('info', 'gps', 'lectura', {
          lat: c ? c.latitude  : null,
          lng: c ? c.longitude : null,
          accuracy_m: c ? Math.round(c.accuracy) : null,
          altitude_m: c ? c.altitude : null,
          heading:    c ? c.heading  : null,
          speed_mps:  c ? c.speed    : null,
          ts_gps:     pos ? pos.timestamp : null,
          stale_ms:   staleMs,
          fix_type:   fixType,
          mode:       mode,
          call_latency_ms: callLatencyMs,
          gps_state:  gpsState,
          fix_type_changed: fixTypeChanged || undefined
        });
      }
    } catch(e){}
  }

  function onGpsError(err, mode){
    try {
      consecutiveErrors++;
      sessionStats.errors++;
      appendEntry('warn', 'gps', 'error_lectura', {
        code:    err ? err.code : null,
        message: err ? String(err.message || '') : null,
        mode:    mode,
        consecutive: consecutiveErrors,
        gps_state: gpsState,
        wakelock: wakelockActive,
        visible: !document.hidden,
        battery: getBattery()
      });
    } catch(e){}
  }

  // ---- Handler de eventos internos de gps-tracking.js -------------------------
  function onGpsInternalEvent(tipo){
    if(tipo === 'parado' || tipo === 'ltv_wait'){
      setGpsState('stopped_watch', tipo);
    } else if(tipo === 'arranque' || tipo === 'cold_start'){
      setGpsState('seeking', tipo);
    } else if(tipo === 'cold_defer'){
      setGpsState('pre_window', tipo);
    }
  }

  // ---- Wrap navigator.geolocation ---------------------------------------------
  (function(){
    if(!navigator.geolocation) return;
    var geo = navigator.geolocation;

    var origGet = geo.getCurrentPosition.bind(geo);
    geo.getCurrentPosition = function(success, error, opts){
      var callTs  = nowMs();
      var settled = false;
      var zombie  = setTimeout(function(){
        if(settled) return;
        appendEntry('warn', 'gps', 'zombie_call', {
          elapsed_ms: nowMs() - callTs, gps_state: gpsState,
          wakelock: wakelockActive, visible: !document.hidden
        });
        sessionStats.zombie_calls++;
      }, ZOMBIE_TIMEOUT_MS);

      function wOk(pos){
        settled = true; clearTimeout(zombie);
        onGpsFix(pos, 'poll', nowMs() - callTs);
        if(typeof success === 'function') success(pos);
      }
      function wErr(err){
        settled = true; clearTimeout(zombie);
        onGpsError(err, 'poll');
        if(typeof error === 'function') error(err);
      }
      return origGet(wOk, wErr, opts);
    };

    var origWatch = geo.watchPosition.bind(geo);
    geo.watchPosition = function(success, error, opts){
      function wOk(pos){ onGpsFix(pos, 'watch', null); if(typeof success === 'function') success(pos); }
      function wErr(err){ onGpsError(err, 'watch');    if(typeof error   === 'function') error(err);   }
      return origWatch(wOk, wErr, opts);
    };
  })();

  // ---- Wrap navigator.wakeLock ------------------------------------------------
  (function(){
    if(!('wakeLock' in navigator) || !navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return;
    var origReq = navigator.wakeLock.request.bind(navigator.wakeLock);
    navigator.wakeLock.request = function(type){
      var p = origReq(type);
      p.then(function(wl){
        wakelockActive = true;
        appendEntry('info', 'lifecycle', 'wakelock_concedido', { type: type });
        try {
          wl.addEventListener('release', function(){
            wakelockActive = false;
            appendEntry('info', 'lifecycle', 'wakelock_liberado');
          });
        } catch(e){}
        return wl;
      }, function(err){
        appendEntry('warn', 'lifecycle', 'wakelock_denegado', {
          message: err ? String(err.message || err) : null
        });
      });
      return p;
    };
  })();

  // ---- Intercepción de ebula_gpslog_v1 (eventos internos de gps-tracking.js) --
  var gpslogLastSeen = {};  // tickKey → último índice procesado

  function extractGpsInternalEvents(newStr){
    var newObj = {};
    try { if(newStr) newObj = JSON.parse(newStr) || {}; } catch(e){}
    var keys = Object.keys(newObj);
    for(var i = 0; i < keys.length; i++){
      var tk      = keys[i];
      var entries = newObj[tk] || [];
      var lastSeen = gpslogLastSeen[tk] || 0;
      for(var j = lastSeen; j < entries.length; j++){
        var ev = entries[j];
        if(!ev) continue;
        appendEntry('info', 'gps_internal', ev.tipo || 'unknown', {
          detalle: ev.detalle || undefined,
          t_interno: ev.t || undefined,
          tickKey: tk
        });
        onGpsInternalEvent(ev.tipo);
      }
      gpslogLastSeen[tk] = entries.length;
    }
  }

  // ---- Wrap localStorage.setItem ----------------------------------------------
  var setMarkInProgress = false;
  (function(){
    var origSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function(key, value){
      var prev = null;
      if(key === 'ebula_punches_v2' && !setMarkInProgress){
        try { prev = localStorage.getItem(key); } catch(e){}
      }
      var r = origSet(key, value);
      if(key === 'ebula_punches_v2' && !setMarkInProgress){
        try {
          var diff = diffPunches(prev, value);
          if(diff){
            if(diff.type === 'reset'){
              appendEntry('info', 'accion_usuario', 'reset_punteo', { service: serviceInfo() });
            } else if(diff.type === 'alta'){
              appendEntry('info', 'accion_usuario', 'marca_alta_tabla', {
                idx: diff.idx, hhmm: diff.hhmm, name: stationName(diff.idx), service: serviceInfo()
              });
            } else if(diff.type === 'baja'){
              appendEntry('info', 'accion_usuario', 'marca_baja_tabla', {
                idx: diff.idx, name: stationName(diff.idx), service: serviceInfo()
              });
            }
          }
        } catch(e){}
      }
      if(key === 'ebula_gpslog_v1'){
        try { extractGpsInternalEvents(value); } catch(e){}
      }
      return r;
    };
  })();

  function diffPunches(oldStr, newStr){
    var oldObj = {}, newObj = {};
    try { if(oldStr) oldObj = JSON.parse(oldStr) || {}; } catch(e){}
    try { if(newStr) newObj = JSON.parse(newStr) || {}; } catch(e){}
    var tk = (serviceInfo() || {}).tickKey;
    if(!tk) return null;
    var oldP = oldObj[tk] || {}, newP = newObj[tk] || {};
    var oldKeys = Object.keys(oldP), newKeys = Object.keys(newP);
    if(oldKeys.length > 0 && newKeys.length === 0) return { type: 'reset' };
    for(var i = 0; i < newKeys.length; i++){
      var k = newKeys[i];
      if(newP[k] !== oldP[k]) return { type: 'alta', idx: +k, hhmm: newP[k] };
    }
    for(var j = 0; j < oldKeys.length; j++){
      var kk = oldKeys[j];
      if(!(kk in newP)) return { type: 'baja', idx: +kk };
    }
    return null;
  }

  // ---- Helpers HTIryo ---------------------------------------------------------
  function H(){ return window.HTIryo; }
  function serviceInfo(){
    try {
      var api = H();
      if(!api) return {};
      var m  = api.getMarch && api.getMarch();
      var tk = api.getTickKey && api.getTickKey();
      var info = { tickKey: tk || null };
      if(m){ info.t = m.t || null; info.o = m.o || null; info.d = m.d || null; }
      return info;
    } catch(e){ return {}; }
  }
  function stationName(idx){
    try {
      var m = H() && H().getMarch && H().getMarch();
      if(!m || !m.s || !m.s[idx]) return null;
      return m.s[idx].n || null;
    } catch(e){ return null; }
  }

  function isLastMarkableStation(idx){
    try {
      var api = H();
      var m = api && api.getMarch && api.getMarch();
      var coords = api && api.COORDS;
      if(!m || !m.s || !coords || idx < 0) return false; // sin coords → no enviar (fail-safe)
      for(var i = idx + 1; i < m.s.length; i++){
        var s = m.s[i];
        if(s.n && coords[s.n] && s.tm != null && !s._l010cdi) return false;
      }
      return true;
    } catch(e){ return false; }
  }
  function countMarks(arr){
    var n = 0;
    for(var i = 0; i < arr.length; i++) if(arr[i] && arr[i].cat === 'gps' && arr[i].msg === 'mark') n++;
    return n;
  }
  function getLogTickKey(arr){
    for(var i = 0; i < arr.length; i++){
      var d = arr[i] && arr[i].data;
      if(d && d.service && d.service.tickKey) return d.service.tickKey;
    }
    return null;
  }
  function getLogLastDate(arr){
    for(var i = arr.length - 1; i >= 0; i--){
      if(arr[i] && arr[i].ts) return localDateStr(new Date(arr[i].ts)); // ts es UTC → fecha local
    }
    return null;
  }

  // ---- Wrap HTIryo.setMark / setProvisionalDelay / logManualMark --------------
  function wrapHTIryo(){
    var api = H();
    if(!api) return false;

    if(typeof api.setMark === 'function' && !api.setMark.__alWrapped){
      var origSetMark = api.setMark;
      api.setMark = function(idx, hhmm, source){
        var gpsAgeS = lastGpsTs ? Math.round((nowMs() - lastGpsTs) / 100) / 10 : null;
        var isEst   = (source === 'est' || source === 'estimated');
        var dc = {
          idx: idx, hhmm: hhmm, source: source || 'gps',
          name: stationName(idx),
          service: serviceInfo(),
          gps_age_s: gpsAgeS,
          fix_type_at_mark: lastFixType,
          gps_state: gpsState,
          consecutive_errors: consecutiveErrors,
          wakelock: wakelockActive,
          visible: !document.hidden,
          battery: getBattery()
        };
        if(isEst){
          var hyp = lossHypothesis();
          dc.probable_cause    = hyp.cause;
          dc.evidence          = hyp.evidence;
          dc.app_behavior_correct = true;
        }
        appendEntry('info', 'gps', 'mark', dc);
        markCountdown = 2;
        setMarkInProgress = true;
        try { return origSetMark.apply(this, arguments); }
        finally {
          setMarkInProgress = false;
          setTimeout(function(){
            if(_logSentForThisService || !isLastMarkableStation(idx)) return;
            var _l; try { _l = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch(e){ _l = []; }
            if(countMarks(_l) < 5) return;
            if(snapshotToSend()) _logSentForThisService = true; // solo "enviado" si se encoló
            autoSend();
          }, 400);
        }
      };
      api.setMark.__alWrapped = true;
    }

    if(typeof api.setProvisionalDelay === 'function' && !api.setProvisionalDelay.__alWrapped){
      var origSPD  = api.setProvisionalDelay;
      var lastProv = undefined;
      api.setProvisionalDelay = function(min){
        var norm = (min == null) ? null : Math.round(min);
        if(norm !== lastProv){
          appendEntry('info', 'gps', 'retraso_provisional', {
            min: norm, prev: lastProv === undefined ? null : lastProv
          });
          lastProv         = norm;
          lastProvChangeTs = nowMs();
          currentProv      = norm;
          provStaleWarned  = false;
        }
        return origSPD.apply(this, arguments);
      };
      api.setProvisionalDelay.__alWrapped = true;
    }

    if(typeof api.logManualMark === 'function' && !api.logManualMark.__alWrapped){
      var origLMM = api.logManualMark;
      api.logManualMark = function(idx){
        appendEntry('info', 'accion_usuario', 'marca_manual_post_gps', {
          idx: idx, name: stationName(idx), service: serviceInfo()
        });
        return origLMM.apply(this, arguments);
      };
      api.logManualMark.__alWrapped = true;
    }

    if(typeof api.onMarchaChange === 'function' && !api.__alMarchaHooked){
      api.onMarchaChange(function(){
        appendEntry('info', 'accion_usuario', 'cambio_marcha', { service: serviceInfo() });
      });
      api.__alMarchaHooked = true;
    }
    return true;
  }

  function fullyWrapped(){
    var a = H();
    return !!(a && a.setMark && a.setMark.__alWrapped
              && a.setProvisionalDelay && a.setProvisionalDelay.__alWrapped
              && a.logManualMark && a.logManualMark.__alWrapped);
  }
  wrapHTIryo();
  if(!fullyWrapped()){
    var tries = 0;
    var wrapIv = setInterval(function(){
      tries++;
      wrapHTIryo();
      if(fullyWrapped() || tries > 50) clearInterval(wrapIv);
    }, 100);
  }

  // ---- Auto-envío al webhook --------------------------------------------------
  function arrToNdjson(arr){
    var lines = [];
    for(var i = 0; i < arr.length; i++){
      try { lines.push(JSON.stringify(arr[i])); } catch(e){}
    }
    return lines.join('\n');
  }

  // Devuelve true solo si capturó el log a TOSEND (false si ya había uno pendiente
  // o no había nada). El llamador usa el resultado para no marcar como "enviado"
  // un log que en realidad no llegó a encolarse.
  function snapshotToSend(){
    try {
      if(localStorage.getItem(TOSEND_KEY)) return false;
      // Garantizar el resumen ANTES de congelar el buffer: si el log se envía sin
      // pasar por tracking_stop (autoenvío en la última estación, recuperación,
      // vuelta de 'online'…), aún no hay session_summary. Se monta aquí con los
      // contadores en vivo para que el log salga completo siempre, se pulse parar
      // o no. emitSessionSummary es repetible sin doble-contar (reabre gpsStateTs).
      var arr = loadLogArr();
      if(!arr || !arr.length) return false;
      if(trackingStartTs && !arr.some(function(e){ return e.cat==='gps' && e.msg==='session_summary'; })){
        emitSessionSummary();
        arr = loadLogArr();   // recargar para incluir el resumen recién añadido
      }
      localStorage.setItem(TOSEND_KEY, arrToNdjson(arr));
      clearLogArr(); // invariante: log ya movido a TOSEND (resetea caché + LOG_KEY)
      return true;
    } catch(e){ return false; }
  }

  var _sending = false;
  function autoSend(){
    try {
      if(_sending) return; // evita dos fetch en vuelo con el mismo TOSEND
      var ndjson = localStorage.getItem(TOSEND_KEY);
      if(!ndjson) return;
      _sending = true;
      var lines = ndjson.split('\n').length;

      // Nombre de fichero con tren y fecha del primer entry
      var filename = 'iryo-log-' + new Date().toISOString().slice(0,10);
      try {
        var sample = ndjson.split('\n').slice(0,5);
        for(var si=0; si<sample.length; si++){
          var se = JSON.parse(sample[si]);
          if(se.data && se.data.service && se.data.service.t){
            filename = 'iryo-' + se.data.service.t + '-' + (se.ts||'').slice(0,10);
            break;
          }
        }
      } catch(e){}

      fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: filename + '.ndjson',
          data: ndjson,
          sentAt: new Date().toISOString(),
          entries: lines
        })
      }).then(function(res){
        _sending = false;
        if(res.ok){
          try { localStorage.removeItem(TOSEND_KEY); } catch(e){}
          appendEntry('info', 'log_send', 'ok', { entries: lines });
        } else {
          appendEntry('warn', 'log_send', 'http_error', { status: res.status });
        }
      }).catch(function(err){
        _sending = false;
        appendEntry('warn', 'log_send', 'fetch_error', {
          msg: err ? String(err.message || err) : null
        });
      });
    } catch(e){ _sending = false; }
  }

  // ---- Resumen de sesión al tracking_stop ------------------------------------
  function emitSessionSummary(){
    var now = nowMs();
    var durS = trackingStartTs ? Math.round((now - trackingStartTs) / 1000) : null;
    timeInState[gpsState] = (timeInState[gpsState] || 0) + (now - gpsStateTs);
    gpsStateTs = now;   // reabrir el contador: emitSessionSummary se puede llamar
                        // varias veces (al enviar el log Y al parar) sin doble-contar
    var stateS = {};
    for(var s in timeInState) stateS[s] = Math.round(timeInState[s] / 1000);
    appendEntry('info', 'gps', 'session_summary', {
      tracking_duration_s: durS,
      ttff_s: sessionStats.ttff_s,
      total_fixes: sessionStats.total_fixes,
      gps_fixes: sessionStats.gps_fixes,
      cell_fixes: sessionStats.cell_fixes,
      assisted_fixes: sessionStats.assisted_fixes,
      errors: sessionStats.errors,
      zombie_calls: sessionStats.zombie_calls,
      signal_lost_count: sessionStats.signal_lost_count,
      signal_lost_total_s: sessionStats.signal_lost_total_s,
      accuracy_m: {
        min: sessionStats.min_accuracy_m != null ? Math.round(sessionStats.min_accuracy_m) : null,
        max: sessionStats.max_accuracy_m != null ? Math.round(sessionStats.max_accuracy_m) : null
      },
      time_in_state_s: stateS,
      quota_exceeded: quotaExceeded || !!sessionStorage.getItem('ebula_quota_exceeded')
    });
  }

  // ---- Entrada de sesión -------------------------------------------------------
  function emitSessionEntry(extra){
    var data = {
      sessionId: sessionId,
      swVersion: swVersion,
      ua: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      online: navigator.onLine,
      conn: connType,
      screen: { w: (screen&&screen.width)||null, h: (screen&&screen.height)||null, dpr: window.devicePixelRatio||null }
    };
    if(extra) for(var k in extra) data[k] = extra[k];
    appendEntry('info', 'sesion', 'inicio', data);
  }
  emitSessionEntry();

  // ---- Errores JS y promesas no manejadas -------------------------------------
  var prevOnError = window.onerror;
  window.onerror = function(msg, src, line, col, err){
    appendEntry('error', 'js_error', String(msg), {
      src: src, line: line, col: col,
      stack: (err && err.stack) ? String(err.stack) : null
    });
    if(typeof prevOnError === 'function') try { return prevOnError.apply(this, arguments); } catch(e){}
    return false;
  };
  window.addEventListener('unhandledrejection', function(ev){
    var reason = ev && ev.reason;
    appendEntry('error', 'promise_rejection', reason ? String(reason) : 'unknown', {
      stack: (reason && reason.stack) ? String(reason.stack) : null
    });
  });

  // ---- Polling de isTracking --------------------------------------------------
  (function(){
    var last = null;
    var startupChecked    = false;
    var signalLostIv      = null;
    var provStaleIv       = null;

    setInterval(function(){
      try {
        var api = H();
        if(!api || typeof api.isTracking !== 'function') return;
        var t = !!api.isTracking();

        if(!startupChecked){
          startupChecked = true;
          if(localStorage.getItem(TOSEND_KEY)){
            autoSend();
          } else if(!t){
            // Señal de servicio = ≥5 marcas (más robusto que exigir un tracking_start,
            // que un servicio muy largo podría haber recortado del buffer).
            var _arr2;
            try { _arr2 = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch(e){ _arr2 = []; }
            var _prevDate  = getLogLastDate(_arr2);
            var _prevMarks = countMarks(_arr2);
            var _today     = localDateStr();
            if(_prevMarks >= 5 && _prevDate && _prevDate !== _today){
              appendEntry('info', 'log_send', 'recuperando_dia_anterior', { date: _prevDate, marks: _prevMarks });
              snapshotToSend();
              autoSend();
            }
            // mismo día: tracking_start decidirá según tickKey
          }
        }

        if(t !== last){
          if(t){
            // --- TRACKING START ---
            _logSentForThisService = false;
            var _prevArr; try { _prevArr = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch(e){ _prevArr = []; }
            var _prevTkInLog = getLogTickKey(_prevArr);
            var _prevDate    = getLogLastDate(_prevArr);
            var _curTkNow    = (H() && H().getTickKey) ? H().getTickKey() : null;
            var _todayStr    = localDateStr();
            if(_prevTkInLog && _curTkNow && _prevTkInLog === _curTkNow && _prevDate === _todayStr){
              // mismo servicio, mismo día → continuar acumulando en LOG_KEY existente
            } else {
              if(!localStorage.getItem(TOSEND_KEY) && countMarks(_prevArr) >= 5){
                snapshotToSend();
                autoSend();
              }
              clearLogArr();
            }
            var prevSid = sessionId;
            sessionId = randId();

            // Reset estado
            ttffEmitted       = false;
            trackingStartTs   = nowMs();
            consecutiveErrors = 0;
            lastGpsTs         = null;
            lastGpsCoords     = null;
            lastFixType       = null;
            signalLostTs      = null;
            pulseWindow       = [];
            markCountdown     = 0;
            gpsState          = 'idle';
            gpsStateTs        = nowMs();
            timeInState       = {};
            sessionStats      = resetStats();
            lastProvChangeTs  = null;
            currentProv       = null;
            provStaleWarned   = false;
            gpslogLastSeen    = {};

            emitSessionEntry({ reset_motivo: 'tracking_start', prevSessionId: prevSid });
            setGpsState('seeking', 'tracking_start');
            // Emite la ruta del servicio con coordenadas para el dashboard
            try {
              var march = H() && H().getMarch && H().getMarch();
              var coords = H() && H().COORDS;
              if(march && march.s && coords){
                var stList = [];
                for(var si=0; si<march.s.length; si++){
                  var st = march.s[si];
                  var co = coords[st.n];
                  stList.push({ idx:si, n:st.n, k:st.k||null, h:st.h||null,
                                lat:co?co[0]:null, lng:co?co[1]:null });
                }
                appendEntry('info','gps','tracking_route',{ stations:stList });
              }
            } catch(e){}
            appendEntry('info', 'gps', 'tracking_start', {
              service: serviceInfo(),
              nota:    (last === null) ? 'detectado_en_arranque' : undefined,
              conn:    connType,
              battery: getBattery()
            });
            startPulse();
            startAccel();   // FASE 1: medir vibración junto a la velocidad GPS

            if(signalLostIv) clearInterval(signalLostIv);
            signalLostIv = setInterval(checkSignalLost, 5000);

            if(provStaleIv) clearInterval(provStaleIv);
            provStaleIv = setInterval(function(){
              if(!currentProv || provStaleWarned || !lastProvChangeTs) return;
              if((nowMs() - lastProvChangeTs) > (PROV_STALE_MIN * 60 * 1000)){
                provStaleWarned = true;
                appendEntry('warn', 'gps', 'retraso_provisional_estancado', {
                  min: currentProv,
                  min_sin_cambio: PROV_STALE_MIN,
                  gps_state: gpsState,
                  battery: getBattery()
                });
              }
            }, 60000);

          } else if(last !== null){
            // --- TRACKING STOP ---
            stopPulse();
            stopAccel();
            if(signalLostIv){ clearInterval(signalLostIv); signalLostIv = null; }
            if(provStaleIv) { clearInterval(provStaleIv);  provStaleIv  = null; }

            var lastAgeS = lastGpsTs ? Math.round((nowMs() - lastGpsTs) / 100) / 10 : null;
            emitSessionSummary();
            setGpsState('idle', 'tracking_stop');
            appendEntry('info', 'gps', 'tracking_stop', {
              service: serviceInfo(),
              last_gps_age_s: lastAgeS,
              last_fix_type:  lastFixType,
              wakelock_at_stop: wakelockActive,
              visible_at_stop:  !document.hidden,
              battery: getBattery(),
              conn: connType
            });
            if(!_logSentForThisService){
              var _cur; try { _cur = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch(e){ _cur = []; }
              if(countMarks(_cur) >= 5){ snapshotToSend(); autoSend(); }
            }
          }
          last = t;
        }
      } catch(e){}
    }, 2000);
  })();

  // ---- Ciclo de vida ----------------------------------------------------------
  document.addEventListener('visibilitychange', function(){
    var tracking = false;
    try { tracking = !!(H() && H().isTracking && H().isTracking()); } catch(e){}
    appendEntry('info', 'lifecycle', 'visibility', { hidden: document.hidden, tracking: tracking });
  });
  window.addEventListener('online', function(){
    appendEntry('info', 'lifecycle', 'online', { conn: connType });
    autoSend();
  });
  window.addEventListener('offline', function(){
    appendEntry('info', 'lifecycle', 'offline');
  });

  // ---- Permiso GPS ------------------------------------------------------------
  (function(){
    if(!navigator.permissions || !navigator.permissions.query) return;
    try {
      navigator.permissions.query({ name: 'geolocation' }).then(function(p){
        var prev = p.state;
        appendEntry('info', 'gps_perm', 'estado_inicial', { state: prev });
        try { p.addEventListener ? p.addEventListener('change', onChange) : (p.onchange = onChange); }
        catch(e){ p.onchange = onChange; }
        function onChange(){
          appendEntry('info', 'gps_perm', 'cambio', { from: prev, to: p.state });
          prev = p.state;
        }
      }).catch(function(){});
    } catch(e){}
  })();
})();
