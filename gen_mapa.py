import sqlite3
import json
import os
import sys
import math
from datetime import datetime

# ============================================================
# Generador de mapas estaticos HTML
# ------------------------------------------------------------
# Lee sesiones de mapeo.db y genera un mapa Leaflet interactivo
# con los puntos y el track coloreado por estado (camino/libre/
# buscando). Se usa para visualizar recorridos despues de las
# caminatas.
#
# Uso:
#   python gen_mapa.py                              -> sesion por defecto
#   python gen_mapa.py sesion-20260911-094345        -> nombre de archivo automatico
#   python gen_mapa.py sesion-20260911-094345 out.html -> nombre personalizado
#
# Colores de segmentos del track (motor de rastreo):
#   Verde  = camino (encajado a sendero mapeado)
#   Naranja = libre (GPS directo, sin sendero)
#   Azul   = buscando (iniciando/evaluando)
# ============================================================

sesion = sys.argv[1] if len(sys.argv) > 1 else 'sesion-20260902-100651'
db_path = os.path.join(os.path.dirname(__file__), 'mapeo.db')
conn = sqlite3.connect(db_path)
c = conn.cursor()

# ==================== Consultar datos ====================

c.execute('SELECT tipo, lat, lng, descripcion, color, timestamp FROM puntos WHERE sesion=? ORDER BY timestamp', (sesion,))
puntos = c.fetchall()

c.execute('SELECT lat, lng, timestamp, estado, confianza FROM tracks WHERE sesion=? ORDER BY timestamp', (sesion,))
tracks = c.fetchall()

# Centro del mapa: promedio de puntos, o primer track, o FES por defecto
centro_lat = sum(p[1] for p in puntos) / len(puntos) if puntos else (tracks[0][0] if tracks else 19.375)
centro_lng = sum(p[2] for p in puntos) / len(puntos) if puntos else (tracks[0][1] if tracks else -99.19)

# ==================== Tablas de referencia ====================

texto_tipo = {
    'banio': 'Bano', 'biblioteca': 'Biblioteca', 'edificio': 'Edificio',
    'acceso': 'Acceso', 'alarma': 'Alarma', 'escaleras': 'Escaleras',
    'escalon': 'Escalon', 'rampa': 'Rampa', 'reunion': 'Punto de reunion',
    'descanso': 'Lugar de descanso', 'emergencia': 'Salida de emergencia',
    'entrada_salida': 'Entrada/Salida', 'otro': 'Otro'
}

colores_tipo = {
    'banio': '#29b6f6', 'biblioteca': '#ab47bc', 'edificio': '#66bb6a',
    'acceso': '#ffa726', 'alarma': '#ef5350', 'escaleras': '#0ea5e9',
    'escalon': '#d946ef', 'rampa': '#14b8a6', 'reunion': '#f97316',
    'descanso': '#84cc16', 'emergencia': '#dc2626', 'entrada_salida': '#6366f1',
    'otro': '#78909c'
}

# Colores del estado del motor de rastreo (en linea de track)
colores_estado = {
    'camino': '#22C55E',   # verde: encajado a sendero mapeado
    'libre': '#F97316',    # naranja: GPS directo (sin sendero)
    'buscando': '#3B82F6'  # azul: iniciando/evaluando
}
texto_estado = {
    'camino': 'En camino (encajado)',
    'libre': 'Sin sendero (GPS directo)',
    'buscando': 'Iniciando...'
}

# ==================== Preparar datos para JS ====================

puntos_js = []
for p in puntos:
    nombre = p[3] if p[3] else texto_tipo.get(p[0], p[0])
    color = p[4] if p[4] else colores_tipo.get(p[0], '#78909c')
    puntos_js.append({'tipo': p[0], 'lat': p[1], 'lng': p[2], 'nombre': nombre, 'color': color})

# Segmentos coloreados: agrupar tracks por estado consecutivo
# para que la polyline verde/naranja/azul se dibuje sin trazos discontinuos
segmentos = []
if tracks:
    estado_actual = tracks[0][3] or 'buscando'
    segmento = {'puntos': [[tracks[0][0], tracks[0][1]]], 'estado': estado_actual}
    for t in tracks[1:]:
        lat, lng, ts, estado, conf = t
        estado_seg = estado or 'buscando'
        ultimo = segmento['puntos'][-1]
        if estado_seg == estado_actual and (lat != ultimo[0] or lng != ultimo[1]):
            segmento['puntos'].append([lat, lng])
        else:
            segmentos.append(segmento)
            segmento = {'puntos': [[lat, lng]], 'estado': estado_seg}
            estado_actual = estado_seg
    segmentos.append(segmento)

track_js = [{'lat': t[0], 'lng': t[1]} for t in tracks]

# ==================== Fechas y horas ====================

fecha_archivo = sesion.replace('sesion-', '').split('-')[0]
fecha_archivo = fecha_archivo[6:8] + '/' + fecha_archivo[4:6] + '/' + fecha_archivo[0:4]

hora_inicio = ''
hora_fin = ''
if tracks:
    try:
        hora_inicio = datetime.fromisoformat(tracks[0][2].replace('Z', '+00:00')).astimezone().strftime('%H:%M:%S')
        hora_fin = datetime.fromisoformat(tracks[-1][2].replace('Z', '+00:00')).astimezone().strftime('%H:%M:%S')
    except Exception:
        pass

# ==================== Leyenda HTML ====================

leyenda_items = '<h4>Estado del rastreo</h4>'
for estado, color in colores_estado.items():
    leyenda_items += '<div><span style="display:inline-block;width:18px;height:4px;background:{};margin-right:6px;vertical-align:middle;border-radius:2px"></span><span style="vertical-align:middle">{}</span></div>'.format(color, texto_estado[estado])

if puntos:
    tipos_unicos = {}
    for p in puntos:
        if p[0] not in tipos_unicos:
            tipos_unicos[p[0]] = colores_tipo.get(p[0], '#78909c')
    leyenda_items += '<h4 style="margin-top:10px">Tipo de punto</h4>'
    for tipo, color in tipos_unicos.items():
        nombre = texto_tipo.get(tipo, tipo)
        leyenda_items += '<div><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:{};margin-right:6px;vertical-align:middle;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></span><span style="vertical-align:middle">{}</span></div>'.format(color, nombre)

# ==================== Distancia total (Haversine) ====================

dist_total = 0.0
for i in range(1, len(tracks)):
    lat1, lng1 = tracks[i-1][0], tracks[i-1][1]
    lat2, lng2 = tracks[i][0], tracks[i][1]
    a = math.sin(math.radians(lat2-lat1)/2)**2 + math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(math.radians(lng2-lng1)/2)**2
    dist_total += 2 * 6371000 * math.asin(math.sqrt(a))

# ==================== Template HTML ====================

html_template = '''<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mapeo FES - @@FECHA@@</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
html, body { margin: 0; padding: 0; height: 100%; font-family: system-ui, -apple-system, sans-serif; }
#map { width: 100%; height: 100%; }
.leyenda { background: rgba(255,255,255,0.95); backdrop-filter: blur(10px); border-radius: 10px; padding: 14px 16px; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); line-height: 1.6; color: #1a1a1a; font-weight: 500; }
.leyenda div { display: flex; align-items: center; margin: 2px 0; }
.leyenda h4 { margin: 0 0 8px 0; font-size: 14px; color: #1F4E79; letter-spacing: 0.3px; }
.info { background: rgba(255,255,255,0.95); backdrop-filter: blur(10px); border-radius: 10px; padding: 14px 16px; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); color: #1a1a1a; font-weight: 500; }
.info h4 { margin: 0 0 6px 0; font-size: 14px; color: #1F4E79; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const puntos = @@PUNTOS@@;
const track = @@TRACK@@;
const segmentos = @@SEGMENTOS@@;
const coloresEstado = @@COLORES_ESTADO@@;

const map = L.map('map', { zoomControl: false }).setView([@@CENTRO_LAT@@, @@CENTRO_LNG@@], 16);
L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
        maxZoom: 20,
        detectRetina: true,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contribuidores, estilo <a href="https://www.openstreetmap.fr/">OSM Francia</a>'
    }).addTo(map);

if (track.length > 0) {
    // Ruta completa coloreada por estado del motor de rastreo
    for (const seg of segmentos) {
        if (seg.puntos.length < 2) continue;
        L.polyline(seg.puntos, { color: coloresEstado[seg.estado] || '#3B82F6', weight: 4, opacity: 0.9 }).addTo(map);
    }

    const iconInicio = L.divIcon({
        html: '<div style="background:#22C55E;width:20px;height:20px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>',
        className: '', iconSize: [20, 20], iconAnchor: [10, 10]
    });
    L.marker(track[0], { icon: iconInicio }).addTo(map).bindPopup('<b>Inicio del recorrido</b>');

    const iconFin = L.divIcon({
        html: '<div style="background:#EF4444;width:20px;height:20px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>',
        className: '', iconSize: [20, 20], iconAnchor: [10, 10]
    });
    L.marker(track[track.length - 1], { icon: iconFin }).addTo(map).bindPopup('<b>Fin del recorrido</b>');
}

puntos.forEach(p => {
    const color = p.color || '#78909c';
    const icon = L.divIcon({
        html: `<div style="background:${color};width:22px;height:22px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);"></div>`,
        className: '', iconSize: [22, 22], iconAnchor: [11, 11]
    });
    const marker = L.marker([p.lat, p.lng], { icon });
    marker.bindPopup(`<div style="font-size:14px;font-weight:600;color:#1F4E79">${p.nombre || p.tipo}</div><div style="font-size:11px;color:#666;margin-top:4px">Lat: ${p.lat.toFixed(6)}<br>Lng: ${p.lng.toFixed(6)}</div>`);
    map.addLayer(marker);
});

const leyenda = L.control({ position: 'topright' });
leyenda.onAdd = function() {
    const div = L.DomUtil.create('div', 'leyenda');
    div.innerHTML = '@@LEYENDA@@';
    return div;
};
leyenda.addTo(map);

const info = L.control({ position: 'bottomleft' });
info.onAdd = function() {
    const div = L.DomUtil.create('div', 'info');
    div.innerHTML = '<h4>Sesion @@FECHA@@</h4>Puntos: @@NUM_PUNTOS@@<br>Track: @@NUM_TRACKS@@<br>Recorrido: @@HORA_INI@@ - @@HORA_FIN@@<br>Distancia: @@DIST_KM@@ km';
    return div;
};
info.addTo(map);

if (puntos.length > 0 || track.length > 0) {
    const puntosFit = puntos.length > 0 ? puntos.map(p => [p.lat, p.lng]) : [track[0], track[track.length - 1]];
    const bounds = L.latLngBounds(puntosFit);
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17 });
}
</script>
</body>
</html>'''

reemplazos = {
    '@@PUNTOS@@': json.dumps(puntos_js, ensure_ascii=False),
    '@@TRACK@@': json.dumps(track_js),
    '@@SEGMENTOS@@': json.dumps(segmentos, ensure_ascii=False),
    '@@COLORES_ESTADO@@': json.dumps(colores_estado),
    '@@CENTRO_LAT@@': str(round(centro_lat, 6)),
    '@@CENTRO_LNG@@': str(round(centro_lng, 6)),
    '@@LEYENDA@@': leyenda_items,
    '@@NUM_PUNTOS@@': str(len(puntos)),
    '@@NUM_TRACKS@@': str(len(tracks)),
    '@@HORA_INI@@': hora_inicio,
    '@@HORA_FIN@@': hora_fin,
    '@@DIST_KM@@': str(round(dist_total / 1000.0, 2)),
    '@@FECHA@@': fecha_archivo
}

html = html_template
for token, valor in reemplazos.items():
    html = html.replace(token, valor)

out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), 'mapeo_' + sesion.replace('sesion-', '') + '.html')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(html)
print('Archivo generado:', os.path.basename(out_path))
print('Sesion:', sesion, '| Puntos:', len(puntos), '| Tracks:', len(tracks), '| Distancia:', round(dist_total / 1000.0, 2), 'km | Segmentos:', len(segmentos))
