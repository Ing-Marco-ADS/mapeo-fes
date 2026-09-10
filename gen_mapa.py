import sqlite3
import json
import os

sesion = 'sesion-20260902-100651'
db_path = os.path.join(os.path.dirname(__file__), 'mapeo.db')
conn = sqlite3.connect(db_path)
c = conn.cursor()

c.execute('SELECT tipo, lat, lng, descripcion, color, timestamp FROM puntos WHERE sesion=? ORDER BY timestamp', (sesion,))
puntos = c.fetchall()

c.execute('SELECT lat, lng, timestamp FROM tracks WHERE sesion=? ORDER BY timestamp', (sesion,))
tracks = c.fetchall()

centro_lat = sum(p[1] for p in puntos) / len(puntos) if puntos else 19.375
centro_lng = sum(p[2] for p in puntos) / len(puntos) if puntos else -99.19

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

puntos_js = []
for p in puntos:
    nombre = p[3] if p[3] else texto_tipo.get(p[0], p[0])
    color = p[4] if p[4] else colores_tipo.get(p[0], '#78909c')
    puntos_js.append({'tipo': p[0], 'lat': p[1], 'lng': p[2], 'nombre': nombre, 'color': color})

track_js = [{'lat': t[0], 'lng': t[1]} for t in tracks]

tipos_unicos = {}
for p in puntos:
    if p[0] not in tipos_unicos:
        tipos_unicos[p[0]] = colores_tipo.get(p[0], '#78909c')

leyenda_items = ''
for tipo, color in tipos_unicos.items():
    nombre = texto_tipo.get(tipo, tipo)
    leyenda_items += '<div><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:{};margin-right:6px;vertical-align:middle;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></span><span style="vertical-align:middle">{}</span></div>'.format(color, nombre)

html = '''<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mapeo FES - 02/09/2026</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />
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
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
<script>
const puntos = PUNTOS_PLACEHOLDER;
const track = TRACK_PLACEHOLDER;

const map = L.map('map', { zoomControl: false }).setView([CENTRO_LAT, CENTRO_lng], 16);
L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 22,
    maxNativeZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

if (track.length > 0) {
    const trackLatLngs = track.map(p => [p.lat, p.lng]);
    L.polyline(trackLatLngs, { color: '#3B82F6', weight: 3, opacity: 0.6 }).addTo(map);

    const iconInicio = L.divIcon({
        html: '<div style="background:#22C55E;width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>',
        className: '', iconSize: [18, 18], iconAnchor: [9, 9]
    });
    L.marker(trackLatLngs[0], { icon: iconInicio }).addTo(map).bindPopup('<b>Inicio del recorrido</b>');

    const iconFin = L.divIcon({
        html: '<div style="background:#EF4444;width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>',
        className: '', iconSize: [18, 18], iconAnchor: [9, 9]
    });
    L.marker(trackLatLngs[trackLatLngs.length - 1], { icon: iconFin }).addTo(map).bindPopup('<b>Fin del recorrido</b>');
}

const markers = L.markerClusterGroup({ maxClusterRadius: 20, disableClusteringAtZoom: 17 });
    puntos.forEach(p => {
        const color = p.color || '#78909c';
        const icon = L.divIcon({
            html: `<div style="background:${color};width:22px;height:22px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);"></div>`,
            className: '', iconSize: [22, 22], iconAnchor: [11, 11]
        });
        const marker = L.marker([p.lat, p.lng], { icon });
        const nombre = p.nombre || p.tipo;
        marker.bindPopup(`<div style="font-size:14px;font-weight:600;color:#1F4E79">${nombre}</div><div style="font-size:11px;color:#666;margin-top:4px">Lat: ${p.lat.toFixed(6)}<br>Lng: ${p.lng.toFixed(6)}</div>`);
        markers.addLayer(marker);
    });
    map.addLayer(markers);

const leyenda = L.control({ position: 'topright' });
leyenda.onAdd = function() {
    const div = L.DomUtil.create('div', 'leyenda');
    div.innerHTML = '<h4>Tipo de punto</h4>LEYENDA_PLACEHOLDER';
    return div;
};
leyenda.addTo(map);

const info = L.control({ position: 'bottomleft' });
info.onAdd = function() {
    const div = L.DomUtil.create('div', 'info');
    div.innerHTML = '<h4>Sesion: 02/09/2026</h4>Puntos: NUM_PUNTOS<br>Track: NUM_TRACKS<br>Recorrido: 11:07 AM - 11:52 AM';
    return div;
};
info.addTo(map);

if (puntos.length > 0) {
    const bounds = L.latLngBounds(puntos.map(p => [p.lat, p.lng]));
    const zoomActual = map.getBoundsZoom(bounds, false);
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17 });
}
</script>
</body>
</html>'''

html = html.replace('PUNTOS_PLACEHOLDER', json.dumps(puntos_js, ensure_ascii=False))
html = html.replace('TRACK_PLACEHOLDER', json.dumps(track_js))
html = html.replace('CENTRO_LAT', str(round(centro_lat, 6)))
html = html.replace('CENTRO_lng', str(round(centro_lng, 6)))
html = html.replace('LEYENDA_PLACEHOLDER', leyenda_items)
html = html.replace('NUM_PUNTOS', str(len(puntos)))
html = html.replace('NUM_TRACKS', str(len(tracks)))

out_path = os.path.join(os.path.dirname(__file__), 'mapeo_20260902.html')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(html)
print('Archivo generado: mapeo_20260902.html')
print('Puntos:', len(puntos), '| Tracks:', len(tracks))
