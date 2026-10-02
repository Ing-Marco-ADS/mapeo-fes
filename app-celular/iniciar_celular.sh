#!/bin/bash

# === Mapeo FES - App Celular Web por DATOS MOVILES ===
# Compila la app web (igual que la PWA de trackeo) y la expone
# por un tunel Cloudflare. El CELULAR se conecta con DATOS MOVILES
# o cualquier WiFi: NO necesita estar en la misma red que la Mac.
#
# La app se puede INSTALAR en el celular (Agregar a inicio) y al
# reabrirla queda como app: no importa si el celular se suspendio.

cd "$(dirname "$0")"

BIN_CLOUDFLARED="$(cd "$(dirname "$0")"; pwd)/../cloudflared"
PUERTO=8081
DIST_DIR="$(cd "$(dirname "$0")"; pwd)/dist"

echo "=============================================="
echo "   MAPEO FES - APP CELULAR (DATOS MOVILES)"
echo "   CON RECONEXION AUTOMATICA"
echo "=============================================="
echo ""

# Limpiar procesos anteriores de ESTA app
pkill -9 -f "expo export" 2>/dev/null
pkill -9 -f "http.server.*8081" 2>/dev/null
pkill -9 -f "cloudflared tunnel --url http://localhost:8081" 2>/dev/null
pkill -9 -f "caffeinate" 2>/dev/null
sleep 1

# ============================================================
#  MANTENER LA MAC DESPIERTA (cierre de tapa incluido)
# ============================================================
echo "Activando modo anti-sueno (puedes cerrar la tapa)..."
caffeinate -s -i -m &
CAFFEINATE_PID=$!
echo "OK Modo anti-sueno activado"

# Detener todo al salir
trap "echo ''; echo 'Apagando modos y deteniendo...'; kill \$CAFFEINATE_PID 2>/dev/null; pkill -TERM -P \$\$ 2>/dev/null; pkill -9 -f 'http.server' 2>/dev/null; pkill -9 -f 'cloudflared tunnel' 2>/dev/null; pkill -9 -f 'caffeinate' 2>/dev/null; echo 'Detenido.'; exit 0" INT TERM EXIT

# Verificar binario de cloudflared
if [ ! -f "$BIN_CLOUDFLARED" ]; then
    echo "No encuentro el binario cloudflared. Buscalo en .. (la carpeta del proyecto)"
    echo "Puedes bajarlo: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    exit 1
fi

# ============================================================
#  Compilar la app web a archivos estaticos (dist/)
# ============================================================
echo "Compilando la app web (unos segundos)..."
CI=1 npx expo export --platform web --output-dir "$DIST_DIR" > /tmp/mapeo_web_build.log 2>&1
if [ $? -ne 0 ] || [ ! -f "$DIST_DIR/index.html" ]; then
    echo "La compilacion fallo. Revisa /tmp/mapeo_web_build.log"
    kill $CAFFEINATE_PID 2>/dev/null
    exit 1
fi
echo "OK Compilacion lista (dist/)"

# ============================================================
#  Servir la carpeta dist/ con un servidor web local
# ============================================================
echo "Iniciando servidor local en el puerto $PUERTO..."
nohup python3 -m http.server "$PUERTO" --directory "$DIST_DIR" > /tmp/mapeo_web_server.log 2>&1 &
SERVER_PID=$!

# Esperar a que responda
for i in $(seq 1 15); do
    sleep 1
    if curl -s -o /dev/null "http://localhost:$PUERTO/"; then
        echo "OK Servidor local listo: http://localhost:$PUERTO"
        break
    fi
done

if ! curl -s -o /dev/null "http://localhost:$PUERTO/"; then
    echo "El servidor no arranco. Revisa /tmp/mapeo_web_server.log"
    kill $SERVER_PID 2>/dev/null
    kill $CAFFEINATE_PID 2>/dev/null
    exit 1
fi

# Archivo donde guardamos la URL del tunel actual
URL_FILE=/tmp/mapeo_web_url.txt
rm -f "$URL_FILE"

# ============================================================
#  Iniciar tunel Cloudflare hacia el puerto local
# ============================================================
iniciar_tunel() {
    rm -f "$URL_FILE"
    "$BIN_CLOUDFLARED" tunnel --url "http://localhost:$PUERTO" --no-autoupdate > /tmp/mapeo_web_tunel.log 2>&1 &
}

esperar_url() {
    for i in $(seq 1 12); do
        sleep 2
        URL_FOUND=$(grep -aoE "https://[a-zA-Z0-9.-]+\.trycloudflare\.com" /tmp/mapeo_web_tunel.log 2>/dev/null | head -1)
        if [ -n "$URL_FOUND" ]; then
            echo "$URL_FOUND" > "$URL_FILE"
            return 0
        fi
    done
    return 1
}

echo "Iniciando primer tunel..."
iniciar_tunel

if esperar_url; then
    ACTUAL=$(cat "$URL_FILE")
    echo ""
    echo "=============================================="
    echo "   LISTO: TU CELULAR YA PUEDE CONECTARSE"
    echo ""
    echo "   App: ${ACTUAL}"
    echo ""
    echo "   PARA INSTALARLA COMO APP (opcional):"
    echo "   1) Abre esa direccion en Chrome del celular"
    echo "   2) Menu (3 puntos) -> 'Agregar a inicio', o en"
    echo "      iPhone: Compartir -> 'Agregar a pantalla de"
    echo "      inicio'."
    echo "   3) Quedara instalada como 'Mapa FES' y al abrirla"
    echo "      funcionara como app, aunque el celular se" 
    echo "      haya suspendido."
    echo ""
    echo "   Funciona con DATOS MOVILES o cualquier WiFi."
    echo "   La Mac NO se dormira aun con la tapa cerrada."
    echo "   Mantenla conectada a la corriente."
    echo ""
    echo "   Presiona Ctrl+C para detener todo."
    echo "=============================================="
    echo ""
else
    echo "No se pudo crear el tunel inicial. Revisa tu conexion a internet."
    echo "Log: /tmp/mapeo_web_tunel.log"
    kill $SERVER_PID 2>/dev/null
    kill $CAFFEINATE_PID 2>/dev/null
    exit 1
fi

# ============================================================
#  Supervision continua (recrear tunel si muere)
# ============================================================
ULTIMA="$ACTUAL"
while true; do
    sleep 10

    # El proceso del tunel murio -> generar uno NUEVO
    if ! pgrep -f "cloudflared tunnel --url http://localhost:$PUERTO" > /dev/null 2>&1; then
        echo ""
        echo "El proceso del tunel murio. Generando uno NUEVO..."
        echo "   (Verifica que tu Mac tenga internet)"
        iniciar_tunel
        if esperar_url; then
            ACTUAL=$(cat "$URL_FILE")
            echo ""
            echo "   NUEVA URL DE CONEXION (${ULTIMA} dejo de servir):"
            echo ""
            echo "   ${ACTUAL}"
            echo ""
            echo "   Actualiza la direccion en tu celular a la nueva."
            echo ""
            ULTIMA="$ACTUAL"
        else
            echo "No se pudo reconectar ahora. Reintentare en 15 seg (revisa tu WiFi)."
            sleep 15
        fi
    fi
done