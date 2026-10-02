// Brujula visual en tiempo real.
// - La aguja ROJA señala el NORTE (gira con -rumboPantalla).
// - La aguja AZUL señala el DESTINO si se pasa rumboDestino (gira con el
//   angulo relativo entre tu direccion actual y la del destino).
// - La muesca superior del fondo es fija: es la direccion a la que apunta
//   la pantalla del telefono (tu "frente").
import { View, Text, StyleSheet } from 'react-native';

const TAMANO = 240;

function puntosCardinales() {
  // Posiciones fijas en pantalla: siempre muestran los 4 puntos.
  return [
    { etiqueta: 'N', grados: 0, color: '#ef4444' },
    { etiqueta: 'E', grados: 90, color: '#334155' },
    { etiqueta: 'S', grados: 180, color: '#334155' },
    { etiqueta: 'O', grados: 270, color: '#334155' },
  ];
}

export default function Brujula({ rumboPantalla, rumboDestino, tamaño = TAMANO }) {
  const actual = rumboPantalla != null ? rumboPantalla : 0;

  // Aguja de NORTE: el norte real apunta a (-rumbo actual).
  const agujaNorte = { transform: [{ rotate: `${-actual}deg` }] };

  // Aguja del DESTINO (opcional): gira segun cuanto debes girar.
  let agujaDestino = null;
  let hayDestino = rumboDestino != null && rumboPantalla != null;
  if (hayDestino) {
    let giro = (rumboDestino - rumboPantalla) % 360;
    if (giro > 180) giro -= 360;
    if (giro < -180) giro += 360;
    agujaDestino = { transform: [{ rotate: `${giro}deg` }] };
  }

  const centro = tamaño / 2;

  return (
    <View style={[styles.marco, { width: tamaño, height: tamaño, borderRadius: tamaño / 2 }]}>
      {/* Muesca superior fija: hacia donde apunta tu telefono */}
      <View style={[styles.muescaFrente, { left: centro - 3, top: 0 }]} />

      {puntosCardinales().map((p) => {
        const rad = (p.grados * Math.PI) / 180;
        const r = centro - 24;
        return (
          <Text
            key={p.etiqueta}
            style={[
              styles.letra,
              { color: p.color },
              { left: centro + r * Math.sin(rad) - 8, top: centro - r * Math.cos(rad) - 12 },
            ]}
          >
            {p.etiqueta}
          </Text>
        );
      })}

      {/* Aguja del DESTINO (detras del norte para que no la tapan) */}
      {hayDestino && (
        <View style={[styles.agujaCont, agujaDestino]}>
          <View style={styles.brazoAzul} />
          <View style={styles.puntaAzul} />
        </View>
      )}

      {/* Aguja del NORTE */}
      <View style={[styles.agujaCont, agujaNorte]}>
        <View style={styles.brazoRojo} />
        <View style={styles.puntaRoja} />
      </View>

      {/* Eje central */}
      <View style={[styles.eje, { width: 16, height: 16, borderRadius: 8, left: centro - 8, top: centro - 8 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  marco: {
    backgroundColor: '#f8fafc',
    borderWidth: 3,
    borderColor: '#1F4E79',
    alignSelf: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  muescaFrente: {
    position: 'absolute',
    width: 6,
    height: 14,
    backgroundColor: '#1F4E79',
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  letra: {
    position: 'absolute',
    fontSize: 18,
    fontWeight: '900',
    width: 16,
    textAlign: 'center',
  },
  agujaCont: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -4,
    marginTop: -50,
    width: 8,
    height: 100,
    alignItems: 'center',
  },
  brazoRojo: {
    position: 'absolute',
    top: 42,
    bottom: 0,
    width: 8,
    backgroundColor: '#cbd5e1',
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  puntaRoja: {
    position: 'absolute',
    top: 0,
    width: 14,
    height: 34,
    backgroundColor: '#ef4444',
    left: -3,
    // punta triangular hacia el norte (~17deg)
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  brazoAzul: {
    position: 'absolute',
    top: 8,
    bottom: 0,
    width: 6,
    backgroundColor: '#93c5fd',
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  puntaAzul: {
    position: 'absolute',
    top: 0,
    width: 12,
    height: 30,
    backgroundColor: '#2563eb',
    left: -3,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  eje: {
    position: 'absolute',
    backgroundColor: '#1F4E79',
  },
});