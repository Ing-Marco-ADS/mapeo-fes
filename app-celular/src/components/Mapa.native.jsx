// "Mapa" para iOS/Android SIN Google Maps.
// Motivo: react-native-maps en Android se apoya en el SDK de Google Maps y,
// sin una clave de Google (com.google.android.geo.API_KEY), la app se CERRABA
// al abrir (RuntimeException: API key not found). No queremos depender de una
// cuenta de Google, asi que aqui dibujamos un RADAR con Views normales:
//   - tu ubicacion queda en el centro;
//   - cada punto del mapeo se coloca segun su rumbo y distancia REALES;
//   - tres anillos dan escala (el borde equivale al alcance maximo).
// La guia principal es por VOZ; este radar es el apoyo visual.
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { distanciaMetros, rumboEntre } from '../lib/geo';

const ALCANCE_M = 250; // radio del radar en metros (el borde = este alcance)

export default function Mapa({ puntos, ubica, alSeleccionarPunto }) {
  const [caja, setCaja] = useState({ ancho: 0, alto: 0 });

  const onLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    setCaja({ ancho: width, alto: height });
  };

  const lado = Math.min(caja.ancho, caja.alto) || 0;
  const radio = lado / 2 - 8;
  const centroX = caja.ancho / 2;
  const centroY = caja.alto / 2;
  const rumboPantalla = ubica?.rumboPantalla ?? ubica?.rumbo ?? 0;

  // Convierte (lat, lng) en una posicion dentro del radar. Arriba = hacia
  // donde miras/caminas (heading-up); los lejanos se pegan al borde.
  function posicionDe(lat, lng) {
    const d = distanciaMetros(ubica.lat, ubica.lng, lat, lng);
    const rumbo = rumboEntre(ubica.lat, ubica.lng, lat, lng);
    const ang = ((rumbo - rumboPantalla) * Math.PI) / 180;
    const r = Math.min(d / ALCANCE_M, 1) * radio;
    return {
      x: centroX + r * Math.sin(ang),
      y: centroY - r * Math.cos(ang),
      lejos: d > ALCANCE_M,
    };
  }

  return (
    <View style={styles.contenedor} onLayout={onLayout}>
      {/* Anillos de distancia (escala) */}
      {radio > 0 &&
        [0.33, 0.66, 1].map((f) => (
          <View
            key={f}
            style={[
              styles.anillo,
              {
                width: radio * 2 * f,
                height: radio * 2 * f,
                borderRadius: radio * f,
                left: centroX - radio * f,
                top: centroY - radio * f,
              },
            ]}
          />
        ))}

      {/* Puntos del mapeo */}
      {ubica &&
        radio > 0 &&
        puntos.map((p) => {
          const pos = posicionDe(p.lat, p.lng);
          return (
            <Pressable
              key={p.id}
              onPress={() => alSeleccionarPunto?.(p)}
              accessibilityRole="button"
              accessibilityLabel={p.nombre}
              style={[
                styles.punto,
                {
                  left: pos.x - 9,
                  top: pos.y - 9,
                  backgroundColor: p.color || '#78909c',
                  opacity: pos.lejos ? 0.45 : 1,
                },
              ]}
            />
          );
        })}

      {/* Mi ubicacion en el centro */}
      {ubica && (
        <View style={[styles.yo, { left: centroX - 12, top: centroY - 12 }]}>
          <View style={styles.yoNucleo} />
        </View>
      )}

      {/* Mensaje mientras no hay GPS */}
      {!ubica && (
        <View style={styles.centroMensaje}>
          <Text style={styles.mensaje}>Esperando señal del GPS…</Text>
        </View>
      )}

      {/* Referencia de alcance */}
      {ubica && radio > 0 && (
        <Text style={[styles.escala, { top: 8 }]}>borde ≈ {ALCANCE_M} m</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    flex: 1,
    backgroundColor: '#dbe3ec',
    overflow: 'hidden',
  },
  anillo: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(31,78,121,0.25)',
  },
  punto: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#fff',
  },
  yo: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(37,99,235,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#2563eb',
  },
  yoNucleo: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2563eb',
  },
  centroMensaje: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mensaje: { color: '#1F4E79', fontSize: 16, fontWeight: '600' },
  escala: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#1F4E79',
    fontSize: 12,
    opacity: 0.7,
  },
});
