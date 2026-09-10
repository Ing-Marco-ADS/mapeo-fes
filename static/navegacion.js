// ============================================================
// MAPEO FES - App robusta de Navegacion asistida por voz
// Consume los datos de mapeo guardados y guia al usuario.
// ============================================================

// ---- Estado global ----
let mapa = null;
let marcaUsuario = null;
let circuloPrecision = null;
let gpstrackingId = null;
let puntosGlobales = [];       // todos los puntos de todas las sesiones
let puntosCargados = false;
let posicionActual = null;     // {lat, lng, accuracy, heading}

// Voz
let hablaActiva = false;
let escuchaContinua = false;
let ultimoAnuncioTexto = '';
let puntosAnunciados = new Set();

// Navegacion
let destinoActual = null;      // punto destino seleccionado
let navegando = false;
let anuncioRutaTimer = null;

// Umbrales
const RADIO_ANUNCIO_M = 25;    // anuncia si un punto esta a menos de 25m
const RADIO_OBSTACULO_M = 10;  // obstaculos (escalon/escaleras) a menos de 10m
const DISTANCIA_LIBERAR_M = 30;// se libera un punto para re-anunciar al alejarse

// ---- Nombres y textos por tipo ----
const TIPO_INFO = {
    'banio':            { nombre: 'Baño',                 emoji: '🚻', obstaculo: false },
    'biblioteca':       { nombre: 'Biblioteca',           emoji: '📚', obstaculo: false },
    'edificio':         { nombre: 'Edificio',             emoji: '🏢', obstaculo: false },
    'acceso':           { nombre: 'Acceso',               emoji: '♿', obstaculo: false },
    'alarma':           { nombre: 'Alarma',               emoji: '🚨', obstaculo: false },
    'escaleras':        { nombre: 'Escaleras',            emoji: '🪜', obstaculo: true },
    'escalon':          { nombre: 'Escalón',              emoji: '⬇️', obstaculo: true },
    'rampa':            { nombre: 'Rampa',                emoji: '↗️', obstaculo: false },
    'reunion':          { nombre: 'Punto de reunión',     emoji: '⛑️', obstaculo: false },
    'descanso':         { nombre: 'Lugar de descanso',    emoji: '☕', obstaculo: false },
    'emergencia':       { nombre: 'Salida de emergencia', emoji: '🚪', obstaculo: false },
    'entrada_salida':   { nombre: 'Entrada o salida',     emoji: '🚪', obstaculo: false },
    'otro':             { nombre: 'Punto de interés',     emoji: '📌', obstaculo: false }
};

// ---- Utilidades ----
function $(id) { return document.getElementById(id); }

function distanciaMetros(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const aL = lat1 * Math.PI / 180, bL = lat2 * Math.PI / 180;
    const dL = (lat2 - lat1) * Math.PI / 180, dG = (lng2 - lng1) * Math.PI / 180;
    const h = Math.sin(dL/2)**2 + Math.cos(aL)*Math.cos(bL)*Math.sin(dG/2)**2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

// Direccion cardinal aproximada de a hacia b (usando heading si disponible)
function direccionEntre(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180)
            - Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
    const brng = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    const direcciones = ['al norte', 'al noreste', 'al este', 'al sureste',
                         'al sur', 'al suroeste', 'al oeste', 'al noroeste'];
    return direcciones[Math.round(brng / 45) % 8];
}

function direccionRelativa(direccionCardinal, heading) {
    if (!heading && heading !== 0) return direccionCardinal;
    const puntos = { 'N':0, 'NE':45, 'E':90, 'SE':135, 'S':180, 'SW':225, 'O':270, 'NO':315 };
    const map = { 'al norte':'N', 'al noreste':'NE', 'al este':'E', 'al sureste':'SE',
                  'al sur':'S', 'al suroeste':'SW', 'al oeste':'O', 'al noroeste':'NO' };
    const tar = puntos[map[direccionCardinal]];
    const rel = ((tar - heading) % 360 + 360) % 360;
    if (rel === 0) return 'a tu frente';
    if (rel < 30 || rel > 330) return 'a tu frente';
    if (rel < 90) return 'a tu derecha';
    if (rel < 180) return 'detrás a tu derecha';
    if (rel <= 270) return 'detrás a tu izquierda';
    return 'a tu izquierda';
}

// ---- Voz (Web Speech API) ----
function sintetiza(texto) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'es-MX';
    u.rate = 1.0;
    u.pitch = 1.0;
    speechSynthesis.speak(u);
    ultimoAnuncioTexto = texto;
    $('ultimo-anuncio').textContent = texto;
}

function mostrarToast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(t._temporizador);
    t._temporizador = setTimeout(() => t.classList.remove('visible'), 4000);
}

// ---- Carga de datos ----
async function cargarDatos() {
    try {
        const res = await fetch('/api/resumen', {cache: 'no-store'});
        const sesiones = await res.json();
        if (!sesiones || sesiones.length === 0) {
            sintetiza('Aún no hay datos de mapeo guardados. Primero haz un recorrido.');
            return;
        }
        for (const s of sesiones) {
            const pr = await fetch(`/api/puntos?sesion=${encodeURIComponent(s.sesion)}`, {cache: 'no-store'});
            const pts = await pr.json();
            if (pts && pts.length) {
                for (const p of pts) {
                    puntosGlobales.push({
                        id: p.id,
                        tipo: p.tipo,
                        lat: p.lat,
                        lng: p.lng,
                        nombre: p.descripcion || TIPO_INFO[p.tipo]?.nombre || 'Punto',
                        color: p.color || pcolorTipo(p.tipo),
                        sesion: p.sesion
                    });
                }
            }
        }
        puntosCargados = true;
        dibujarPuntos();
        if (puntosGlobales.length) {
            sintetiza(`${puntosGlobales.length} puntos de interés cargados. Pulsa escuchar para oír lo que hay alrededor.`);
        }
    } catch (e) {
        console.error('Error cargando datos:', e);
        mostrarToast('Error al cargar los datos.');
    }
}

function pcolorTipo(tipo) {
    const c = {
        'banio':'#29b6f6', 'biblioteca':'#ab47bc', 'edificio':'#66bb6a',
        'acceso':'#ffa726', 'alarma':'#ef5350', 'escaleras':'#0ea5e9',
        'escalon':'#d946ef', 'rampa':'#14b8a6', 'reunion':'#f97316',
        'descanso':'#84cc16', 'emergencia':'#dc2626',
        'entrada_salida':'#6366f1', 'otro':'#78909c'
    };
    return c[tipo] || '#78909c';
}

// ---- Mapa ----
function iniciarMapa(lat, lng) {
    mapa = L.map('mapa-nav', {zoomControl: false}).setView([lat, lng], 18);
    L.control.zoom({position: 'bottomright'}).addTo(mapa);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 22, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap'
    }).addTo(mapa);

    const icU = L.divIcon({
        className: '', iconSize: [20,20], iconAnchor: [10,10],
        html: '<div style="width:20px;height:20px;background:#ef4444;border:3px solid #fff;border-radius:50%;box-shadow:0 0 10px rgba(0,0,0,.5)"></div>'
    });
    marcaUsuario = L.marker([lat, lng], {icon: icU}).addTo(mapa);

    circuloPrecision = L.circle([lat, lng], {
        radius: 30, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.08, weight: 1, opacity: 0.4
    }).addTo(mapa);
}

function actualizarUsuario(lat, lng, accuracy) {
    if (marcaUsuario) marcaUsuario.setLatLng([lat, lng]);
    if (circuloPrecision && accuracy) circuloPrecision.setLatLng([lat, lng]).setRadius(accuracy);
    if (mapa && !mapa._dragging && !navegando) mapa.panTo([lat, lng]);
}

function dibujarPuntos() {
    if (!mapa || !puntosCargados) return;
    for (const p of puntosGlobales) {
        const ic = L.divIcon({
            className: '', iconSize: [16,16], iconAnchor: [8,8],
            html: `<div style="width:16px;height:16px;background:${p.color};border:2px solid #fff;border-radius:50%;box-shadow:0 1px 5px rgba(0,0,0,.4)"></div>`
        });
        L.marker([p.lat, p.lng], {icon: ic})
            .addTo(mapa)
            .bindPopup(`<b>${p.nombre}</b><br>${TIPO_INFO[p.tipo].nombre}`);
    }
    // Ajustar vista a todos los puntos
    const bounds = L.latLngBounds(puntosGlobales.map(p => [p.lat, p.lng]));
    mapa.fitBounds(bounds, {padding: [30,30], maxZoom: 17});
}

// ---- GPS ----
function iniciarGPS() {
    if (!navigator.geolocation) {
        $('estado-gps').textContent = 'GPS no disponible';
        sintetiza('El GPS no está disponible en este dispositivo.');
        return;
    }
    gpstrackingId = navigator.geolocation.watchPosition(
        (pos) => {
            const c = pos.coords;
            posicionActual = {lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, heading: c.heading};
            $('estado-gps').textContent = `GPS: ${c.accuracy <= 5 ? 'excelente' : c.accuracy <= 10 ? 'buena' : c.accuracy <= 20 ? 'regular' : 'baja'} (${Math.round(c.accuracy)} m)`;
            actualizarUsuario(c.latitude, c.longitude, c.accuracy);

            if (escuchaContinua) anunciaAlRededor();
            if (navegando) actualizaNavegacion();
        },
        (err) => {
            $('estado-gps').textContent = 'Error de GPS. Revisa tu ubicación.';
            console.error('GPS err:', err);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
}

// ---- Escucha continua alrededor (modo autonomo) ----
function alternarEscucha() {
    if (!puntosGlobales.length) {
        sintetiza('Primero carga datos de mapeo.');
        return;
    }
    if (!posicionActual) {
        sintetiza('Esperando señal GPS.');
        return;
    }
    escuchaContinua = !escuchaContinua;
    const btn = $('btn-escuchar');
    if (escuchaContinua) {
        btn.textContent = '⏹️ Detener escucha';
        sintetiza('Escucha activada. Te avisaré cuando haya un punto de interés cerca.');
        anunciaAlRededor();
    } else {
        btn.textContent = '🔊 Escuchar alrededores';
        sintetiza('Escucha detenida.');
    }
}

function anunciaAlRededor() {
    if (!posicionActual) return;
    const cercanos = puntosCercanos(posicionActual, RADIO_ANUNCIO_M);
    const obstaculos = cercanos.filter(p => TIPO_INFO[p.tipo]?.obstaculo && distanciaMetros(p.lat, p.lng, posicionActual.lat, posicionActual.lng) <= RADIO_OBSTACULO_M);
    const noAnunciados = cercanos.filter(p => !puntosAnunciados.has(p.id));

    let texto = '';

    if (obstaculos.length) {
        const o = obstaculos.sort((a,b) =>
            distanciaMetros(a.lat,a.lng,posicionActual.lat,posicionActual.lng) -
            distanciaMetros(b.lat,b.lng,posicionActual.lat,posicionActual.lng))[0];
        const d = Math.round(distanciaMetros(o.lat,o.lng,posicionActual.lat,posicionActual.lng));
        const dir = direccionRelativa(direccionEntre(posicionActual.lat,posicionActual.lng,o.lat,o.lng), posicionActual.heading);
        texto = `Precaución: ${TIPO_INFO[o.tipo].nombre.toLowerCase()} a ${d} metros ${dir}.`;
        puntosAnunciados.add(o.id);
        sintetiza(texto);
        return;
    }

    if (noAnunciados.length) {
        const cercano = noAnunciados.sort((a,b) =>
            distanciaMetros(a.lat,a.lng,posicionActual.lat,posicionActual.lng) -
            distanciaMetros(b.lat,b.lng,posicionActual.lat,posicionActual.lng))[0];
        const d = Math.round(distanciaMetros(cercano.lat,cercano.lng,posicionActual.lat,posicionActual.lng));
        const dir = direccionRelativa(direccionEntre(posicionActual.lat,posicionActual.lng,cercano.lat,cercano.lng), posicionActual.heading);
        texto = curtoTexto(cercano, d, dir);
        puntosAnunciados.add(cercano.id);
        sintetiza(texto);
    }

    // Liberar puntos cuando el usuario se aleja
    for (const id of [...puntosAnunciados]) {
        const p = puntosGlobales.find(x => x.id === id);
        if (p && distanciaMetros(p.lat,p.lng,posicionActual.lat,posicionActual.lng) > DISTANCIA_LIBERAR_M) {
            puntosAnunciados.delete(id);
        }
    }
}

function puntosCercanos(pos, radio) {
    return puntosGlobales.filter(p => distanciaMetros(p.lat, p.lng, pos.lat, pos.lng) <= radio);
}

function curtoTexto(p, dist, dir) {
    const tipo = TIPO_INFO[p.tipo]?.nombre || 'Punto';
    if (p.nombre && p.nombre !== tipo) {
        return `${p.nombre} ${dir} a ${dist} metros.`;
    }
    return `Hay un ${tipo.toLowerCase()} ${dir} a ${dist} metros.`;
}

// ---- Anunciar los cercanos explicitamente ----
function anunciarCercanos() {
    if (!posicionActual) { sintetiza('Esperando señal GPS.'); return; }
    const cercanos = puntosCercanos(posicionActual, 60);
    if (!cercanos.length) {
        sintetiza('No tengo puntos de interés cerca. Camina un poco y vuelve a preguntar.');
        return;
    }
    cercanos.sort((a,b) =>
        distanciaMetros(a.lat,a.lng,posicionActual.lat,posicionActual.lng) -
        distanciaMetros(b.lat,b.lng,posicionActual.lat,posicionActual.lng));
    let texto = `Hay ${cercanos.length} puntos cerca. `;
    cercanos.slice(0,5).forEach((p) => {
        const d = Math.round(distanciaMetros(p.lat,p.lng,posicionActual.lat,posicionActual.lng));
        const dir = direccionRelativa(direccionEntre(posicionActual.lat,posicionActual.lng,p.lat,p.lng), posicionActual.heading);
        texto += `${curtoTexto(p, d, dir)} `;
    });
    sintetiza(texto);
}

function repetirAnuncio() {
    if (ultimoAnuncioTexto) sintetiza(ultimoAnuncioTexto);
    else sintetiza('Aún no hay anuncios.');
}

// ---- Navegacion a destino ----
function abrirDestinos() {
    if (!puntosGlobales.length) { sintetiza('No hay destinos cargados.'); return; }
    const lista = $('lista-destinos');
    lista.innerHTML = '';

    // Agrupar por tipo para hacer mas facil la eleccion
    const grupos = {};
    for (const p of puntosGlobales) {
        (grupos[p.tipo] = grupos[p.tipo] || []).push(p);
    }

    for (const [tipo, pts] of Object.entries(grupos)) {
        const info = TIPO_INFO[tipo];
        const seccion = document.createElement('div');
        seccion.className = 'grupo-destino';
        seccion.setAttribute('role', 'listitem');
        const titulo = document.createElement('h3');
        titulo.textContent = `${info.emoji} ${info.nombre} (${pts.length})`;
        seccion.appendChild(titulo);
        for (const p of pts.slice(0, 12)) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-destino';
            btn.textContent = p.nombre;
            btn.setAttribute('aria-label', `Ir a ${p.nombre}`);
            btn.onclick = () => iniciarNavegacion(p);
            seccion.appendChild(btn);
        }
        if (pts.length > 12) {
            const extra = document.createElement('p');
            extra.className = 'instructivo';
            extra.textContent = `... y ${pts.length - 12} más`;
            seccion.appendChild(extra);
        }
        lista.appendChild(seccion);
    }

    $('dialogo-destinos').classList.remove('oculto');
    $('dialogo-destinos').setAttribute('aria-hidden', 'false');
}

function cerrarDestinos() {
    $('dialogo-destinos').classList.add('oculto');
    $('dialogo-destinos').setAttribute('aria-hidden', 'true');
}

function iniciarNavegacion(p) {
    cerrarDestinos();
    destinoActual = p;
    navegando = true;
    $('pantalla-nav').classList.remove('oculto');
    $('pantalla-nav').setAttribute('aria-hidden', 'false');
    $('nav-destino-texto').textContent = `Hacia: ${p.nombre}`;
    sintetiza(`Navegando hacia ${p.nombre}.`);
    actualizaNavegacion();
}

function actualizaNavegacion() {
    if (!navegando || !destinoActual || !posicionActual) return;
    const d = distanciaMetros(posicionActual.lat, posicionActual.lng, destinoActual.lat, destinoActual.lng);
    const dir = direccionRelativa(direccionEntre(posicionActual.lat, posicionActual.lng, destinoActual.lat, destinoActual.lng), posicionActual.heading);
    $('nav-distancia-texto').textContent = `${Math.round(d)} metros ${dir}`;

    if (d <= RADIO_OBSTACULO_M) {
        sintetiza(`Has llegado a ${destinoActual.nombre}.`);
        cancelarNavegacion();
        return;
    }

    // Anunciar guia cada 50m de avance (evitar spam)
    clearTimeout(anuncioRutaTimer);
    anuncioRutaTimer = setTimeout(() => {
        if (navegando && d > RADIO_OBSTACULO_M) {
            sintetiza(`Faltan ${Math.round(d)} metros ${dir} para ${destinoActual.nombre}.`);
        }
    }, 30000);

    // Dibujar destino destacado en el mapa
    if (!window._marcaDestino) {
        window._marcaDestino = L.circleMarker([destinoActual.lat, destinoActual.lng], {
            radius: 10, color: '#fff', weight: 3, fillColor: '#22c55e', fillOpacity: 0.9
        }).addTo(mapa);
    } else {
        window._marcaDestino.setLatLng([destinoActual.lat, destinoActual.lng]);
    }
    if (mapa) mapa.panTo([posicionActual.lat, posicionActual.lng]);
}

function cancelarNavegacion() {
    navegando = false;
    destinoActual = null;
    clearTimeout(anuncioRutaTimer);
    $('pantalla-nav').classList.add('oculto');
    $('pantalla-nav').setAttribute('aria-hidden', 'true');
    if (window._marcaDestino) {
        mapa.removeLayer(window._marcaDestino);
        window._marcaDestino = null;
    }
}

// ---- Inicio ----
function inicio() {
    iniciarGPS();
    cargarDatos();
}

window.addEventListener('load', inicio);