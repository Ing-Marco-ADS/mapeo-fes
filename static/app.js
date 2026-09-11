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

// Ejecutar pendiente de edicion de punto
let puntoEnEdicion = null;

const tipos = {
    'banio': '🚻 Baño',
    'biblioteca': '📚 Biblioteca',
    'edificio': '🏢 Edificio',
    'acceso': '♿ Acceso',
    'alarma': '🚨 Alarma',
    'escaleras': '🪜 Escaleras',
    'escalon': '⬇️ Escalón',
    'rampa': '↗️ Rampa',
    'reunion': '⛑️ Punto de reunión',
    'descanso': '☕ Lugar de descanso',
    'emergencia': '🚪 Salida de emergencia',
    'entrada_salida': '🚪 Entrada/Salida',
    'otro': '📌 Otro'
};

const iconosPuntos = {
    'banio': null,
    'biblioteca': null,
    'edificio': null,
    'acceso': null,
    'alarma': null,
    'otro': null
};

function generaID() {
    const ahora = new Date();
    return `sesion-${ahora.getFullYear()}${String(ahora.getMonth()+1).padStart(2,'0')}${String(ahora.getDate()).padStart(2,'0')}-${String(ahora.getHours()).padStart(2,'0')}${String(ahora.getMinutes()).padStart(2,'0')}${String(ahora.getSeconds()).padStart(2,'0')}`;
}

// Inicializar el mapa OpenStreetMap
function iniciarMapa(lat, lng) {
    if (mapa) {
        mapa.remove();
        mapa = null;
        trackPolilinea = null;
        trackPuntos = [];
    }

    mapa = L.map('mapa-rec').setView([lat, lng], 19);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 22,
        maxNativeZoom: 19,
        minZoom: 15,
        attribution: '&copy; OpenStreetMap'
    }).addTo(mapa);

    // Linea azul del recorrido
    trackPolilinea = L.polyline([], {
        color: '#2196F3',
        weight: 4,
        opacity: 0.9
    }).addTo(mapa);

    // Marcador del punto actual
    const iconoActual = L.divIcon({
        className: 'marcador-actual',
        html: '<div style="width:16px;height:16px;background:#f44336;border:3px solid white;border-radius:50%;box-shadow:0 0 8px rgba(0,0,0,0.5)"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
    marcaActual = L.marker([lat, lng], {icon: iconoActual}).addTo(mapa);
}

// ===== Configuracion de rastreo inteligente =====
// El encaje (GraphHopper) y el suavizado (Kalman 2D) se manejan con MotorTracking.
// El motor decide automaticamente cuando la ruta esta "en camino" o "fuera de
// camino" y jamas fuerza un encaje que se desvie demasiado del GPS crudo.
const PERMITE_ENCAJE = true;
// Distancia minima (m) que hay que avanzar antes de intentar un encaje, para
// no agotar la cuota de GraphHopper (se ahorra mucho y ademas da rutas mas limpias)
const UMBRAL_ENCAJE_M = 10;
// Radio de precision GPS actual (metros)
let precisionGPS = 0;
// Contador de lecturas GPS con baja precision
let lecturasBajaCalidad = 0;
// Ultima velocidad conocida (m/s)
let velocidadActual = 0;
// Heading actual (grados 0-360)
let headingActual = 0;

// Instancia del motor inteligente de rastreo
const motorTracking = new MotorTracking.Motor();

// Inicializar GPS con maxima precision
function iniciarGPS() {
    if (!navigator.geolocation) {
        document.getElementById('estado').textContent = 'GPS no disponible';
        return;
    }

    // Intentar obtener multiples constelaciones (GPS + GLONASS + Galileo)
    // via DeviceOrientationEvent si esta disponible
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().catch(() => {});
    }

    navigator.geolocation.watchPosition(
        (pos) => {
            const coords = pos.coords;
            posicionActual = coords;

            // Guardar metricas de precision
            precisionGPS = coords.accuracy || 0;
            velocidadActual = coords.speed || 0;
            headingActual = coords.heading || 0;

            // Actualizar indicador de precision en la UI
            actualizarIndicadorPrecision(coords.accuracy, coords.speed, coords.heading);

            // Detectar si la senal es buena o mala
            if (coords.accuracy > 20) {
                lecturasBajaCalidad++;
                document.getElementById('estado').textContent = `GPS: senal debil (~${Math.round(coords.accuracy)}m)`;
            } else if (coords.accuracy > 10) {
                lecturasBajaCalidad = 0;
                document.getElementById('estado').textContent = `GPS: senal moderada (~${Math.round(coords.accuracy)}m)`;
            } else {
                lecturasBajaCalidad = 0;
                document.getElementById('estado').textContent = `GPS: senal optima (~${Math.round(coords.accuracy)}m)`;
            }

            // Inicializar el mapa en la primera posicion del GPS
            if (!mapa) {
                iniciarMapa(coords.latitude, coords.longitude);
            } else if (sesionActiva) {
                if (marcaActual) {
                    marcaActual.setLatLng([coords.latitude, coords.longitude]);
                }
                if (mapa && !mapa._dragging) {
                    mapa.panTo([coords.latitude, coords.longitude]);
                }
                // Actualizar radio de precision en el mapa
                actualizarRadioPrecision(coords.latitude, coords.longitude, coords.accuracy);
            }
        },
        (error) => {
            document.getElementById('estado').textContent = 'Error de GPS. Revisa tu ubicacion.';
            console.error('Error GPS:', error);
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,       // No usar cache, siempre lectura fresca
            timeout: 5000        // Timeout mas corto para detectar problemas rapido
        }
    );
}

// Radio de precision en el mapa
let radioPrecision = null;
function actualizarRadioPrecision(lat, lng, accuracy) {
    if (!mapa || !accuracy) return;
    if (radioPrecision) {
        radioPrecision.setLatLng([lat, lng]);
        radioPrecision.setRadius(accuracy);
    } else {
        radioPrecision = L.circle([lat, lng], {
            radius: accuracy,
            color: '#3b82f6',
            fillColor: '#3b82f6',
            fillOpacity: 0.08,
            weight: 1,
            opacity: 0.3
        }).addTo(mapa);
    }
}

// Actualizar indicador de precision en la UI
// Incluye el estado del motor de rastreo (en camino / sin camino)
function actualizarIndicadorPrecision(accuracy, speed, heading) {
    const el = document.getElementById('indicador-precision');
    if (!el) return;

    let color, texto;
    if (accuracy <= 5) {
        color = '#22c55e';
        texto = `Excelente (~${Math.round(accuracy)}m)`;
    } else if (accuracy <= 10) {
        color = '#eab308';
        texto = `Buena (~${Math.round(accuracy)}m)`;
    } else if (accuracy <= 20) {
        color = '#f97316';
        texto = `Regular (~${Math.round(accuracy)}m)`;
    } else {
        color = '#ef4444';
        texto = `Baja (~${Math.round(accuracy)}m)`;
    }

    el.style.background = color;
    el.innerHTML = `<span style="font-weight:700">GPS:</span> ${texto}`;

    if (speed && speed > 0) {
        const kmh = (speed * 3.6).toFixed(1);
        el.innerHTML += ` | <span style="font-weight:700">Vel:</span> ${kmh} km/h`;
    }

    // Estado del motor de rastreo (si ya se inicio un recorrido)
    if (sesionActiva) {
        const emoji = motorTracking.estado === 'camino' ? '🟢'
                    : motorTracking.estado === 'libre' ? '🟠'
                    : '🔵';
        const label = motorTracking.estado === 'camino' ? 'En camino'
                    : motorTracking.estado === 'libre' ? 'Sin camino (GPS directo)'
                    : 'Iniciando...';
        const pct = Math.round(motorTracking.confianza * 100);
        el.innerHTML += ` | <span style="font-weight:700">${emoji} ${label}</span> (${pct}%)`;
    }
}

function marcarPunto(tipo) {
    if (!posicionActual) {
        mostrarToast('Esperando señal GPS. Inténtalo de nuevo.');
        return;
    }
    if (!sesionActiva) {
        mostrarToast('Presiona el botón de iniciar recorrido primero.');
        return;
    }

    const dato = {
        tipo: tipo,
        lat: posicionActual.latitude,
        lng: posicionActual.longitude,
        descripcion: tipos[tipo],
        timestamp: new Date().toISOString(),
        sesion: sesion,
        color: colorActual
    };

    fetch('/api/punto', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
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
        mostrarToast('Sin conexión. Se guardó como respaldo local.');
        console.error(err);
    });
}

// Texto claro del tipo (sin emojis) para leerlo bien por voz
function textoTipo(tipo) {
    const textos = {
        'banio': 'Baño',
        'biblioteca': 'Biblioteca',
        'edificio': 'Edificio',
        'acceso': 'Acceso',
        'alarma': 'Alarma',
        'escaleras': 'Escaleras',
        'escalon': 'Escalón',
        'rampa': 'Rampa',
        'reunion': 'Punto de reunión',
        'descanso': 'Lugar de descanso',
        'emergencia': 'Salida de emergencia',
        'entrada_salida': 'Entrada/Salida',
        'otro': 'Otro punto'
    };
    return textos[tipo] || 'Punto';
}

// ===== Selector de color de la marca =====
function seleccionarColor(color) {
    colorActual = color;
    const nombreColor = {
        '#f59e0b': 'ambar',
        '#ef4444': 'rojo',
        '#3b82f6': 'azul',
        '#22c55e': 'verde',
        '#a855f7': 'morado',
        '#f472b6': 'rosa',
        '#06b6d4': 'cian',
        '#ffffff': 'blanco'
    }[color] || 'ambar';
    document.getElementById('color-seleccionado').textContent = `Color actual: ${nombreColor}`;
    document.querySelectorAll('.color-chip').forEach(chip => {
        chip.classList.toggle('color-activo', chip.dataset.color === color);
    });
    mostrarToast(`Color para la siguiente marca: ${nombreColor}.`);
}

// ===== Encaje automatico e inteligente =====
// La geometria (distancia a segmento, desviacion maxima) y el suavizado Kalman
// viven en el motor `MotorTracking` (static/motor_tracking.js).


// Dibujar un punto marcado en el mapa (con un pin de color)
function dibujarPuntoEnMapa(tipo, lat, lng, nombre, color) {
    if (!mapa) return;

    const coloresTipo = {
        'banio': '#29b6f6',
        'biblioteca': '#ab47bc',
        'edificio': '#66bb6a',
        'acceso': '#ffa726',
        'alarma': '#ef5350',
        'escaleras': '#0ea5e9',
        'escalon': '#d946ef',
        'rampa': '#14b8a6',
        'reunion': '#f97316',
        'descanso': '#84cc16',
        'emergencia': '#dc2626',
        'entrada_salida': '#6366f1',
        'otro': '#78909c'
    };

    // Priorizar el color elegido por el usuario; si no hay, usar el del tipo
    const colorFinal = color || coloresTipo[tipo] || '#78909c';

    const etiqueta = nombre || tipos[tipo];
    const icono = L.divIcon({
        className: 'punto-marcado',
        html: `<div style="width:26px;height:26px;background:${colorFinal};border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
    });

    L.marker([lat, lng], {icon: icono}).addTo(mapa).bindPopup(etiqueta);
}

// Iniciar recorrido
function iniciarRecorrido() {
    if (!posicionActual) {
        mostrarToast('Esperando señal GPS. Inténtalo de nuevo en unos segundos.');
        return;
    }

    sesion = generaID();
    sesionActiva = true;
    contadorPuntos = 0;
    puntoInicio = {
        lat: posicionActual.latitude,
        lng: posicionActual.longitude,
        hora: new Date().toLocaleTimeString()
    };

    document.getElementById('punto-inicio').textContent = `${puntoInicio.lat.toFixed(5)}, ${puntoInicio.lng.toFixed(5)} (${puntoInicio.hora})`;
    document.getElementById('contador').textContent = '0';

    // Alternar visibilidad y aria-hidden de las secciones
    document.getElementById('botones-puntos').classList.remove('oculto');
    document.getElementById('botones-puntos').setAttribute('aria-hidden', 'false');
    document.getElementById('inicio-sesion').classList.add('oculto');
    document.getElementById('inicio-sesion').setAttribute('aria-hidden', 'true');
    document.getElementById('btn-terminar').classList.remove('oculto');
    document.getElementById('btn-exportar').classList.add('oculto');

    iniciarTracking();
    mostrarToast('Recorrido iniciado. El GPS se encaja automaticamente a los caminos cuando es confiable.');
}

// Terminar recorrido
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

// Distancia minima (metros) entre puntos de tracking para evitar duplicados
// Reducido a 1 metro para capturar mas detalle en giros y caminos estrechos
const DISTANCIA_MINIMA_TRACK = 1;

// Intervalo de tracking en milisegundos
// 1 segundo = captura cada ~1.4 metros a paso normal (mucho mas detalle)
const INTERVALO_TRACK_MS = 1000;

// Calcula la distancia en metros entre dos coordenadas (formula de Haversine)
function distanciaMetros(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const aLat = lat1 * Math.PI / 180;
    const aLng = lng1 * Math.PI / 180;
    const bLat = lat2 * Math.PI / 180;
    const bLng = lng2 * Math.PI / 180;
    const dLat = bLat - aLat;
    const dLng = bLng - aLng;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

let ultimoTrackGuardado = null;

// ===== Respaldo local (evita perder datos si falla la conexion) =====
const CLAVE_RESPALDO = 'mapeo_fes_respaldo';

function respaldoLocal() {
    const actual = localStorage.getItem(CLAVE_RESPALDO);
    return actual ? JSON.parse(actual) : {puntos: [], tracks: []};
}

function respaldoAgregarPunto(dato) {
    const respaldo = respaldoLocal();
    respaldo.puntos.push(dato);
    // Limitar para no llenar el almacenamiento
    if (respaldo.puntos.length > 5000) respaldo.puntos = respaldo.puntos.slice(-5000);
    localStorage.setItem(CLAVE_RESPALDO, JSON.stringify(respaldo));
}

function respaldoAgregarTrack(dato) {
    const respaldo = respaldoLocal();
    respaldo.tracks.push(dato);
    if (respaldo.tracks.length > 5000) respaldo.tracks = respaldo.tracks.slice(-5000);
    localStorage.setItem(CLAVE_RESPALDO, JSON.stringify(respaldo));
}

// Sincroniza los datos respaldados localmente con el servidor (cuando hay conexion)
async function sincronizarRespaldo() {
    const respaldo = respaldoLocal();
    if (respaldo.puntos.length === 0 && respaldo.tracks.length === 0) return;

    // Enviar en cadena para no saturar
    for (const dato of respaldo.tracks.slice()) {
        try {
            await fetch('/api/track', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(dato)
            });
            respaldo.tracks.shift();
        } catch (e) {
            break; // sin conexion, detener
        }
    }
    localStorage.setItem(CLAVE_RESPALDO, JSON.stringify(respaldo));

    for (const dato of respaldo.puntos.slice()) {
        try {
            await fetch('/api/punto', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(dato)
            });
            respaldo.puntos.shift();
        } catch (e) {
            break;
        }
    }
    localStorage.setItem(CLAVE_RESPALDO, JSON.stringify(respaldo));
}

// ---------- Encaje por tramos a caminos peatonales (automatico) ----------
// Llamamos a /api/snap con DOS puntos consecutivos del GPS. Si el servidor
// tiene clave de GraphHopper, devuelve la geometria de la ruta peatonal que
// une ambos puntos siguiendo los caminos; si no, devuelve los puntos crudos.
// El encaje SOLO se usa si el camino encajado no se desvia del GPS crudo.
let encajesUsados = 0;
const MAX_ENCAJES = 300; // limite por sesion para no agotar la cuota gratis
let ultimoPuntoRaw = null;

// Llama a GraphHopper encaja caminos
function encajarTramo(anterior, actual) {
    return fetch(`/api/snap?lat1=${anterior[0]}&lng1=${anterior[1]}&lat2=${actual[0]}&lng2=${actual[1]}`)
        .then(r => r.json())
        .then(d => d)
        .catch(() => ({geometry: [anterior, actual], snapped: false}));
}

// Guarda un punto del track en el servidor y lo dibuja en la linea
// coords = coordenadas a dibujar (encajadas o crudas)
// coordsCrudas = coordenadas GPS crudas (si se encajaron)
// estadoMotor = 'camino' | 'libre' | 'buscando' (confianza del encaje)
async function guardarPuntoTrack(coords, coordsCrudas, estadoMotor) {
    const dato = {
        sesion: sesion,
        lat: coords[0],
        lng: coords[1],
        timestamp: new Date().toISOString(),
        // Datos GPS crudos (siempre guardamos la posicion real del GPS)
        lat_cruda: coordsCrudas ? coordsCrudas[0] : coords[0],
        lng_cruda: coordsCrudas ? coordsCrudas[1] : coords[1],
        // Metricas de calidad
        precision: precisionGPS || null,
        velocidad: velocidadActual || null,
        heading: headingActual || null,
        encajado: coordsCrudas ? true : false,
        estado: estadoMotor || motorTracking.estado,
        confianza: motorTracking.confianza
    };
    try {
        await fetch('/api/track', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(dato)
        });
    } catch (e) {
        respaldoAgregarTrack(dato);
        marcarPerdidaConexion();
    }
    trackPuntos.push([coords[0], coords[1]]);
    if (trackPolilinea) {
        trackPolilinea.setLatLngs(trackPuntos);
    }
}

// Encaja el tramo entre el punto anterior CRUDO y el punto actual de forma
// AUTOMATICA e inteligente usando MotorTracking:
// 1. Si aun no avanzamos UMBRAL_ENCAJE_M, guardamos crudo sin gastar cuota.
// 2. Si la cuota lo permite y el motor dice que vale la pena, pedimos el encaje.
// 3. El motor mide la desviacion; si el camino se aleja >15m -> "fuera de camino".
// 4. Solo se usa el camino encajado cuando el estado es "camino".
// 5. Estando "fuera de camino" NUNCA se pega al camino mas cercano: se usa GPS crudo.
async function procesarTramo(puntoActual) {
    // El primer punto: guardarlo tal cual (no hay tramo anterior)
    if (!ultimoPuntoRaw) {
        await guardarPuntoTrack(puntoActual, null, motorTracking.estado);
        ultimoPuntoRaw = puntoActual;
        return;
    }

    // Mientras no hayamos avanzado lo suficiente, no encajamos: guardamos crudo.
    const avance = distanciaMetros(ultimoPuntoRaw[0], ultimoPuntoRaw[1], puntoActual[0], puntoActual[1]);
    if (avance < UMBRAL_ENCAJE_M) {
        await guardarPuntoTrack(puntoActual, null, motorTracking.estado);
        return;
    }

    let geometria = [puntoActual];
    let coordsCrudas = null;

    // Intentar encaje automatico SOLO si esta permitido, hay cuota y el motor lo recomienda
    if (PERMITE_ENCAJE && encajesUsados < MAX_ENCAJES && motorTracking.debeIntentarEncaje()) {
        try {
            const res = await encajarTramo(ultimoPuntoRaw, puntoActual);
            const desviacion = (res.snapped && res.geometry && res.geometry.length)
                ? MotorTracking.geometria.desviacionMaxima(res.geometry, ultimoPuntoRaw, puntoActual)
                : Infinity;

            const usarEncaje = motorTracking.evaluarEncaje(!!res.snapped, desviacion);

            if (usarEncaje) {
                encajesUsados++;
                geometria = res.geometry;
                coordsCrudas = puntoActual;
            }
        } catch (e) {
            motorTracking.evaluarEncaje(false, Infinity);
        }
    }

    // Omitir el primer punto de la geometria si coincide con el ultimo ya guardado
    for (let i = 0; i < geometria.length; i++) {
        const coord = geometria[i];
        const ultimo = trackPuntos[trackPuntos.length - 1];
        if (ultimo && ultimo[0] === coord[0] && ultimo[1] === coord[1]) {
            continue;
        }
        await guardarPuntoTrack(coord, coordsCrudas, motorTracking.estado);
    }
    ultimoPuntoRaw = puntoActual;
}

// Tracking continuo cada 1 segundo (maxima precision)
// La decision de suavizar (Kalman 2D), picos y estado camino/libre
// se delega al motor `MotorTracking` (motor_tracking.js).
function iniciarTracking() {
    // Limpiar linea anterior
    trackPuntos = [];
    ultimoTrackGuardado = null;
    ultimoPuntoRaw = null;
    encajesUsados = 0;
    lecturasBajaCalidad = 0;
    motorTracking.reiniciar();
    if (trackPolilinea) {
        trackPolilinea.setLatLngs([]);
    }

    let procesando = false;

    intervaloTrack = setInterval(() => {
        if (posicionActual && !procesando) {
            // El motor analiza el pico, suaviza y decide estado
            const resultado = motorTracking.procesar(
                posicionActual.latitude,
                posicionActual.longitude,
                posicionActual.accuracy,
                Date.now()
            );

            if (resultado.esPico) {
                return; // descartado por el motor (velocidad imposible)
            }

            const coord = [resultado.lat, resultado.lng];

            // Calcular distancia al ultimo punto guardado
            const dist = ultimoTrackGuardado
                ? distanciaMetros(ultimoTrackGuardado[0], ultimoTrackGuardado[1], coord[0], coord[1])
                : Infinity;

            // Guardar si nos movimos la distancia minima o si es el primer punto
            const debeGuardar = dist >= DISTANCIA_MINIMA_TRACK || trackPuntos.length === 0;

            if (debeGuardar) {
                ultimoTrackGuardado = coord;
                procesando = true;
                procesarTramo(coord)
                    .catch(err => console.error('Error track:', err))
                    .finally(() => { procesando = false; });
            }
        }
    }, INTERVALO_TRACK_MS);
}

function exportar() {
    window.location.href = `/api/exportar?sesion=${sesion}`;
}

// ===== Dialogo para nombrar una ubicacion =====
function abrirDialogoNombre() {
    if (!posicionActual) {
        mostrarToast('Esperando señal GPS. Inténtalo de nuevo.');
        return;
    }
    if (!sesionActiva) {
        mostrarToast('Presiona el botón de iniciar recorrido primero.');
        return;
    }

    const dialogo = document.getElementById('dialogo-nombre');
    const input = document.getElementById('nombre-ubicacion');
    input.value = '';
    dialogo.classList.remove('oculto');
    dialogo.setAttribute('aria-hidden', 'false');
    // Enfocar el campo para escribir
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

    if (!nombre) {
        mostrarToast('Escribe un nombre para la ubicación.');
        input.focus();
        return;
    }
    if (!posicionActual) {
        cerrarDialogoNombre();
        mostrarToast('Esperando señal GPS. Inténtalo de nuevo.');
        return;
    }

    cerrarDialogoNombre();

    const dato = {
        tipo: 'otro',
        lat: posicionActual.latitude,
        lng: posicionActual.longitude,
        descripcion: nombre,
        timestamp: new Date().toISOString(),
        sesion: sesion,
        color: colorActual
    };

    fetch('/api/punto', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(dato)
    })
    .then(r => r.json())
    .then(() => {
        contadorPuntos++;
        document.getElementById('contador').textContent = contadorPuntos;
        dibujarPuntoEnMapa('otro', dato.lat, dato.lng, nombre, dato.color);
        mostrarToast(`Ubicación guardada: ${nombre}.`);
    })
    .catch(err => {
        respaldoAgregarPunto(dato);
        marcarPerdidaConexion();
        mostrarToast(`Sin conexión. La ubicación "${nombre}" se guardó como respaldo local.`);
        console.error(err);
    });
}

// Permitir guardar con Enter en el campo del dialogo
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !document.getElementById('dialogo-nombre').classList.contains('oculto')) {
        e.preventDefault();
        guardarUbicacionNombrada();
    }
    if (e.key === 'Escape' && !document.getElementById('dialogo-nombre').classList.contains('oculto')) {
        cerrarDialogoNombre();
    }
    if (e.key === 'Escape' && !document.getElementById('dialogo-confirmacion').classList.contains('oculto')) {
        cerrarConfirmacion();
    }
    if (e.key === 'Escape' && !document.getElementById('dialogo-editar').classList.contains('oculto')) {
        cerrarDialogoEditar();
    }
});

function mostrarToast(mensaje) {
    const toast = document.getElementById('toast');
    toast.textContent = mensaje;
    toast.classList.add('visible');
    clearTimeout(toast._temporizador);
    toast._temporizador = setTimeout(() => toast.classList.remove('visible'), 3000);
}

// ===== Gestion de datos mapeados =====
let borradoPendiente = null;

function cargarResumen() {
    fetch('/api/resumen')
        .then(r => r.json())
        .then(sesiones => {
            const lista = document.getElementById('lista-datos');
            const sinDatos = document.getElementById('sin-datos');

            // Limpiar lista anterior
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
                nombre.setAttribute('aria-label', `Sesión ${s.sesion}`);

                const btnBorrar = document.createElement('button');
                btnBorrar.type = 'button';
                btnBorrar.className = 'boton-borrar-item';
                btnBorrar.textContent = 'Borrar';
                btnBorrar.setAttribute('aria-label', `Borrar sesión ${s.sesion}`);
                btnBorrar.onclick = () => confirmarBorrarSesion(s.sesion);

                cabecera.appendChild(nombre);
                cabecera.appendChild(btnBorrar);

                const detalle = document.createElement('div');
                detalle.className = 'dato-detalle';
                detalle.textContent = `${s.puntos} puntos de interés y un recorrido registrado`;

                const btnPuntos = document.createElement('button');
                btnPuntos.type = 'button';
                btnPuntos.className = 'boton-borrar-item btn-editar-punto';
                btnPuntos.textContent = 'Ver/editar puntos';
                btnPuntos.setAttribute('aria-label', `Ver y editar los puntos de ${s.sesion}`);
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

// Convierte el ID de sesion (sesion-AAAAmmdd-HHMMSS) a una fecha legible
function nuevaFecha(sesion) {
    const m = sesion.match(/sesion-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
    if (!m) return sesion;
    return `Recorrido del ${m[3]}/${m[2]}/${m[1]} a las ${m[4]}:${m[5]} hrs`;
}

// ---- Dialogo de confirmacion ----
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

function confirmarBorrarSesion(sesion) {
    mostrarConfirmacion('¿Seguro que quieres borrar este recorrido? No se puede deshacer.', () => borrarSesion(sesion));
}

function confirmarBorrarTodo() {
    mostrarConfirmacion('¿Seguro que quieres borrar TODOS los datos mapeados? Esto no se puede deshacer.', borrarTodo);
}

function ejecutarBorrado() {
    if (borradoPendiente) {
        const accion = borradoPendiente;
        cerrarConfirmacion();
        accion();
    }
}

function borrarSesion(sesion) {
    fetch(`/api/sesion/${encodeURIComponent(sesion)}`, {method: 'DELETE'})
        .then(r => r.json())
        .then(() => {
            mostrarToast('Recorrido borrado.');
            cargarResumen();
        })
        .catch(err => {
            mostrarToast('Hubo un error al borrar.');
            console.error(err);
        });
}

function borrarTodo() {
    fetch('/api/todo', {method: 'DELETE'})
        .then(r => r.json())
        .then(() => {
            mostrarToast('Todos los datos fueron borrados.');
            cargarResumen();
        })
        .catch(err => {
            mostrarToast('Hubo un error al borrar.');
            console.error(err);
        });
}

// ===== Edicion de puntos guardados =====
function togglePuntosSesion(sesion, boton) {
    const cont = boton.nextElementSibling;
    if (cont.classList.contains('oculto')) {
        cargarPuntosSesion(sesion, cont);
        cont.classList.remove('oculto');
        boton.textContent = 'Ocultar puntos';
    } else {
        cont.classList.add('oculto');
        boton.textContent = 'Ver/editar puntos';
    }
}

function cargarPuntosSesion(sesion, contenedor) {
    contenedor.innerHTML = '';
    fetch(`/api/puntos?sesion=${encodeURIComponent(sesion)}`)
        .then(r => r.json())
        .then(puntos => {
            if (!puntos || puntos.length === 0) {
                contenedor.textContent = 'Esta sesión no tiene puntos marcados.';
                return;
            }
            puntos.forEach(p => {
                contenedor.appendChild(crearItemPunto(p));
            });
        })
        .catch(err => {
            contenedor.textContent = 'Error al cargar los puntos.';
            console.error(err);
        });
}

function crearItemPunto(p) {
    const fila = document.createElement('div');
    fila.className = 'punto-item';

    const texto = document.createElement('span');
    const bola = document.createElement('span');
    bola.className = 'punto-col';
    bola.style.background = p.color || '#000';
    texto.appendChild(bola);
    const nombre = document.createTextNode(` ${p.descripcion}`);
    texto.appendChild(nombre);

    const acciones = document.createElement('div');
    acciones.className = 'dato-actions';

    const btnEditar = document.createElement('button');
    btnEditar.type = 'button';
    btnEditar.className = 'btn-editar-punto';
    btnEditar.textContent = 'Editar';
    btnEditar.onclick = () => abrirDialogoEditar(p);

    const btnEliminar = document.createElement('button');
    btnEliminar.type = 'button';
    btnEliminar.className = 'btn-eliminar-punto';
    btnEliminar.textContent = 'Eliminar';
    btnEliminar.onclick = () => eliminarPuntoConfirmar(p);

    acciones.appendChild(btnEditar);
    acciones.appendChild(btnEliminar);

    fila.appendChild(texto);
    fila.appendChild(acciones);
    return fila;
}

function abrirDialogoEditar(p) {
    puntoEnEdicion = p;
    document.getElementById('nombre-editar').value = p.descripcion;
    const selectColor = document.getElementById('color-editar');
    if (p.color) {
        selectColor.value = p.color;
    }
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

    // Cambiar nombre (descripcion) si cambio
    if (nombre && nombre !== puntoEnEdicion.descripcion) {
        tareas.push(fetch(`/api/punto/${id}/color`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({color})
        }));
        tareas.push(actualizarDescripcion(id, nombre));
    } else {
        tareas.push(fetch(`/api/punto/${id}/color`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({color})
        }));
    }

    Promise.all(tareas)
        .then(() => {
            cerrarDialogoEditar();
            mostrarToast('Punto actualizado.');
            cargarResumen();
        })
        .catch(err => {
            mostrarToast('Hubo un error al actualizar el punto.');
            console.error(err);
        });
}

// Endpoint auxiliar para actualizar el nombre/descripcion de un punto
function actualizarDescripcion(id, descripcion) {
    return fetch(`/api/punto/${id}/descripcion`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({descripcion})
    });
}

function eliminarPuntoConfirmar(p) {
    mostrarConfirmacion(`¿Borrar el punto "${p.descripcion}"? No se puede deshacer.`, () => {
        fetch(`/api/punto/${p.id}`, {method: 'DELETE'})
            .then(r => r.json())
            .then(() => {
                mostrarToast('Punto eliminado.');
                cargarResumen();
            })
            .catch(err => {
                mostrarToast('Hubo un error al eliminar.');
                console.error(err);
            });
    });
}

function eliminarPuntoEdicion() {
    if (!puntoEnEdicion) return;
    const id = puntoEnEdicion.id;
    cerrarDialogoEditar();
    fetch(`/api/punto/${id}`, {method: 'DELETE'})
        .then(r => r.json())
        .then(() => {
            mostrarToast('Punto eliminado.');
            cargarResumen();
        })
        .catch(err => {
            mostrarToast('Hubo un error al eliminar.');
            console.error(err);
        });
}

// Monitoreo de conexion con el servidor
let perdioConexion = false;

function verificarConexion() {
    fetch('/api/resumen', {cache: 'no-store'})
        .then(r => {
            if (r.ok) {
                if (perdioConexion) {
                    perdioConexion = false;
                    document.getElementById('estado').textContent = 'Conexión restablecida';
                    mostrarToast('Se recuperó la conexión.');
                    sincronizarRespaldo();
                }
            } else {
                marcarPerdidaConexion();
            }
        })
        .catch(() => marcarPerdidaConexion());
}

function marcarPerdidaConexion() {
    if (!perdioConexion) {
        perdioConexion = true;
        document.getElementById('estado').textContent = 'Sin conexión con el servidor';
        mostrarToast('Se perdió la conexión. Verifica que tu Mac siga encendida y conectada a internet.');
    }
}

// Comprobar conexion cada 10 segundos
function iniciarMonitoreo() {
    setInterval(verificarConexion, 10000);
}

// Iniciar todo
iniciarGPS();
cargarResumen();
iniciarMonitoreo();
