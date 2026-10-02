// Pantalla de prueba de la brújula: muestra el norte en tiempo real y el
// rumbo al que apunta tu telefono, para verificar que el sensor funciona.
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useUbicacionGlobal } from '../hooks/useUbicacion';
import { hablar } from '../lib/voz';
import Brujula from '../components/Brujula';

export default function PantallaBrujula() {
  const { ubica, pedirPermisos, magnetica, necesitaCalibrar } = useUbicacionGlobal();
  const [, setSegundo] = useState(() => Date.now());
  // Diagnostico del sensor (solo para saber si llegan eventos y si son
  // absolutos o relativos en este navegador/teléfono).
  const [sensor, setSensor] = useState({ hayEvento: false, absoluto: false });

  useEffect(() => {
    const muestra = { current: false, actual: false };
    const onEvento = (ev) => {
      if (ev.alpha != null || ev.gamma != null || ev.webkitCompassHeading != null) {
        muestra.current = true;
        muestra.actual = ev.absolute === true;
      }
    };
    const t = setInterval(() => {
      setSegundo(Date.now());
      setSensor({ hayEvento: muestra.current, absoluto: muestra.actual });
    }, 250);
    if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientation', onEvento, true);
      window.addEventListener('deviceorientationabsolute', onEvento, true);
    }
    return () => {
      clearInterval(t);
      if (typeof window !== 'undefined') {
        window.removeEventListener('deviceorientation', onEvento, true);
        window.removeEventListener('deviceorientationabsolute', onEvento, true);
      }
    };
  }, []);

  const rumboPantalla = ubica?.rumboPantalla ?? null;

  const activarBrujula = async () => {
    await pedirPermisos();
    hablar('Brújula activada. Gira el teléfono despacio para calibrar el norte.');
  };

  const grados = rumboPantalla != null ? ((rumboPantalla % 360) + 360) % 360 : null;

  // Detecta si venimos de un navegador embebido (WhatsApp, Telegram, etc.).
  // Esos mini-navegadores bloquean los sensores de orientacion (la brujula).
  let navegadorEmbebido = false;
  if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string') {
    navegadorEmbebido = /WhatsApp|FBAN|FBAV|Instagram|Messenger|Telegram|Viber|Line\//i.test(
      navigator.userAgent,
    );
  }
  const sinSensor = grados == null && navegadorEmbebido;

  return (
    <View style={styles.contenedor}>
      <Text style={styles.titulo} accessibilityRole="header">
        Brújula en tiempo real
      </Text>
      <Text style={styles.subtitulo} accessible={true}>
        La aguja roja señala el norte.
      </Text>

      <Brujula rumboPantalla={grados} tamaño={280} />

      <Text style={styles.lectura} accessible={true}>
        {grados != null ? `Tu pantalla apunta a ${Math.round(grados)}°` : 'Brújula sin señal'}
      </Text>

      {grados != null ? (
        <Text style={styles.detalle} accessible={true}>
          {magnetica
            ? 'Norte real del sensor magnético (calibrado con la declinación del lugar).'
            : 'Sensor en modo relativo: gira y se ajustará con precisión cuando camines unos pasos.'}
        </Text>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
          onPress={activarBrujula}
          accessibilityRole="button"
          accessibilityLabel="Activar brújula"
          accessibilityHint="Pide el permiso del giroscopio del teléfono"
        >
          <Text style={styles.botonTexto}>Activar brújula</Text>
        </Pressable>
      )}

      <Text style={styles.diag} accessible={true}>
        Diagnóstico: sensor {sensor.hayEvento ? 'recibiendo' : 'sin eventos'} ·{' '}
        {sensor.absoluto ? 'absoluto' : 'relativo'}
      </Text>

      {necesitaCalibrar && (
        <Text style={styles.avisoCalibrar} accessible={true}>
          Calibra el norte: haz una figura de ocho (8) en el aire con el teléfono.
        </Text>
      )}

      {sinSensor && (
        <View style={styles.avisoWebView}>
          <Text style={styles.avisoWebViewTitulo}>Estás en el navegador de WhatsApp</Text>
          <Text style={styles.avisoWebViewTexto} accessible={true}>
            WhatsApp apaga los sensores y no deja usar la brújula. Arriba a la
            derecha toca los 3 puntitos (⋮) y elige «Abrir en el navegador» (Chrome).
          </Text>
        </View>
      )}

      {grados == null && !navegadorEmbebido && (
        <Text style={styles.ayuda} accessible={true}>
          Si no se activa: abre esta dirección en Safari o Chrome (no dentro de
          WhatsApp/Telegram, que apagan los sensores) y pulsa «Activar brújula».
          Caminar unos pasos también activa la brújula de GPS.
        </Text>
      )}

      {grados != null && (
        <Text style={styles.ayuda} accessible={true}>
          Gira el teléfono despacio si la aguja no se mueve (calibración).
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    flex: 1,
    backgroundColor: '#f0f2f5',
    padding: 16,
    alignItems: 'center',
    gap: 14,
  },
  titulo: { fontSize: 20, fontWeight: '800', color: '#1F4E79', textAlign: 'center' },
  subtitulo: { fontSize: 15, color: '#374151', textAlign: 'center' },
  lectura: { fontSize: 22, fontWeight: '700', color: '#111827', textAlign: 'center' },
  detalle: { fontSize: 14, color: '#4b5563', textAlign: 'center' },
  diag: { fontSize: 12, color: '#9ca3af', textAlign: 'center' },
  avisoCalibrar: { fontSize: 14, fontWeight: '700', color: '#92400e', textAlign: 'center', lineHeight: 20 },
  avisoWebView: {
    backgroundColor: '#7f1d1d',
    padding: 14,
    borderRadius: 12,
    gap: 6,
  },
  avisoWebViewTitulo: { color: '#fff', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  avisoWebViewTexto: { color: '#fecaca', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  ayuda: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: 6, lineHeight: 18 },
  boton: {
    backgroundColor: '#15803d',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  botonPresionado: { opacity: 0.75 },
  botonTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
});