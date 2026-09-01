import os
import json
import sqlite3
import urllib.request
import urllib.parse
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# GraphHopper: encaja puntos a caminos PEATONALES (foot) con clave gratuita.
# La clave se lee de la variable de entorno GRAPHOPPER_KEY o del archivo
# .graphhopper_key en la carpeta del proyecto (una sola linea).
GRAPHOPPER_URL = 'https://graphhopper.com/api/1/route'

def get_graphhopper_key():
    clave = os.environ.get('GRAPHOPPER_KEY', '')
    if not clave:
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.graphhopper_key'), 'r') as f:
                clave = f.read().strip()
        except Exception:
            clave = ''
    return clave

app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)

DB_PATH = 'mapeo.db'

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS puntos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            descripcion TEXT,
            foto TEXT,
            timestamp TEXT NOT NULL,
            sesion TEXT,
            color TEXT
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sesion TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            timestamp TEXT NOT NULL
        )
    ''')
    # Migracion: agregar columna 'color' a puntos si no existe (bases viejas)
    cols = [r[1] for r in conn.execute('PRAGMA table_info(puntos)').fetchall()]
    if 'color' not in cols:
        conn.execute('ALTER TABLE puntos ADD COLUMN color TEXT')
    conn.commit()
    conn.close()

@app.route('/')
def index():
    return send_from_directory('templates', 'index.html')

@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory('static', filename)

@app.route('/api/punto', methods=['POST'])
def guardar_punto():
    data = request.json
    conn = get_db()
    conn.execute(
        'INSERT INTO puntos (tipo, lat, lng, descripcion, foto, timestamp, sesion, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        (data['tipo'], data['lat'], data['lng'], data.get('descripcion', ''), data.get('foto', ''), data['timestamp'], data.get('sesion', 'default'), data.get('color', None))
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/puntos', methods=['GET'])
def obtener_puntos():
    conn = get_db()
    sesion = request.args.get('sesion', 'default')
    puntos = conn.execute('SELECT * FROM puntos WHERE sesion = ? ORDER BY timestamp', (sesion,)).fetchall()
    conn.close()
    return jsonify([dict(p) for p in puntos])

@app.route('/api/track', methods=['POST'])
def guardar_track():
    data = request.json
    conn = get_db()
    conn.execute(
        'INSERT INTO tracks (sesion, lat, lng, timestamp) VALUES (?, ?, ?, ?)',
        (data['sesion'], data['lat'], data['lng'], data['timestamp'])
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/track', methods=['GET'])
def obtener_track():
    conn = get_db()
    sesion = request.args.get('sesion', 'default')
    tracks = conn.execute('SELECT * FROM tracks WHERE sesion = ? ORDER BY timestamp', (sesion,)).fetchall()
    conn.close()
    return jsonify([dict(t) for t in tracks])

@app.route('/api/exportar', methods=['GET'])
def exportar():
    sesion = request.args.get('sesion', 'default')
    conn = get_db()
    puntos = [dict(p) for p in conn.execute('SELECT * FROM puntos WHERE sesion = ?', (sesion,)).fetchall()]
    tracks = [dict(t) for t in conn.execute('SELECT * FROM tracks WHERE sesion = ?', (sesion,)).fetchall()]
    conn.close()
    return jsonify({
        'sesion': sesion,
        'fecha_exportacion': datetime.now().isoformat(),
        'puntos': puntos,
        'tracks': tracks
    })

@app.route('/api/sesiones', methods=['GET'])
def listar_sesiones():
    conn = get_db()
    sesiones = conn.execute('SELECT DISTINCT sesion FROM puntos UNION SELECT DISTINCT sesion FROM tracks').fetchall()
    conn.close()
    return jsonify([s['sesion'] for s in sesiones])

@app.route('/api/resumen', methods=['GET'])
def resumen():
    conn = get_db()
    sesiones_puntos = conn.execute('SELECT sesion, COUNT(*) as n FROM puntos GROUP BY sesion').fetchall()
    sesiones_tracks = conn.execute('SELECT sesion, COUNT(*) as n FROM tracks GROUP BY sesion').fetchall()
    counts_p = {s['sesion']: s['n'] for s in sesiones_puntos}
    counts_t = {s['sesion']: s['n'] for s in sesiones_tracks}
    todas = set(counts_p.keys()) | set(counts_t.keys())
    resultado = []
    for sesion in todas:
        resultado.append({
            'sesion': sesion,
            'puntos': counts_p.get(sesion, 0),
            'track': counts_t.get(sesion, 0)
        })
    resultado.sort(key=lambda x: x['sesion'], reverse=True)
    conn.close()
    return jsonify(resultado)

@app.route('/api/punto/<int:pid>', methods=['DELETE'])
def borrar_punto(pid):
    conn = get_db()
    conn.execute('DELETE FROM puntos WHERE id = ?', (pid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/sesion/<sesion>', methods=['DELETE'])
def borrar_sesion(sesion):
    conn = get_db()
    conn.execute('DELETE FROM puntos WHERE sesion = ?', (sesion,))
    conn.execute('DELETE FROM tracks WHERE sesion = ?', (sesion,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/todo', methods=['DELETE'])
def borrar_todo():
    conn = get_db()
    conn.execute('DELETE FROM puntos')
    conn.execute('DELETE FROM tracks')
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

# Encaja un tramo (o un punto) GPS a los CAMINOS PEATONALES usando GraphHopper.
# - Con UNA posicion (lat,lng): devuelve punto + flag.
# - Con DOS posiciones (lat1,lng1,lat2,lng2): devuelve la geometria de la ruta
#   peatonal que une ambos puntos siguiendo los caminos (lo que da el track).
# Sin clave configurada, devuelve los puntos originales (funcionamiento degradado).
@app.route('/api/snap', methods=['GET'])
def snap_punto():
    lat1 = request.args.get('lat1') or request.args.get('lat')
    lng1 = request.args.get('lng1') or request.args.get('lng')
    lat2 = request.args.get('lat2')
    lng2 = request.args.get('lng2')

    if lat1 is None or lng1 is None:
        return jsonify({'error': 'Faltan coordenadas'}), 400
    try:
        lat1 = float(lat1); lng1 = float(lng1)
        if lat2 is not None:
            lat2 = float(lat2); lng2 = float(lng2)
    except ValueError:
        return jsonify({'error': 'Coordenadas invalidas'}), 400

    clave = get_graphhopper_key()
    # Si no hay clave, no se puede encajar a peatonales -> devolver originales
    if not clave:
        if lat2 is None:
            return jsonify({'lat': lat1, 'lng': lng1, 'snapped': False, 'sin_clave': True})
        else:
            return jsonify({'geometry': [[lat1, lng1], [lat2, lng2]], 'snapped': False, 'sin_clave': True})

    puntos = [[lat1, lng1]]
    if lat2 is not None:
        puntos.append([lat2, lng2])

    try:
        geometria = graphhopper_ruta_foot(puntos, clave)
    except Exception as e:
        # Si falla la API, devolver el punto o tramo original
        if lat2 is None:
            return jsonify({'lat': lat1, 'lng': lng1, 'snapped': False, 'error': str(e)})
        else:
            return jsonify({'geometry': [[lat1, lng1], [lat2, lng2]], 'snapped': False, 'error': str(e)})

    if geometria:
        return jsonify({'geometry': geometria, 'snapped': True})
    if lat2 is None:
        return jsonify({'lat': lat1, 'lng': lng1, 'snapped': False})
    return jsonify({'geometry': [[lat1, lng1], [lat2, lng2]], 'snapped': False})

# Llama a GraphHopper route con perfil foot y devuelve la geometria encajada
# como lista de [lat, lng], o [] si no hay una linea valida.
def graphhopper_ruta_foot(puntos, clave):
    points_param = '&'.join(f'point={p[0]},{p[1]}' for p in puntos)
    url = f'{GRAPHOPPER_URL}?{points_param}&vehicle=foot&locale=es&key={clave}&points_encoded=false'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mapeo-FES/1.0'})
    with urllib.request.urlopen(req, timeout=12) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    path = data.get('paths', [{}])[0]
    points_json = path.get('points', {})
    coords = points_json.get('coordinates', [])
    geometria = [[c[1], c[0]] for c in coords] if coords else []
    return geometria

# Endpoint para corregir la posicion de un punto guardado
@app.route('/api/punto/<int:pid>/posicion', methods=['PATCH'])
def corregir_posicion(pid):
    data = request.json
    lat = data.get('lat')
    lng = data.get('lng')
    if lat is None or lng is None:
        return jsonify({'error': 'Faltan lat/lng'}), 400
    conn = get_db()
    cur = conn.execute('UPDATE puntos SET lat = ?, lng = ? WHERE id = ?', (float(lat), float(lng), pid))
    conn.commit()
    ok = cur.rowcount > 0
    conn.close()
    return jsonify({'ok': ok})

# Endpoint para cambiar o asignar el color de un punto guardado
@app.route('/api/punto/<int:pid>/color', methods=['PATCH'])
def cambiar_color(pid):
    data = request.json
    color = data.get('color')
    if not color:
        return jsonify({'error': 'Falta color'}), 400
    conn = get_db()
    cur = conn.execute('UPDATE puntos SET color = ? WHERE id = ?', (color, pid))
    conn.commit()
    ok = cur.rowcount > 0
    conn.close()
    return jsonify({'ok': ok})

# Endpoint para actualizar la descripcion (nombre) de un punto guardado
@app.route('/api/punto/<int:pid>/descripcion', methods=['PATCH'])
def cambiar_descripcion(pid):
    data = request.json
    descripcion = data.get('descripcion', '').strip()
    if not descripcion:
        return jsonify({'error': 'Descripcion vacia'}), 400
    conn = get_db()
    cur = conn.execute('UPDATE puntos SET descripcion = ? WHERE id = ?', (descripcion, pid))
    conn.commit()
    ok = cur.rowcount > 0
    conn.close()
    return jsonify({'ok': ok})

if __name__ == '__main__':
    init_db()
    print("\n=== MAPEO FES ===")
    print("Abre en tu celular: http://TU_IP:5000")
    print("Para ver tu IP, ejecuta: ifconfig | grep 'inet '")
    print("=================\n")
    app.run(host='0.0.0.0', port=5000, debug=False)