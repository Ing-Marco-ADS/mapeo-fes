// Iconos dibujados con Views normales (sin librerias ni fuentes externas).
// Se usan en botones y tarjetas para que la app se vea moderna y consistente.
import { View, Text, StyleSheet } from 'react-native';
import { C } from '../lib/tema';

export default function Icono({ nombre, tamaño = 22, color = C.blanco, grosor = 2.4 }) {
  const caja = { width: tamaño, height: tamaño };

  if (nombre === 'flecha') {
    // Flecha hacia arriba: triangulo + tallo.
    const anchoCabeza = tamaño * 0.62;
    const altoCabeza = tamaño * 0.46;
    return (
      <View style={[styles.centro, caja]}>
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: anchoCabeza / 2,
            borderRightWidth: anchoCabeza / 2,
            borderBottomWidth: altoCabeza,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: color,
          }}
        />
        <View
          style={{
            width: Math.max(2, tamaño * 0.16),
            height: tamaño * 0.46,
            backgroundColor: color,
            borderBottomLeftRadius: tamaño * 0.06,
            borderBottomRightRadius: tamaño * 0.06,
            marginTop: -1,
          }}
        />
      </View>
    );
  }

  if (nombre === 'lupa') {
    return (
      <View style={[styles.centro, caja]}>
        <View
          style={{
            width: tamaño * 0.62,
            height: tamaño * 0.62,
            borderRadius: tamaño * 0.31,
            borderWidth: grosor,
            borderColor: color,
            marginTop: -tamaño * 0.08,
            marginLeft: -tamaño * 0.08,
          }}
        />
        <View
          style={{
            position: 'absolute',
            width: grosor,
            height: tamaño * 0.36,
            backgroundColor: color,
            borderRadius: grosor,
            right: tamaño * 0.06,
            bottom: tamaño * 0.04,
            transform: [{ rotate: '-45deg' }],
          }}
        />
      </View>
    );
  }

  if (nombre === 'sonido') {
    return (
      <View style={[styles.fila, caja]}>
        {[0.45, 0.8, 1, 0.65].map((f, i) => (
          <View
            key={i}
            style={{
              width: Math.max(2, tamaño * 0.13),
              height: tamaño * f,
              borderRadius: tamaño * 0.07,
              backgroundColor: color,
              marginHorizontal: tamaño * 0.05,
            }}
          />
        ))}
      </View>
    );
  }

  if (nombre === 'brujula') {
    return (
      <View style={[styles.centro, caja]}>
        <View
          style={{
            width: tamaño,
            height: tamaño,
            borderRadius: tamaño / 2,
            borderWidth: grosor,
            borderColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            width: tamaño * 0.13,
            height: tamaño * 0.62,
            borderRadius: tamaño * 0.07,
            backgroundColor: color,
            transform: [{ rotate: '35deg' }],
          }}
        />
        <View
          style={{
            position: 'absolute',
            width: tamaño * 0.22,
            height: tamaño * 0.22,
            borderRadius: tamaño * 0.11,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }

  if (nombre === 'ubicacion') {
    return (
      <View style={[styles.centro, caja]}>
        <View
          style={{
            width: tamaño * 0.74,
            height: tamaño * 0.74,
            borderRadius: tamaño * 0.37,
            borderWidth: grosor,
            borderColor: color,
            marginTop: -tamaño * 0.1,
          }}
        />
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            width: 0,
            height: 0,
            borderLeftWidth: tamaño * 0.16,
            borderRightWidth: tamaño * 0.16,
            borderTopWidth: tamaño * 0.3,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderTopColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: tamaño * 0.2,
            width: tamaño * 0.22,
            height: tamaño * 0.22,
            borderRadius: tamaño * 0.11,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }

  if (nombre === 'alerta') {
    return (
      <View style={[styles.centro, caja]}>
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: tamaño * 0.5,
            borderRightWidth: tamaño * 0.5,
            borderBottomWidth: tamaño * 0.84,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: color,
          }}
        />
        <Text
          style={{
            position: 'absolute',
            top: tamaño * 0.4,
            color: C.blanco,
            fontSize: tamaño * 0.42,
            fontWeight: '900',
            lineHeight: tamaño * 0.44,
          }}
        >
          !
        </Text>
      </View>
    );
  }

  if (nombre === 'chevron') {
    return (
      <View style={[styles.centro, caja]}>
        <View
          style={{
            width: tamaño * 0.34,
            height: tamaño * 0.34,
            borderTopWidth: grosor,
            borderRightWidth: grosor,
            borderColor: color,
            transform: [{ rotate: '45deg' }],
            marginLeft: -tamaño * 0.1,
          }}
        />
      </View>
    );
  }

  if (nombre === 'ubicacionFija') {
    return (
      <View style={[styles.centro, caja]}>
        <View
          style={{
            width: tamaño * 0.5,
            height: tamaño * 0.5,
            borderRadius: tamaño * 0.25,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            width: tamaño,
            height: tamaño,
            borderRadius: tamaño / 2,
            borderWidth: grosor,
            borderColor: color,
            opacity: 0.35,
          }}
        />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  centro: { alignItems: 'center', justifyContent: 'center' },
  fila: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },
});
