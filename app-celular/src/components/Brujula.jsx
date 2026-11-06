// Brujula visual en tiempo real.
// - La aguja ROJA señala el NORTE (gira con -rumboPantalla).
// - La aguja AZUL señala el DESTINO si se pasa rumboDestino (gira con el
//   angulo relativo entre tu direccion actual y la del destino).
// - La muesca superior del fondo es fija: es la direccion a la que apunta
//   la pantalla del telefono (tu "frente").
import { View, Text, StyleSheet } from 'react-native';
import { C, SOMBRA_SUAVE } from '../lib/tema';

const TAMANO = 240;

const DIRECCIONES = [
  { etiqueta: 'N', grados: 0, principal: true, color: C.rojo },
  { etiqueta: 'NE', grados: 45, principal: false, color: C.textoSuave },
  { etiqueta: 'E', grados: 90, principal: true, color: C.textoMedio },
  { etiqueta: 'SE', grados: 135, principal: false, color: C.textoSuave },
  { etiqueta: 'S', grados: 180, principal: true, color: C.textoMedio },
  { etiqueta: 'SO', grados: 225, principal: false, color: C.textoSuave },
  { etiqueta: 'O', grados: 270, principal: true, color: C.textoMedio },
  { etiqueta: 'NO', grados: 315, principal: false, color: C.textoSuave },
];

export default function Brujula({ rumboPantalla, rumboDestino, tamaño = TAMANO }) {
  const actual = rumboPantalla != null ? rumboPantalla : 0;
  const centro = tamaño / 2;
  const s = tamaño / TAMANO;

  // Aguja de NORTE: el norte real apunta a (-rumbo actual).
  const agujaNorte = { transform: [{ rotate: `${-actual}deg` }] };

  // Aguja del DESTINO (opcional): gira segun cuanto debes girar.
  let agujaDestino = null;
  const hayDestino = rumboDestino != null && rumboPantalla != null;
  if (hayDestino) {
    let giro = (rumboDestino - rumboPantalla) % 360;
    if (giro > 180) giro -= 360;
    if (giro < -180) giro += 360;
    agujaDestino = { transform: [{ rotate: `${giro}deg` }] };
  }

  return (
    <View
      style={[
        styles.marco,
        { width: tamaño, height: tamaño, borderRadius: tamaño / 2 },
      ]}
    >
      {/* Anillo interior */}
      <View
        style={[
          styles.anillo,
          {
            width: tamaño * 0.9,
            height: tamaño * 0.9,
            borderRadius: tamaño * 0.45,
            left: tamaño * 0.05,
            top: tamaño * 0.05,
          },
        ]}
      />

      {/* Muesca superior fija: hacia donde apunta tu telefono */}
      <View
        style={[
          styles.muescaFrente,
          {
            left: centro - 7 * s,
            borderLeftWidth: 7 * s,
            borderRightWidth: 7 * s,
            borderTopWidth: 12 * s,
          },
        ]}
      />

      {/* Rosco: marcas + letras. Gira JUNTO con la aguja roja, como una
          brujula real. Asi la N siempre queda pegada a la punta roja. */}
      <View
        style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${-actual}deg` }] }]}
        pointerEvents="none"
      >
        {Array.from({ length: 24 }, (_, i) => (
          <View
            key={`t${i}`}
            style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${i * 15}deg` }] }]}
          >
            <View
              style={[
                styles.tick,
                {
                  left: centro - 1 * s,
                  top: 9 * s,
                  width: 2 * s,
                  height: (i % 6 === 0 ? 10 : 5) * s,
                  backgroundColor: i % 6 === 0 ? C.navy : C.azulBorde,
                },
              ]}
            />
          </View>
        ))}

        {DIRECCIONES.map(d => {
          const rad = (d.grados * Math.PI) / 180;
          const r = centro - 28 * s;
          return (
            <Text
              key={d.etiqueta}
              style={[
                styles.letra,
                {
                  color: d.color,
                  fontSize: (d.principal ? 16 : 9) * s,
                  fontWeight: d.principal ? '900' : '800',
                  left: centro + r * Math.sin(rad) - 12 * s,
                  top: centro - r * Math.cos(rad) - 10 * s,
                  width: 24 * s,
                  // Contrarresta el giro del rosco para que la letra se lea derecha.
                  transform: [{ rotate: `${actual}deg` }],
                },
              ]}
            >
              {d.etiqueta}
            </Text>
          );
        })}
      </View>

      {/* Aguja del DESTINO (detras del norte para que no la tapan) */}
      {hayDestino && (
        <View style={[styles.aguja, agujaDestino]}>
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: 7 * s,
              borderRightWidth: 7 * s,
              borderBottomWidth: 26 * s,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: C.azulBrillante,
            }}
          />
          <View
            style={{
              width: 4 * s,
              height: 34 * s,
              marginTop: -2 * s,
              borderRadius: 2 * s,
              backgroundColor: C.azulBorde,
            }}
          />
        </View>
      )}

      {/* Aguja del NORTE */}
      <View style={[styles.aguja, agujaNorte]}>
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: 9 * s,
            borderRightWidth: 9 * s,
            borderBottomWidth: 34 * s,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: C.rojo,
          }}
        />
        <View
          style={{
            width: 5 * s,
            height: 42 * s,
            marginTop: -2 * s,
            borderRadius: 3 * s,
            backgroundColor: '#CBD5E1',
          }}
        />
      </View>

      {/* Eje central */}
      <View
        style={{
          position: 'absolute',
          width: 18 * s,
          height: 18 * s,
          borderRadius: 9 * s,
          left: centro - 9 * s,
          top: centro - 9 * s,
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
    borderColor: C.navy,
    alignSelf: 'center',
    position: 'relative',
    overflow: 'hidden',
    ...SOMBRA_SUAVE,
  },
  anillo: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: C.borde,
  },
  muescaFrente: {
    position: 'absolute',
    top: 0,
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: C.navy,
  },
  tick: {
    position: 'absolute',
    borderRadius: 1,
  },
  letra: {
    position: 'absolute',
    textAlign: 'center',
  },
  aguja: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -9,
    marginTop: -60,
    width: 18,
    height: 120,
    alignItems: 'center',
  },
});
