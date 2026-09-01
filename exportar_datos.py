import sqlite3
import json
import sys

DB = 'mapeo.db'

def exportar_todo(salida='datos_mapeo.json'):
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    sesiones = [s['sesion'] for s in conn.execute('SELECT DISTINCT sesion FROM puntos UNION SELECT DISTINCT sesion FROM tracks')]

    datos = {
        'version': '1.0',
        'exportacion': json.dumps({'completado': True}),
        'sesiones': []
    }

    for sesion in sesiones:
        puntos = [dict(p) for p in conn.execute('SELECT * FROM puntos WHERE sesion = ?', (sesion,)).fetchall()]
        tracks = [dict(t) for t in conn.execute('SELECT * FROM tracks WHERE sesion = ?', (sesion,)).fetchall()]
        datos['sesiones'].append({
            'sesion': sesion,
            'puntos': puntos,
            'tracks': tracks
        })

    conn.close()

    with open(salida, 'w', encoding='utf-8') as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)

    print(f"✓ Datos exportados a {salida}")
    print(f"  Sesiones: {len(datos['sesiones'])}")
    for s in datos['sesiones']:
        print(f"  - {s['sesion']}: {len(s['puntos'])} puntos, {len(s['tracks'])} posiciones de track")

if __name__ == '__main__':
    salida = sys.argv[1] if len(sys.argv) > 1 else 'datos_mapeo.json'
    exportar_todo(salida)