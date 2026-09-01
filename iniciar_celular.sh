#!/bin/bash

# === Mapeo FES - Modo Celular con RECONEXION AUTOMATICA ===
# Inicia el servidor y un tunel Cloudflare. Si el tunel se cae
# (por WiFi inestable), detecta cortes y genera uno NUEVO automaticamente,
# mostrando la URL fresca para conectar el celular.

cd "$(dirname "$0")"

echo "=============================================="
echo "   MAPEO FES - MODO CELULAR (DATOS MOVILES)"
echo "   CON RECONEXION AUTOMATICA"
echo "=============================================="
echo ""

# Limpiar procesos anteriores
pkill -9 -f "cloudflared tunnel" 2>/dev/null
pkill -9 -f "python app.py" 2>/dev/null
pkill -9 -f "caffeinate" 2>/dev/null
sleep 1

# ============================================================
#  MANTENER LA MAC DESPIERTA AUNQUE CIERRES LA TAPA
#  caffeinate previene el sueno del sistema y del disco.
#  -s : evita el sueno al cerrar la tapa (clamshell)
#  -i : evita el sueno por inactividad
#  -m : evita el sueno del disco
#  Se apaga automaticamente al detener este script (trap abajo)
# ============================================================
echo "Activando modo anti-sueno (puedes cerrar la tapa)..."
caffeinate -s -i -m &
CAFFEINATE_PID=$!
echo "✓ Modo anti-sueno activado"

# Detener todo al salir (Ctrl+C)
trap "echo ''; echo 'Apagando modos y deteniendo...'; kill $CAFFEINATE_PID 2>/dev/null; pkill -TERM -P $$ 2>/dev/null; pkill -9 -f 'cloudflared tunnel' 2>/dev/null; pkill -9 -f 'python app.py' 2>/dev/null; pkill -9 -f 'caffeinate' 2>/dev/null; echo 'Detenido.'; exit 0" INT TERM EXIT

# Crear entorno virtual si no existe
if [ ! -d "venv" ]; then
    echo "Creando entorno virtual..."
    python3 -m venv venv
fi

# Activar y actualizar dependencias
source venv/bin/activate
pip install -q -r requirements.txt

# Iniciar servidor Flask en segundo plano
echo "Iniciando servidor local..."
python app.py > /tmp/mapeo_flask.log 2>&1 &
SERVER_PID=$!

# Esperar a que el servidor arranque
for i in $(seq 1 10); do
    sleep 1
    if curl -s -o /dev/null http://localhost:5000/; then
        echo "✓ Servidor local OK"
        break
    fi
done

if ! curl -s -o /dev/null http://localhost:5000/; then
    echo "✗ El servidor local no arranco. Revisa /tmp/mapeo_flask.log"
    kill $SERVER_PID 2>/dev/null
    exit 1
fi

# Archivo temporal donde guardamos la URL del tunel actual
URL_FILE=/tmp/mapeo_url_actual.txt
rm -f "$URL_FILE"

# ============================================================
#  Inicia un tunel nuevo y escribe la URL en $URL_FILE
#  Lanza cloudflared en segundo plano (no lo esperamos aqui)
# ============================================================
iniciar_tunel() {
    # Limpiar archivo de URL
    rm -f "$URL_FILE"

    # Lanzar cloudflared en segundo plano
    ./cloudflared tunnel --url http://localhost:5000 --no-autoupdate > /tmp/mapeo_tunel.log 2>&1 &
}

# ============================================================
#  Espera a que la URL aparezca en el log (hasta ~25s)
#  Devuelve 0 si la encontro, 1 si fallo
# ============================================================
esperar_url() {
    for i in $(seq 1 12); do
        sleep 2
        URL_FOUND=$(grep -aoE "https://[a-zA-Z0-9.-]+\.trycloudflare\.com" /tmp/mapeo_tunel.log 2>/dev/null | head -1)
        if [ -n "$URL_FOUND" ]; then
            echo "$URL_FOUND" > "$URL_FILE"
            return 0
        fi
    done
    return 1
}

# ============================================================
#  Arranque inicial
# ============================================================
echo "Iniciando primer tunel..."
iniciar_tunel

if esperar_url; then
    ACTUAL=$(cat "$URL_FILE")
    echo ""
    echo "=============================================="
    echo "   ✅ TU CELULAR YA PUEDE CONECTARSE"
    echo ""
    echo "   📱  ${ACTUAL}"
    echo ""
    echo "   Abre esa direccion en el navegador de tu celular"
    echo "   (Chrome/Safari) con DATOS MOVILES o cualquier WiFi."
    echo ""
    echo "   Si el tunel se cae, generare una URL NUEVA"
    echo "   y te la mostrare aqui. Recarga el celular con"
    echo "   la URL nueva si ocurre."
    echo ""
    echo "   💾 La Mac NO se dormira aun si cierras la tapa."
    echo "      Mantenla conectada a la corriente."
    echo ""
    echo "   Presiona Ctrl+C para detener todo."
    echo "=============================================="
    echo ""
else
    echo "✗ No se pudo crear el tunel inicial. Revisa tu conexion a internet."
    echo "  Log: /tmp/mapeo_tunel.log"
    kill $SERVER_PID 2>/dev/null
    exit 1
fi

# ============================================================
#  Bucle de supervision continua
#  Estrategia: es prudente y NO rota el link innecesariamente.
#  Solo se genera un tunel NUEVO si el proceso cloudflared
#  realmente murio. Los errores menores de red se ignoran, ya
#  que cloudflared se reconecta solo con la misma URL.
# ============================================================
ULTIMA="$ACTUAL"
while true; do
    sleep 10

    # El proceso del tunel se murio -> hay que generar uno NUEVO
    if ! pgrep -f "cloudflared tunnel" > /dev/null 2>&1; then
        echo ""
        echo "🔄  El proceso del tunel murio. Generando uno NUEVO..."
        echo "     (Verifica que tu Mac tenga internet)"
        iniciar_tunel
        if esperar_url; then
            ACTUAL=$(cat "$URL_FILE")
            echo ""
            echo "   ✅ NUEVA URL DE CONEXION (la anterior ${ULTIMA} dejo de servir):"
            echo ""
            echo "   📱  ${ACTUAL}"
            echo ""
            echo "   Actualiza la direccion en tu celular a la nueva."
            echo ""
            ULTIMA="$ACTUAL"
        else
            echo "✗ No se pudo reconectar ahora. Reintentare en 15 seg (revisa tu WiFi)."
            sleep 15
        fi
    fi
done
