# Mapeo FES — Prototipo de mapeo accesible para ciegos

App web (Flask + SQLite + Leaflet + PWA) para registrar recorridos y puntos de interés en la FES. Diseñada con accesibilidad (WCAG 2.1 AA) para usarse con lector de pantalla.

## Qué hace

- Registra un **recorrido** (track) y **puntos de interés** (baños, edificios, rampas, etc.) desde el GPS del celular.
- El trackeo **se ajusta a los caminos peatonales** del mapa gracias a GraphHopper.
- Cada punto puede tener un **color** para diferenciarlo por zona.
- Se pueden **ver, editar y eliminar** los puntos ya guardados.
- Se puede exportar el mapa visible a un archivo HTML para mostrarlo.

## Requisitos

- Python 3 (con `pip`)
- Una mac o computadora para servir la app
- Un celular para hacer el recorrido (opcional, también se puede desde la computadora)

## Instalación

```bash
# Crear el entorno virtual
python3 -m venv venv
source venv/bin/activate

# Instalar dependencias
pip install -r requirements.txt
```

## Configurar la clave de GraphHopper (para que el track siga los caminos)

El encaje a caminos peatonales usa la API gratuita de GraphHopper.

1. Regístrate gratis en https://www.graphhopper.com/
2. Copia tu **API key** del panel.
3. En la carpeta del proyecto, crea un archivo llamado `.graphhopper_key` y pega tu clave dentro (sin espacios ni saltos de línea).

Sin la clave, la app funciona igual, pero el recorrido queda como la línea cruda del GPS (no se pega a los caminos).

## Cómo usarlo

### Opción A: en la misma red WiFi (celular y computadora juntas)

```bash
./iniciar.sh
```

Se mostrará la IP local. En el celular (misma WiFi) abre `http://IP:5000`.

### Opción B: usar internet del celular (datos móviles) con túnel Cloudflare

Ese flujo usa el binario `cloudflared` (que no está incluido en este repo por su tamaño). Descárgalo de https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ y colócalo en la carpeta del proyecto, luego:

```bash
./iniciar_celular.sh
```

El script te dará una URL pública `https://...trycloudflare.com` para abrir desde cualquier lugar.

## Estructura

```
app.py              Servidor Flask + API
templates/index.html  Interfaz web
static/             JS, CSS, PWA
exportar_datos.py   Exporta toda la base a JSON
iniciar.sh          Servidor local (misma WiFi)
iniciar_celular.sh  Servidor con túnel Cloudflare
requirements.txt    Dependencias
```

## Notas para quien recibe el repo

- Crea tu propio archivo `.graphhopper_key` con tu clave personal (no se comparte).
- La base de datos `mapeo.db` se crea sola la primera vez que inicia el servidor.
