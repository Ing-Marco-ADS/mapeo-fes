// ============================================================
// MAPEO FES - Logica principal (GPS, mapa, tracking, UI)
// ------------------------------------------------------------
// Usa el motor MotorTracking (motor_tracking.js) para suavizar
// el GPS, descartar picos y gestionar estados camino/libre.
// ============================================================

let posicionActual = null;
let sesion = null;
let sesionActiva = false;
let contadorPuntos = 0;
let intervaloTrack = null;
let puntoInicio = null;
let mapa = null;
let trackPolilinea = null;
let trackPuntos = [];
let marcaActual = null;

// Color seleccionado para las marcas (aplica al siguiente punto)
let colorActual = '#f59e0b';

// Punto en edicion (dialogo modal)
let puntoEnEdicion = null;

// Distancia minima (metros) entre puntos de tracking para evitar duplicados.
// 1 metro = captura detalle fino en giros y caminos estrechos.
const DISTANCIA_MINIMA_TRACK = 1;

// Intervalo de tracking en milisegundos (1s = ~1.4m a paso normal)
const INTERVALO_TRACK_MS = 1000;

// ==================== Tipos de puntos ====================
const tipos = {
    'banio': '\u{1F6BB} Bano',
    'biblioteca': '\u{1F4DA} Biblioteca',
    'edificio': '\u{1F3E2} Edificio',
    'acceso': '\u267F Acceso',
    'alarma': '\u{1F6A8} Alarma',
    'escaleras': '\u{1FA9C} Escaleras',
    'escalon': '\u2B07\uFE0F Escalon',
    'rampa': '\u2197\uFE0F Rampa',
    'reunion': '\u26D1\uFE0F Punto de reunion',
    'descanso': '\u2615 Lugar de descanso',
    'emergencia': '\u{1F6AA} Salida de emergencia',
    'entrada_salida': '\u{1F6AA} Entrada/Salida',
    'otro': '\u{1F4CC} Otro'
};

function generaID() {
    const ahora = new Date();
    return `sesion-${ahora.getFullYear()}${String(ahora.getMonth()+1).padStart(2,'0')}${String(ahora.getDate()).padStart(2,'0')}-${String(ahora.getHours()).padStart(2,'0')}${String(ahora.getMinutes()).padStart(2,'0')}${String(ahora.getSeconds()).padStart(2,'0')}`;
}

// ==================== Mapa ====================
function iniciarMapa(lat, lng) {
    if (mapa) {
        mapa.remove();
        mapa = null;
        trackPolilinea = null;
        trackPuntos = [];
    }
    mapa = L.map('mapa-rec').setView([lat, lng], 19);
    L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
        maxZoom: 20,
        detectRetina: true,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contribuidores, estilo <a href="https://www.openstreetmap.fr/">OSM Francia</a>'
    }).addTo(mapa);

    trackPolilinea = L.polyline([], {
        color: '#2196F3', weight: 4, opacity: 0.9
    }).addTo(mapa);

    const iconoActual = L.divIcon({
        className: 'marcador-actual',
        html: '<div style="width:16px;height:16px;background:#f44336;border:3px solid white;border-radius:50%;box-shadow:0 0 8px rgba(0,0,0,0.5)"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
    marcaActual = L.marker([lat, lng], {icon: iconoActual}).addTo(mapa);
}

// ==================== Configuracion de rastreo ====================
// MotorTracking (motor_tracking.js) se encarga del suavizado Kalman,
// descarte de picos y estados. Aqui solo lo orquestamos.
const PERMITE_ENCAJE = true;
// Distancia minima (m) antes de intentar encaje (ahorra cuota GraphHopper)
const UMBRAL_ENCAJE_M = 10;
let precisionGPS = 0;
let velocidadActual = 0;
let headingActual = 0;

// Instancia del motor inteligente de rastreo
const motorTracking = new MotorTracking.Motor();

// ==================== GPS ====================
function iniciarGPS() {
    if (!navigator.geolocation) {
        document.getElementById('estado').textContent = 'GPS no disponible';
        return;
    }
    navigator.geolocation.watchPosition(
        (pos) => {
            const coords = pos.coords;
            posicionActual = coords;
            precisionGPS = coords.accuracy || 0;
            velocidadActual = coords.speed || 0;
            // Heading del dispositivo: puede ser null si el GPS no reporta
            // direccion (comun en algunos celulares Android al estar parado)
            headingActual = coords.heading || 0;

            actualizarIndicadorPrecision(coords.accuracy, coords.speed, coords.heading);

            if (coords.accuracy > 20) {
                document.getElementById('estado').textContent = `GPS: senal debil (~${Math.round(coords.accuracy)}m)`;
            } else if (coords.accuracy > 10) {
                document.getElementById('estado').textContent = `GPS: senal moderada (~${Math.round(coords.accuracy)}m)`;
            } else {
                document.getElementById('estado').textContent = `GPS: senal optima (~${Math.round(coords.accuracy)}m)`;
            }

            if (!mapa) {
                iniciarMapa(coords.latitude, coords.longitude);
            } else if (sesionActiva) {
                if (marcaActual) marcaActual.setLatLng([coords.latitude, coords.longitude]);
                if (mapa && !mapa._dragging) mapa.panTo([coords.latitude, coords.longitude]);
                actualizarRadioPrecision(coords.latitude, coords.longitude, coords.accuracy);
            }
        },
        (error) => {
            document.getElementById('estado').textContent = 'Error de GPS. Revisa tu ubicacion.';
            console.error('Error GPS:', error);
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000
        }
    );
}

// ==================== Radio de precision en el mapa ====================
let radioPrecision = null;
function actualizarRadioPrecision(lat, lng, accuracy) {
    if (!mapa || !accuracy) return;
    if (radioPrecision) {
        radioPrecision.setLatLng([lat, lng]);
        radioPrecision.setRadius(accuracy);
    } else {
        radioPrecision = L.circle([lat, lng], {
            radius: accuracy,
            color: '#3b82f6', fillColor: '#3b82f6',
            fillOpacity: 0.08, weight: 1, opacity: 0.3
        }).addTo(mapa);
    }
}

// ==================== Indicador de precision + estado del motor ====================
// Muestra en la barra inferior: GPS, velocidad, y estado de rastreo
function actualizarIndicadorPrecision(accuracy, speed, heading) {
    const el = document.getElementById('indicador-precision');
    if (!el) return;

    let color, texto;
    if (accuracy <= 5) { color = '#22c55e'; texto = `Excelente (~${Math.round(accuracy)}m)`; }
    else if (accuracy <= 10) { color = '#eab308'; texto = `Buena (~${Math.round(accuracy)}m)`; }
    else if (accuracy <= 20) { color = '#f97316'; texto = `Regular (~${Math.round(accuracy)}m)`; }
    else { color = '#ef4444'; texto = `Baja (~${Math.round(accuracy)}m)`; }

    el.style.background = color;
    el.innerHTML = `<span style="font-weight:700">GPS:</span> ${texto}`;

    if (speed && speed > 0) {
        const kmh = (speed * 3.6).toFixed(1);
        el.innerHTML += ` | <span style="font-weight:700">Vel:</span> ${kmh} km/h`;
    }

    if (sesionActiva) {
        const estado = motorTracking.estado;
        const emoji = estado === 'camino' ? '\u{1F7E2}' : estado === 'libre' ? '\u{1F7E0}' : '\u{1F535}';
        const label = estado === 'camino' ? 'En camino'
                    : estado === 'libre' ? 'Sin camino (GPS directo)'
                    : 'Iniciando...';
        const pct = Math.round(motorTracking.confianza * 100);
        el.innerHTML += ` | <span style="font-weight:700">${emoji} ${label}</span> (${pct}%)`;
    }
}

// ==================== Marcar puntos de interes ====================
function marcarPunto(tipo) {
    if (!posicionActual) { mostrarToast('Esperando senal GPS. Intenta de nuevo.'); return; }
    if (!sesionActiva) { mostrarToast('Presiona el boton de iniciar recorrido primero.'); return; }

    const dato = {
        tipo, lat: posicionActual.latitude, lng: posicionActual.longitude,
        descripcion: tipos[tipo], timestamp: new Date().toISOString(),
        sesion, color: colorActual
    };
    fetch('/api/punto', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(dato)
    })
    .then(r => r.json())
    .then(() => {
        contadorPuntos++;
        document.getElementById('contador').textContent = contadorPuntos;
        dibujarPuntoEnMapa(tipo, dato.lat, dato.lng, null, dato.color);
        mostrarToast(`${textoTipo(tipo)} marcado.`);
    })
    .catch(err => {
        respaldoAgregarPunto(dato);
        marcarPerdidaConexion();
        mostrarToast('Sin conexion. Guardado como respaldo local.');
        console.error(err);
    });
}

// Texto claro del tipo (sin emojis) para lectura por voz
function textoTipo(tipo) {
    const textos = {
        'banio': 'Bano', 'biblioteca': 'Biblioteca', 'edificio': 'Edificio',
        'acceso': 'Acceso', 'alarma': 'Alarma', 'escaleras': 'Escaleras',
        'escalon': 'Escalon', 'rampa': 'Rampa', 'reunion': 'Punto de reunion',
        'descanso': 'Lugar de descanso', 'emergencia': 'Salida de emergencia',
        'entrada_salida': 'Entrada/Salida', 'otro': 'Otro punto'
    };
    return textos[tipo] || 'Punto';
}

// ==================== Selector de color ====================
function seleccionarColor(color) {
    colorActual = color;
    const nombreColor = {
        '#f59e0b': 'ambar', '#ef4444': 'rojo', '#3b82f6': 'azul',
        '#22c55e': 'verde', '#a855f7': 'morado', '#f472b6': 'rosa',
        '#06b6d4': 'cian', '#ffffff': 'blanco'
    }[color] || 'ambar';
    document.getElementById('color-seleccionado').textContent = `Color actual: ${nombreColor}`;
    document.querySelectorAll('.color-chip').forEach(chip => {
        chip.classList.toggle('color-activo', chip.dataset.color === color);
    });
    mostrarToast(`Color para la siguiente marca: ${nombreColor}.`);
}

// ==================== Dibujar punto en el mapa ====================
function dibujarPuntoEnMapa(tipo, lat, lng, nombre, color) {
    if (!mapa) return;
    const coloresTipo = {
        'banio': '#29b6f6', 'biblioteca': '#ab47bc', 'edificio': '#66bb6a',
        'acceso': '#ffa726', 'alarma': '#ef5350', 'escaleras': '#0ea5e9',
        'escalon': '#d946ef', 'rampa': '#14b8a6', 'reunion': '#f97316',
        'descanso': '#84cc16', 'emergencia': '#dc2626',
        'entrada_salida': '#6366f1', 'otro': '#78909c'
    };
    const colorFinal = color || coloresTipo[tipo] || '#78909c';
    const etiqueta = nombre || tipos[tipo];
    const icono = L.divIcon({
        className: 'punto-marcado',
        html: `<div style="width:26px;height:26px;background:${colorFinal};border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>`,
        iconSize: [26, 26], iconAnchor: [13, 13]
    });
    L.marker([lat, lng], {icon: icono}).addTo(mapa).bindPopup(etiqueta);
}

// ==================== Iniciar / terminar recorrido ====================
function iniciarRecorrido() {
    if (!posicionActual) { mostrarToast('Esperando senal GPS. Intenta de nuevo.'); return; }
    sesion = generaID();
    sesionActiva = true;
    contadorPuntos = 0;
    puntoInicio = {
        lat: posicionActual.latitude, lng: posicionActual.longitude,
        hora: new Date().toLocaleTimeString()
    };
    document.getElementById('punto-inicio').textContent =
        `${puntoInicio.lat.toFixed(5)}, ${puntoInicio.lng.toFixed(5)} (${puntoInicio.hora})`;
    document.getElementById('contador').textContent = '0';
    document.getElementById('botones-puntos').classList.remove('oculto');
    document.getElementById('botones-puntos').setAttribute('aria-hidden', 'false');
    document.getElementById('inicio-sesion').classList.add('oculto');
    document.getElementById('inicio-sesion').setAttribute('aria-hidden', 'true');
    document.getElementById('btn-terminar').classList.remove('oculto');
    document.getElementById('btn-exportar').classList.add('oculto');
    iniciarTracking();
    mostrarToast('Recorrido iniciado. El GPS se encaja automaticamente a caminos cuando es confiable.');
}

function terminarRecorrido() {
    clearInterval(intervaloTrack);
    intervaloTrack = null;
    sesionActiva = false;
    document.getElementById('botones-puntos').classList.add('oculto');
    document.getElementById('botones-puntos').setAttribute('aria-hidden', 'true');
    document.getElementById('inicio-sesion').classList.remove('oculto');
    document.getElementById('inicio-sesion').setAttribute('aria-hidden', 'false');
    document.getElementById('btn-terminar').classList.add('oculto');
    document.getElementById('btn-exportar').classList.remove('oculto');
    mostrarToast('Recorrido terminado. Los datos quedaron guardados.');
}

// ==================== Respaldo local ====================
const CLAVE_RESPALDO = 'mapeo_fes_respaldo';
function respaldoLocal() {
    const actual = localStorage.getItem(CLAVE_RESPALDO);
    return actual ? JSON.parse(actual) : {puntos: [], tracks: []};
}
function respaldoAgregarPunto(dato) {
    const r = respaldoLocal();
    r.puntos.push(dato);
    if (r.puntos.length > 5000) r.puntos = r.puntos.slice(-5000);
    localStorage.setItem(CLAVE_RESPALDO, JSON.stringify(r));
}
function respaldoAgregarTrack(dato) {
    const r = respaldoLocal();
    r.tracks.push(dato);
    if (r.tracks.length > 5000) r.tracks = r.tracks.slice(-5000);
    localStorage.setItem(CLAVE_RESPALDO, JSON.stringify(r));
}
async function sincronizarRespaldo() {
    const r = respaldoLocal();
    if (r.puntos.length === 0 && r.tracks.length === 0) return;
    for (const dato of r.tracks.slice()) {
        try {
            await fetch('/api/track', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(dato)});
            r.tracks.shift();
        } catch (e) { break; }
    }
    localStorage.setItem(CLAVE_RESPALDO, JSON.stringify(r));
    for (const dato of r.puntos.slice()) {
        try {
            await fetch('/api/punto', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(dato)});
            r.puntos.shift();
        } catch (e) { break; }
    }
    localStorage.setItem(CLAVE_RESPALDO, JSON.stringify(r));
}

// ==================== Encaje a caminos peatonales ====================
// Llamamos a /api/snap con DOS puntos consecutivos del GPS. El servidor
// intenta GraphHopper; si falla, usa OSRM (gratuito, sin clave).
// El motor decide si el camino encajado es confiable.
let encajesUsados = 0;
const MAX_ENCAJES = 300;
let ultimoPuntoRaw = null;   // ultimo punto filtrado aceptado (extremo del tramo)
let ultimoPuntoCrudo = null; // ultima lectura CRUDA real del GPS (para medir avance)

// DRY: reutilizar la funcion de distancia del motor
const distanciaMetros = MotorTracking.geometria.distanciaMetros;

function encajarTramo(anterior, actual) {
    return fetch(`/api/snap?lat1=${anterior[0]}&lng1=${anterior[1]}&lat2=${actual[0]}&lng2=${actual[1]}`)
        .then(r => r.json())
        .catch(() => ({geometry: [anterior, actual], snapped: false}));
}

// Guarda un punto del track y lo dibuja en la polilinea
// coords       = coordenadas finales a guardar (encajadas o filtradas)
// coordsRaw    = coordenadas CRUDAS reales del GPS (SIEMPRE la lectura original)
// estadoMotor  = estado actual del motor (camino/libre/buscando)
// encajadoFlag = true si coords provienen de un encaje a camino (no del filtro)
async function guardarPuntoTrack(coords, coordsRaw, estadoMotor, encajadoFlag) {
    // Heading: usar el del dispositivo; si es null/cero, usar bearing del motor
    // que refleja la direccion del movimiento real (no la orientacion del cel)
    const bearing = (headingActual && headingActual > 0) ? headingActual : null;
    const headingFinal = bearing || (motorTracking.ultimoBearing != null ? motorTracking.ultimoBearing : null);

    const dato = {
        sesion, lat: coords[0], lng: coords[1], timestamp: new Date().toISOString(),
        lat_cruda: coordsRaw ? coordsRaw[0] : coords[0],
        lng_cruda: coordsRaw ? coordsRaw[1] : coords[1],
        precision: precisionGPS || null,
        velocidad: velocidadActual || null,
        heading: headingFinal,
        encajado: encajadoFlag ? 1 : 0,
        estado: estadoMotor || motorTracking.estado,
        confianza: motorTracking.confianza
    };
    try {
        await fetch('/api/track', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(dato)
        });
    } catch (e) {
        respaldoAgregarTrack(dato);
        marcarPerdidaConexion();
    }
    trackPuntos.push([coords[0], coords[1]]);
    if (trackPolilinea) trackPolilinea.setLatLngs(trackPuntos);
}

// Orquesta el encaje de un tramo:
// 1. Si no avanzamos >= UMBRAL_ENCAJE_M -> guardar crudo (ahorrar cuota)
// 2. Si el motor recomienda intentar y hay cuota -> encajar via GraphHopper/OSRM
// 3. El motor valida la desviacion -> decides camino/gps-crudo
// puntoCrudo = coordenadas REALES del GPS (antes del filtro Kalman)
async function procesarTramo(puntoActual, puntoCrudo) {
    if (!ultimoPuntoRaw) {
        await guardarPuntoTrack(puntoActual, puntoCrudo, motorTracking.estado, false);
        ultimoPuntoRaw = puntoActual;
        ultimoPuntoCrudo = puntoCrudo;
        return;
    }
    // El avance se mide entre CRUDOS reales (no filtrados) para no duplicar
    // ni perder desplazamiento por el suavizado del motor.
    const avance = distanciaMetros(ultimoPuntoCrudo[0], ultimoPuntoCrudo[1], puntoCrudo[0], puntoCrudo[1]);
    if (avance < UMBRAL_ENCAJE_M) {
        // Tramo corto: no encajamos para ahorrar cuota.
        // IMPORTANTE: informar al motor que NO hubo encaje para que su
        // maquina de estados siga avanzando (evita quedarse en "buscando" para siempre).
        motorTracking.evaluarEncaje(false, Infinity);
        await guardarPuntoTrack(puntoActual, puntoCrudo, motorTracking.estado, false);
        return;
    }
    let geometria = [puntoActual];
    const coordsCrudas = puntoCrudo;
    let usarEncaje = false;

    // Intentar encaje solo si el motor lo recomienda y hay cuota
    if (PERMITE_ENCAJE && encajesUsados < MAX_ENCAJES && motorTracking.debeIntentarEncaje()) {
        try {
            const res = await encajarTramo(ultimoPuntoRaw, puntoActual);
            const desviacion = (res.snapped && res.geometry && res.geometry.length)
                ? MotorTracking.geometria.desviacionMaxima(res.geometry, ultimoPuntoRaw, puntoActual)
                : Infinity;
            usarEncaje = motorTracking.evaluarEncaje(!!res.snapped, desviacion);
            if (usarEncaje) {
                encajesUsados++;
                geometria = res.geometry;
            }
        } catch (e) {
            motorTracking.evaluarEncaje(false, Infinity);
        }
    } else {
        // El motor no recomienda intentar o no hay cuota: aun asi informar
        // para que el contador de intentosLibre avance y eventualmente
        // el motor recupere el estado 'camino'.
        motorTracking.debeIntentarEncaje();
        motorTracking.evaluarEncaje(false, Infinity);
    }

    for (let i = 0; i < geometria.length; i++) {
        const coord = geometria[i];
        const ultimo = trackPuntos[trackPuntos.length - 1];
        if (ultimo && ultimo[0] === coord[0] && ultimo[1] === coord[1]) continue;
        await guardarPuntoTrack(coord, coordsCrudas, motorTracking.estado, usarEncaje);
    }
    ultimoPuntoRaw = puntoActual;
    ultimoPuntoCrudo = puntoCrudo;
}

// Tracking continuo: cada INTERVALO_TRACK_MS (~1s) lee la posicion GPS,
// la pasa por el motor (suavizado, picos, estados) y guarda el punto
// en el servidor.
function iniciarTracking() {
    trackPuntos = [];
    ultimoPuntoRaw = null;
    ultimoPuntoCrudo = null;
    encajesUsados = 0;
    motorTracking.reiniciar();
    if (trackPolilinea) trackPolilinea.setLatLngs([]);

    let procesando = false;
    intervaloTrack = setInterval(() => {
        if (posicionActual && !procesando) {
            // CRUDA real ANTES de filtrar: se usa para guardar lat_cruda
            // y para medir el avance real entre tramos.
            const crudo = [posicionActual.latitude, posicionActual.longitude];
            const resultado = motorTracking.procesar(
                crudo[0], crudo[1],
                posicionActual.accuracy, Date.now()
            );
            if (resultado.esPico) return; // descartado por motor
            const coord = [resultado.lat, resultado.lng];
            const dist = trackPuntos.length > 0
                ? distanciaMetros(trackPuntos[trackPuntos.length-1][0], trackPuntos[trackPuntos.length-1][1], coord[0], coord[1])
                : Infinity;
            if (dist >= DISTANCIA_MINIMA_TRACK || trackPuntos.length === 0) {
                procesando = true;
                procesarTramo(coord, crudo)
                    .catch(err => console.error('Error track:', err))
                    .finally(() => { procesando = false; });
            }
        }
    }, INTERVALO_TRACK_MS);
}

function exportar() { window.location.href = `/api/exportar?sesion=${sesion}`; }

// ==================== Dialogos ====================
function abrirDialogoNombre() {
    if (!posicionActual) { mostrarToast('Esperando senal GPS.'); return; }
    if (!sesionActiva) { mostrarToast('Presiona iniciar recorrido primero.'); return; }
    const dialogo = document.getElementById('dialogo-nombre');
    const input = document.getElementById('nombre-ubicacion');
    input.value = '';
    dialogo.classList.remove('oculto');
    dialogo.setAttribute('aria-hidden', 'false');
    input.focus();
}
function cerrarDialogoNombre() {
    const dialogo = document.getElementById('dialogo-nombre');
    dialogo.classList.add('oculto');
    dialogo.setAttribute('aria-hidden', 'true');
}
function guardarUbicacionNombrada() {
    const input = document.getElementById('nombre-ubicacion');
    const nombre = input.value.trim();
    if (!nombre) { mostrarToast('Escribe un nombre.'); input.focus(); return; }
    if (!posicionActual) { cerrarDialogoNombre(); mostrarToast('Esperando senal GPS.'); return; }
    cerrarDialogoNombre();
    const dato = {
        tipo: 'otro', lat: posicionActual.latitude, lng: posicionActual.longitude,
        descripcion: nombre, timestamp: new Date().toISOString(), sesion, color: colorActual
    };
    fetch('/api/punto', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(dato)})
    .then(r => r.json())
    .then(() => {
        contadorPuntos++;
        document.getElementById('contador').textContent = contadorPuntos;
        dibujarPuntoEnMapa('otro', dato.lat, dato.lng, nombre, dato.color);
        mostrarToast(`Ubicacion guardada: ${nombre}.`);
    })
    .catch(err => {
        respaldoAgregarPunto(dato);
        marcarPerdidaConexion();
        mostrarToast(`Sin conexion. "${nombre}" guardado como respaldo.`);
        console.error(err);
    });
}

// Teclado global: Escape cierra dialogos, Enter guarda
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !document.getElementById('dialogo-nombre').classList.contains('oculto')) {
        e.preventDefault(); guardarUbicacionNombrada();
    }
    if (e.key === 'Escape') {
        if (!document.getElementById('dialogo-nombre').classList.contains('oculto')) cerrarDialogoNombre();
        if (!document.getElementById('dialogo-confirmacion').classList.contains('oculto')) cerrarConfirmacion();
        if (!document.getElementById('dialogo-editar').classList.contains('oculto')) cerrarDialogoEditar();
    }
});

function mostrarToast(mensaje) {
    const toast = document.getElementById('toast');
    toast.textContent = mensaje;
    toast.classList.add('visible');
    clearTimeout(toast._temporizador);
    toast._temporizador = setTimeout(() => toast.classList.remove('visible'), 3000);
}

// ==================== Gestion de datos mapeados ====================
let borradoPendiente = null;

function cargarResumen() {
    fetch('/api/resumen')
        .then(r => r.json())
        .then(sesiones => {
            const lista = document.getElementById('lista-datos');
            const sinDatos = document.getElementById('sin-datos');
            lista.innerHTML = '';
            if (!sesiones || sesiones.length === 0) {
                sinDatos.style.display = 'block';
                document.getElementById('btn-borrar-todo').style.display = 'none';
                return;
            }
            sinDatos.style.display = 'none';
            document.getElementById('btn-borrar-todo').style.display = 'block';
            sesiones.forEach(s => {
                const item = document.createElement('div');
                item.className = 'item-dato';
                const fecha = nuevaFecha(s.sesion);
                const cabecera = document.createElement('div');
                cabecera.className = 'dato-cabecera';
                const nombre = document.createElement('span');
                nombre.className = 'dato-nombre';
                nombre.textContent = fecha;
                nombre.setAttribute('aria-label', `Sesion ${s.sesion}`);
                const btnBorrar = document.createElement('button');
                btnBorrar.type = 'button';
                btnBorrar.className = 'boton-borrar-item';
                btnBorrar.textContent = 'Borrar';
                btnBorrar.setAttribute('aria-label', `Borrar sesion ${s.sesion}`);
                btnBorrar.onclick = () => confirmarBorrarSesion(s.sesion);
                cabecera.appendChild(nombre);
                cabecera.appendChild(btnBorrar);
                const detalle = document.createElement('div');
                detalle.className = 'dato-detalle';
                detalle.textContent = `${s.puntos} puntos y un recorrido registrado`;
                const btnPuntos = document.createElement('button');
                btnPuntos.type = 'button';
                btnPuntos.className = 'boton-borrar-item btn-editar-punto';
                btnPuntos.textContent = 'Ver/editar puntos';
                btnPuntos.setAttribute('aria-label', `Ver puntos de ${s.sesion}`);
                btnPuntos.onclick = () => togglePuntosSesion(s.sesion, btnPuntos);
                const contPuntos = document.createElement('div');
                contPuntos.className = 'lista-puntos-sesion oculto';
                item.appendChild(cabecera);
                item.appendChild(detalle);
                item.appendChild(btnPuntos);
                item.appendChild(contPuntos);
                lista.appendChild(item);
            });
        })
        .catch(err => console.error('Error al cargar resumen:', err));
}

function nuevaFecha(sesion) {
    const m = sesion.match(/sesion-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
    if (!m) return sesion;
    return `Recorrido del ${m[3]}/${m[2]}/${m[1]} a las ${m[4]}:${m[5]} hrs`;
}

function mostrarConfirmacion(texto, accion) {
    borradoPendiente = accion;
    document.getElementById('texto-confirmar').textContent = texto;
    const dialogo = document.getElementById('dialogo-confirmacion');
    dialogo.classList.remove('oculto');
    dialogo.setAttribute('aria-hidden', 'false');
    document.getElementById('btn-confirmar-borrar').focus();
}
function cerrarConfirmacion() {
    borradoPendiente = null;
    const dialogo = document.getElementById('dialogo-confirmacion');
    dialogo.classList.add('oculto');
    dialogo.setAttribute('aria-hidden', 'true');
}
function confirmarBorrarSesion(s) { mostrarConfirmacion('Se borrara el recorrido. No se puede deshacer.', () => borrarSesion(s)); }
function confirmarBorrarTodo() { mostrarConfirmacion('Se borraran TODOS los datos. No se puede deshacer.', borrarTodo); }
function ejecutarBorrado() {
    if (borradoPendiente) { const accion = borradoPendiente; cerrarConfirmacion(); accion(); }
}
function borrarSesion(s) {
    fetch(`/api/sesion/${encodeURIComponent(s)}`, {method:'DELETE'}).then(r=>r.json())
    .then(()=>{ mostrarToast('Recorrido borrado.'); cargarResumen(); })
    .catch(err=>{ mostrarToast('Error al borrar.'); console.error(err); });
}
function borrarTodo() {
    fetch('/api/todo', {method:'DELETE'}).then(r=>r.json())
    .then(()=>{ mostrarToast('Todos los datos borrados.'); cargarResumen(); })
    .catch(err=>{ mostrarToast('Error al borrar.'); console.error(err); });
}

// ==================== Edicion de puntos ====================
function togglePuntosSesion(s, boton) {
    const cont = boton.nextElementSibling;
    if (cont.classList.contains('oculto')) {
        cargarPuntosSesion(s, cont);
        cont.classList.remove('oculto');
        boton.textContent = 'Ocultar puntos';
    } else {
        cont.classList.add('oculto');
        boton.textContent = 'Ver/editar puntos';
    }
}
function cargarPuntosSesion(s, contenedor) {
    contenedor.innerHTML = '';
    fetch(`/api/puntos?sesion=${encodeURIComponent(s)}`)
        .then(r => r.json())
        .then(puntos => {
            if (!puntos || puntos.length === 0) { contenedor.textContent = 'Sin puntos marcados.'; return; }
            puntos.forEach(p => contenedor.appendChild(crearItemPunto(p)));
        })
        .catch(err => { contenedor.textContent = 'Error al cargar puntos.'; console.error(err); });
}
function crearItemPunto(p) {
    const fila = document.createElement('div');
    fila.className = 'punto-item';
    const texto = document.createElement('span');
    const bola = document.createElement('span');
    bola.className = 'punto-col';
    bola.style.background = p.color || '#000';
    texto.appendChild(bola);
    texto.appendChild(document.createTextNode(` ${p.descripcion}`));
    const acciones = document.createElement('div');
    acciones.className = 'dato-actions';
    const btnEditar = document.createElement('button');
    btnEditar.type = 'button'; btnEditar.className = 'btn-editar-punto';
    btnEditar.textContent = 'Editar'; btnEditar.onclick = () => abrirDialogoEditar(p);
    const btnEliminar = document.createElement('button');
    btnEliminar.type = 'button'; btnEliminar.className = 'btn-eliminar-punto';
    btnEliminar.textContent = 'Eliminar'; btnEliminar.onclick = () => eliminarPuntoConfirmar(p);
    acciones.appendChild(btnEditar); acciones.appendChild(btnEliminar);
    fila.appendChild(texto); fila.appendChild(acciones);
    return fila;
}
function abrirDialogoEditar(p) {
    puntoEnEdicion = p;
    document.getElementById('nombre-editar').value = p.descripcion;
    if (p.color) document.getElementById('color-editar').value = p.color;
    const dialogo = document.getElementById('dialogo-editar');
    dialogo.classList.remove('oculto');
    dialogo.setAttribute('aria-hidden', 'false');
    document.getElementById('nombre-editar').focus();
}
function cerrarDialogoEditar() {
    puntoEnEdicion = null;
    const dialogo = document.getElementById('dialogo-editar');
    dialogo.classList.add('oculto');
    dialogo.setAttribute('aria-hidden', 'true');
}
function guardarEdicionPunto() {
    if (!puntoEnEdicion) return;
    const id = puntoEnEdicion.id;
    const nombre = document.getElementById('nombre-editar').value.trim();
    const color = document.getElementById('color-editar').value;
    const tareas = [];
    // Actualizar color siempre (es rapido, sin costo extra)
    tareas.push(fetch(`/api/punto/${id}/color`, {
        method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({color})
    }));
    if (nombre && nombre !== puntoEnEdicion.descripcion) {
        tareas.push(actualizarDescripcion(id, nombre));
    }
    Promise.all(tareas)
    .then(()=>{ cerrarDialogoEditar(); mostrarToast('Punto actualizado.'); cargarResumen(); })
    .catch(err=>{ mostrarToast('Error al actualizar.'); console.error(err); });
}
function actualizarDescripcion(id, descripcion) {
    return fetch(`/api/punto/${id}/descripcion`, {
        method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({descripcion})
    });
}
function eliminarPuntoConfirmar(p) {
    mostrarConfirmacion(`Borrar "${p.descripcion}"? No se puede deshacer.`, () => {
        fetch(`/api/punto/${p.id}`, {method:'DELETE'}).then(r=>r.json())
        .then(()=>{ mostrarToast('Punto eliminado.'); cargarResumen(); })
        .catch(err=>{ mostrarToast('Error al eliminar.'); console.error(err); });
    });
}
function eliminarPuntoEdicion() {
    if (!puntoEnEdicion) return;
    const id = puntoEnEdicion.id;
    cerrarDialogoEditar();
    fetch(`/api/punto/${id}`, {method:'DELETE'}).then(r=>r.json())
    .then(()=>{ mostrarToast('Punto eliminado.'); cargarResumen(); })
    .catch(err=>{ mostrarToast('Error al eliminar.'); console.error(err); });
}

// ==================== Monitoreo de conexion ====================
let perdioConexion = false;
function verificarConexion() {
    fetch('/api/resumen', {cache:'no-store'}).then(r => {
        if (r.ok) {
            if (perdioConexion) {
                perdioConexion = false;
                document.getElementById('estado').textContent = 'Conexion restablecida';
                mostrarToast('Se recupero la conexion.');
                sincronizarRespaldo();
            }
        } else marcarPerdidaConexion();
    }).catch(() => marcarPerdidaConexion());
}
function marcarPerdidaConexion() {
    if (!perdioConexion) {
        perdioConexion = true;
        document.getElementById('estado').textContent = 'Sin conexion con el servidor';
        mostrarToast('Se perdio la conexion. Verifica que tu Mac este encendida y conectada.');
    }
}
function iniciarMonitoreo() { setInterval(verificarConexion, 10000); }

// ==================== Inicializacion ====================
iniciarGPS();
cargarResumen();
iniciarMonitoreo();
