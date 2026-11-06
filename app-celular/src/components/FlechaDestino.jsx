// Flecha que indica hacia donde queda el destino RESPECTO A TI.
// Recibe `giro` en grados: 0 = de frente, positivo = a tu derecha,
// negativo = a tu izquierda. No necesita brujula: funciona con el curso
// de caminata del GPS.
import { View, StyleSheet } from 'react-native';
import { C, SOMBRA_SUAVE } from '../lib/tema';

const BASE = 170;

export default function FlechaDestino({ giro, tamaño = BASE, activo = true }) {
  const angulo = giro == null ? 0 : giro;
  const s = tamaño / BASE;
  const centro = tamaño / 2;

  return (
    <View
      style={[
        styles.marco,
        {
          width: tamaño,
          height: tamaño,
          borderRadius: tamaño / 2,
          opacity: activo ? 1 : 0.5,
        },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Anillo interior punteado */}
      <View
        style={[
          styles.anilloInterno,
          {
            width: tamaño * 0.78,
            height: tamaño * 0.78,
            borderRadius: tamaño * 0.39,
            left: tamaño * 0.11,
            top: tamaño * 0.11,
          },
        ]}
      />

      {/* Marcas cada 30 grados */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {Array.from({ length: 12 }, (_, i) => (
          <View
            key={i}
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ rotate: `${i * 30}deg` }] },
            ]}
          >
            <View
              style={[
                styles.tick,
                {
                  left: centro - 1,
                  top: 7 * s,
                  width: 2 * s,
                  height: (i % 3 === 0 ? 9 : 5) * s,
                  backgroundColor: i % 3 === 0 ? C.azul : C.azulBorde,
                },
              ]}
            />
          </View>
        ))}
      </View>

      {/* Muesca fija arriba: hacia donde vas / apunta el telefono */}
      <View style={[styles.muesca, { width: 34 * s, height: 16 * s, borderBottomLeftRadius: 8 * s, borderBottomRightRadius: 8 * s, marginLeft: -17 * s }]} />

      {/* Flecha giratoria */}
      <View
        style={[
          styles.flecha,
          {
            width: 110 * s,
            height: 132 * s,
            transform: [{ rotate: `${angulo}deg` }],
          },
        ]}
      >
        <View
          style={[
            styles.halo,
            {
              width: 76 * s,
              height: 76 * s,
              borderRadius: 38 * s,
              top: 26 * s,
              left: '50%',
              marginLeft: -38 * s,
            },
          ]}
        />
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: 34 * s,
            borderRightWidth: 34 * s,
            borderBottomWidth: 52 * s,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: C.verde,
          }}
        />
        <View
          style={{
            width: 24 * s,
            height: 62 * s,
            backgroundColor: C.verde,
            borderBottomLeftRadius: 8 * s,
            borderBottomRightRadius: 8 * s,
            marginTop: -5 * s,
          }}
        />
      </View>

      {/* Eje central */}
      <View
        style={{
          position: 'absolute',
          width: 20 * s,
          height: 20 * s,
          borderRadius: 10 * s,
          left: centro - 10 * s,
          top: centro - 10 * s,
          backgroundColor: C.navy,
          borderWidth: 3 * s,
          borderColor: C.blanco,
          ...SOMBRA_SUAVE,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  marco: {
    backgroundColor: '#F7FAFD',
    borderWidth: 2,
    borderColor: C.azulBorde,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...SOMBRA_SUAVE,
  },
  anilloInterno: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: C.azulBorde,
    borderStyle: 'dashed',
  },
  tick: {
    position: 'absolute',
    borderRadius: 1,
  },
  muesca: {
    position: 'absolute',
    top: 0,
    left: '50%',
    backgroundColor: C.navy,
  },
  flecha: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    backgroundColor: 'rgba(14,159,110,0.12)',
  },
});
