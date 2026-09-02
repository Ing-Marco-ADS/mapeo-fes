# AGENTS.md — Mapeo FES (Servicio Social)

## Descripcion general

App web para mapear la FES (Facultad de Estudios Superiores) como servicio social.
El objetivo es crear un mapa accesible para personas ciegas/with discapacidad visual
que muestre: edificios, escaleras, rampas, baños, salidas de emergencia,
puntos de reunion, zonas de descanso, entradas/salidas, y mas.

La app corre en el celular del usuario y se conecta a una Mac que hace de servidor
a traves de un tunel Cloudflare.

## Equipo de trabajo

- 4 personas, 2 equipos de 2
- 4 horas diarias de trabajo
- Equipo 1 (Marco + 1): Desarrollo tecnico (app, backend, GPS, features)
- Equipo 2 (2 personas): Mapeo en campo, pruebas con usuarios, documentacion
- **IMPORTANTE:** Responder SIEMPRE en espanol, con ortografia correcta (tildes, ñ, signos ¿¡)

## Stack tecnico

- **Backend:** Python 3 + Flask + SQLite + flask-cors
- **Frontend:** HTML5 + CSS3 + JavaScript vanilla + Leaflet.js (OpenStreetMap)
- **PWA:** manifest.webmanifest, icon.png
- **Encaje a caminos peatonales:** GraphHopper API (perfil `foot`, clave en `.graphhopper_key`)
- **Tunel:** Cloudflare (binario `cloudflared`, no instalar con Homebrew — la red es lenta)
- **Hosting:** Local en Mac, acceso desde celular via tunel

## Estructura del proyecto

```
mapeo-fes/
├── app.py                   # Backend Flask + endpoints REST
├── templates/
│   └── index.html           # Interfaz principal de la app
├── static/
│   ├── app.js               # Logica del frontend (GPS, mapa, tracking, UI)
│   ├── style.css            # Estilos CSS (WCAG 2.1 AA)
│   ├── icon.png             # Icono PWA
│   └── manifest.webmanifest # Configuracion PWA
├── recorrido_fes.html       # Mapa estatico exportable (para mostrar al jefe)
├── exportar_datos.py        # Script para exportar DB a JSON
├── iniciar.sh               # Servidor local (misma WiFi)
├── iniciar_celular.sh       # Servidor con tunel Cloudflare + caffeinate
├── requirements.txt         # flask==3.0.0, flask-cors==4.0.0
├── gantt_servicio_social.xlsx # Gantt del proyecto (actualizar cuando se complete algo)
├── gantt_tareas.json        # Datos del Gantt en JSON (para programaticamente actualizar)
├── generar_gantt.py         # Script que genera el Excel del Gantt
├── .graphhopper_key         # Clave API de GraphHopper (NO subir a GitHub)
├── .gitignore               # Excluye: .graphhopper_key, mapeo.db, venv/, __pycache__, cloudflared
├── mapeo.db                 # Base de datos SQLite (se crea sola, no subir)
├── venv/                    # Entorno virtual (no subir)
└── cloudflared              # Binario del tunel (no subir, descargar aparte)
```

## Como levantar la app

### Opcion A: Local (misma WiFi)
```bash
cd mapeo-fes
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
# Abrir http://localhost:5000 en el navegador
```

### Opcion B: Con tunel Cloudflare (datos moviles del celular)
```bash
# Necesitas el binario cloudflared en la carpeta del proyecto
./iniciar_celular.sh
# Te mostrara una URL tipo https://xxx.trycloudflare.com
# Abrir esa URL en el navegador del celular
```

## Base de datos (SQLite)

### Tabla `puntos`
| Columna | Tipo | Descripcion |
|---------|------|-------------|
| id | INTEGER PK | Autoincremental |
| tipo | TEXT | Tipo de punto (ver abajo) |
| lat | REAL | Latitud GPS |
| lng | REAL | Longitud GPS |
| descripcion | TEXT | Nombre/descripcion del punto |
| foto | TEXT | (reservado, vacio por ahora) |
| timestamp | TEXT | ISO 8601 |
| sesion | TEXT | ID de sesion (ej: sesion-20260901-101126) |
| color | TEXT | Color hex para el marcador (ej: #ef4444) |

### Tabla `tracks`
| Columna | Tipo | Descripcion |
|---------|------|-------------|
| id | INTEGER PK | Autoincremental |
| sesion | TEXT | ID de sesion |
| lat | REAL | Latitud GPS |
| lng | REAL | Longitud GPS |
| timestamp | TEXT | ISO 8601 |

### Tipos de puntos disponibles
`banio`, `biblioteca`, `edificio`, `acceso`, `alarma`, `escaleras`, `escalon`, `rampa`, `reunion`, `descanso`, `emergencia`, `entrada_salida`, `otro`

### IDs de sesion
Formato: `sesion-AAAAmmdd-HHMMSS` (ej: `sesion-20260901-101126`)

## Endpoints de la API

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/` | Sirve index.html |
| POST | `/api/punto` | Guardar punto de interes (con color) |
| GET | `/api/puntos?sesion=X` | Obtener puntos de una sesion |
| DELETE | `/api/punto/<id>` | Eliminar un punto |
| PATCH | `/api/punto/<id>/color` | Cambiar color de un punto |
| PATCH | `/api/punto/<id>/descripcion` | Cambiar nombre de un punto |
| PATCH | `/api/punto/<id>/posicion` | Corregir posicion de un punto |
| POST | `/api/track` | Guardar punto de track |
| GET | `/api/track?sesion=X` | Obtener track de una sesion |
| GET | `/api/snap?lat1&lng1&lat2&lng2` | Encajar tramo a caminos peatonales (GraphHopper) |
| GET | `/api/exportar?sesion=X` | Exportar sesion completa a JSON |
| GET | `/api/resumen` | Resumen de sesiones (conteo de puntos y track) |
| GET | `/api/sesiones` | Listar IDs de sesiones |
| DELETE | `/api/sesion/<sesion>` | Borrar toda una sesion |
| DELETE | `/api/todo` | Borrar toda la base de datos |

## Funcionalidades implementadas

1. **Mapa interactivo** con Leaflet.js + OpenStreetMap
2. **GPS en tiempo real** con watchPosition (alta precision)
3. **Tracking continuo** cada 5 segundos con filtro de duplicados (min 3 metros)
4. **Encaje a caminos peatonales** via GraphHopper (perfil foot)
5. **13 tipos de puntos** con colores: baño, biblioteca, edificio, acceso, alarma, escaleras, escalon, rampa, reunion, descanso, emergencia, entrada_salida, otro
6. **Selector de color** antes de marcar (8 colores)
7. **Edicion de puntos** guardados: cambiar nombre, color, eliminar
8. **Gestion de datos**: ver/borrar sesiones y puntos individuales
9. **Respaldo local** en localStorage si falla la conexion
10. **Monitoreo de conexion** cada 10 segundos con avisos
11. **Exportar a HTML estatico** (recorrido_fes.html) con mapa visual
12. **PWA** instalable en el celular
13. **Accesibilidad WCAG 2.1 AA**: contraste, navegacion por teclado, aria labels, toast con aria-live
14. **Tunel Cloudflare** con reconexion automatica y caffeinate para evitar que la Mac se duerma

## Funcionalidades pendientes (ver Gantt)

- Compartir recorrido via QR/WhatsApp
- Narracion por voz de puntos cercanos al acercarse
- Optimizacion de bateria/rendimiento
- Pruebas de usabilidad con personas ciegas
- Documento de servicio social
- Presentacion final

## Gantt del proyecto

El archivo `gantt_servicio_social.xlsx` contiene las 20 tareas del proyecto.
El archivo `gantt_tareas.json` tiene los datos en JSON para poder actualizar
el Gantt programaticamente.

### Para actualizar el Gantt cuando se complete una tarea:
1. Leer `gantt_tareas.json`
2. Cambiar el `"estado"` de la tarea a `"Completada"`
3. Ejecutar `python generar_gantt.py` para regenerar el Excel
4. Hacer commit y push

## Convenciones de codigo

- **JS:** vanilla, sin frameworks, funciones simples y claras
- **CSS:** sin preprocesadores, directo en style.css
- **Python:** Flask, sin ORM (SQL directo), sin dependencias innecesarias
- **HTML:** accesible (aria labels, roles, aria-live para cambios dinamicos)
- **Colores de botones:** deben tener contraste WCAG AA con texto blanco (minimo 4.5:1)
- **Objetivo tactil minimo:** 44x44 px para botones en celular
- **Idioma del codigo:** comentarios y variables en espanol
- **Idioma de la UI:** espanol

## GraphHopper

- Clave en `.graphhopper_key` (NO subir a GitHub)
- Perfil: `foot` (peatonal)
- Cuota gratis: ~500 llamadas/dia
- Limite implementado: 300 encajes por sesion
- Sin clave: la app funciona pero el track queda como linea cruda del GPS
- Endpoint: `/api/snap?lat1&lng1&lat2&lng2` (devuelve geometria encajada)

## Tareas comunes

### Agregar un nuevo tipo de punto
1. Agregar en `tipos` de `app.js` el nuevo tipo con su emoji
2. Agregar en `textoTipo` de `app.js` el texto sin emoji
3. Agregar en `coloresTipo` de `dibujarPuntoEnMapa` el color
4. Agregar boton en `index.html` dentro de `.grilla-puntos`
5. Agregar clase CSS en `style.css` (`.punto-btn.NUEVO_TIPO`)
6. Actualizar `recorrido_fes.html` leyenda y colores

### Agregar un nuevo endpoint
1. Crear la funcion en `app.py` con `@app.route(...)`
2. Usar `get_db()` para conectar a SQLite
3. Usar `conn.commit()` y `conn.close()`
4. Probar con curl desde la terminal

### Agregar un nuevo endpoint de edicion de puntos
1. Crear en `app.py` con metodo PATCH
2. Agregar la funcion fetch en `app.js` (ej: `actualizarDescripcion`)
3. Llamar desde la UI correspondiente

### Subir cambios a GitHub
```bash
git add -A
git commit -m "Descripcion clara del cambio"
git push origin main
```

### Actualizar el Gantt
1. Editar `gantt_tareas.json` (cambiar estado de la tarea)
2. Ejecutar `python generar_gantt.py`
3. `git add gantt_servicio_social.xlsx gantt_tareas.json`
4. `git commit -m "Actualiza Gantt: [tarea completada]"`
5. `git push origin main`

## Archivos que NUNCA se suben a GitHub

- `.graphhopper_key` (clave API)
- `mapeo.db` (datos locales)
- `venv/` (entorno virtual)
- `__pycache__/` (cache Python)
- `cloudflared` (binario de 38MB)

## Error comun: URL del tunel cambia

Cloudflare sin cuenta genera links nuevos si el proceso se reinicia.
El script `iniciar_celular.sh` maneja esto automaticamente:
- Solo genera link nuevo si cloudflared realmente murio
- La app del celular detecta la perdida de conexion y avisa
- Los datos pendientes se sincronizan cuando se recupera la conexion
