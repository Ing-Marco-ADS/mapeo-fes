#!/bin/bash

# Iniciar servidor de Mapeo FES
echo "=== Iniciando Mapeo FES ==="

# Obtener IP local
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
if [ -z "$IP" ]; then
    IP="localhost"
fi

echo ""
echo "📱 Para usar en tu celular:"
echo "   Asegurate de que tu celular y esta Mac esten en la misma red WiFi"
echo "   Abre en el navegador de tu celular: http://${IP}:5000"
echo ""
echo "🖥️  Para usar en la Mac:"
echo "   Abre en tu navegador: http://localhost:5000"
echo ""
echo "Ctrl+C para detener"
echo "========================="
echo ""

# Crear entorno virtual si no existe
if [ ! -d "venv" ]; then
    echo "Creando entorno virtual..."
    python3 -m venv venv
fi

# Activar entorno virtual
source venv/bin/activate

# Instalar dependencias si no estan
pip install -q -r requirements.txt

python app.py