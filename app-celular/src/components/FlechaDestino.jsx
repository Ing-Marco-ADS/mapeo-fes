// Flecha que indica hacia donde queda el destino RESPECTO A TI.
// Recibe `giro` en grados: 0 = de frente, positivo = a tu derecha,
// negativo = a tu izquierda. No necesita brujula: funciona con el curso
// de caminata del GPS.
import { View, StyleSheet } from 'react-native';

export default function FlechaDestino({ giro, tamaño = 170, activo = true }) {
  const angulo = giro == null ? 0 : giro;

  return (
    <View
      style={[
        styles.marco,
        {
          width: tamaño,
          height: tamaño,
          borderRadius: tamaño / 2,
          opacity: activo ? 1 : 0.45,
        },
      ]}
    >
      {/* Muesca fija arriba: hacia donde vas / apunta el telefono */}
      <View style={styles.muesca} />

      <View style={[styles.flecha, { transform: [{ rotate: `${angulo}deg` }] }]}>
        <View style={styles.cabeza} />
        <View style={styles.cuerpo} />
      </View>

      <View style={styles.eje} />
    </View>
  );
}

const styles = StyleSheet.create({
  marco: {
    backgroundColor: '#e8eef6',
    borderWidth: 3,
    borderColor: '#1F4E79',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  muesca: {
    position: 'absolute',
    top: 0,
    width: 8,
    height: 16,
    backgroundColor: '#1F4E79',
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  flecha: {
    width: 100,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  cabeza: {
    width: 0,
    height: 0,
    borderLeftWidth: 30,
    borderRightWidth: 30,
    borderBottomWidth: 46,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#15803d',
  },
  cuerpo: {
    width: 22,
    height: 58,
    backgroundColor: '#15803d',
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    marginTop: -4,
  },
  eje: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#1F4E79',
    borderWidth: 3,
    borderColor: '#fff',
  },
});
