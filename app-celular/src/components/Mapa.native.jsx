// "Mapa" para iOS/Android SIN Google Maps.
// Motivo: react-native-maps en Android se apoya en el SDK de Google Maps y,
// sin una clave de Google (com.google.android.geo.API_KEY), la app se CERRABA
// al abrir (RuntimeException: API key not found). No queremos depender de una
// cuenta de Google, asi que aqui dibujamos un RADAR con Views normales:
//   - tu ubicacion queda en el centro, con un pulso;
//   - cada punto del mapeo se coloca segun su rumbo y distancia REALES;
//   - tres anillos dan escala (el borde equivale al alcance maximo);
//   - las letras N/E/S/O giran con la direccion en la que caminas.
// La guia principal es por VOZ; este radar es el apoyo visual.
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { distanciaMetros, rumboEntre } from '../lib/geo';
import { C, SOMBRA_SUAVE } from '../lib/tema';

const ALCANCE_M = 250; // radio del radar en metros (el borde = este alcance)
const ANILLOS = [1 / 3, 2 / 3, 1];

function PuntoCardinal({ etiqueta, grados, centro, radio, orientacion, color }) {
  const rad = (grados * Math.PI) / 180;
  return (
    <Text
      style={[
        styles.cardinal,
        { color },
        {
          left: centro.x + radio * Math.sin(rad) - 9,
          top: centro.y - radio * Math.cos(rad) - 8,
          // Se contra-rota para que la letra siempre se lea derecha.
          transform: [{ rotate: `${orientacion}deg` }],
        },
      ]}
    >
      {etiqueta}
    </Text>
  );
}

export default function Mapa({
  puntos,
  ubica,
  alSeleccionarPunto,
  rumboPantalla = null,
  margenInferior = 0,
}) {
  const [caja, setCaja] = useState({ ancho: 0, alto: 0 });

  // Pulso suave del marcador "tu estas aqui".
  const [pulso] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulso, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulso, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulso]);
  const escalaPulso = pulso.interpolate({ inputRange: [0, 1], outputRange: [0.65, 2.2] });
  const opacidadPulso = pulso.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  const onLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    setCaja({ ancho: width, alto: height });
  };

  const visibleAlto = Math.max(120, caja.alto - margenInferior);
  const radio = Math.max(0, Math.min(caja.ancho / 2 - 22, visibleAlto / 2 - 78));
  const centro = {
    x: caja.ancho / 2,
    // Se baja lo justo para que el radar no quede debajo de la tarjeta
    // superior, pero sin invadir el panel inferior.
    y: Math.max(visibleAlto / 2 + 14, 120 + radio),
  };
  // Orientacion del radar: la direccion de referencia (GPS caminando o
  // brujula). Sin ninguna, el radar queda con el norte arriba.
  const orientacion = rumboPantalla ?? ubica?.rumbo ?? 0;

  // Convierte (lat, lng) en una posicion dentro del radar. Arriba = hacia
  // donde miras/caminas (heading-up).
  function posicionDe(lat, lng) {
    const d = distanciaMetros(ubica.lat, ubica.lng, lat, lng);
    const rumbo = rumboEntre(ubica.lat, ubica.lng, lat, lng);
    const ang = ((rumbo - orientacion) * Math.PI) / 180;
    const r = Math.min(d / ALCANCE_M, 1) * radio;
    return {
      x: centro.x + r * Math.sin(ang),
      y: centro.y - r * Math.cos(ang),
      d,
    };
  }

  // Solo dibujamos los puntos que caen dentro del radar (los demas se
  // amontonarian en el borde). El resto se consulta en la pantalla Buscar.
  const visibles = ubica && radio > 0
    ? puntos
        .map(p => ({ p, ...posicionDe(p.lat, p.lng) }))
        .filter(v => v.d <= ALCANCE_M)
        .sort((a, b) => a.d - b.d)
    : [];
  const fueraDelRadar = ubica ? puntos.length - visibles.length : 0;
  const etiquetados = new Set(visibles.slice(0, 3).map(v => v.p.id));

  const mostrarLeyenda = ubica && radio > 0 && (
    margenInferior > 0
      ? caja.alto - margenInferior - 26 > centro.y + radio - 6
      : centro.y + radio + 30 < caja.alto
  );
  const topLeyenda = margenInferior > 0
    ? caja.alto - margenInferior - 26
    : centro.y + radio + 10;

  return (
    <View style={styles.contenedor} onLayout={onLayout}>
      {/* Manchas decorativas de fondo */}
      <View style={[styles.mancha, styles.manchaA]} />
      <View style={[styles.mancha, styles.manchaB]} />

      {radio > 0 && (
        <View
          style={[
            styles.disco,
            {
              width: radio * 2,
              height: radio * 2,
              borderRadius: radio,
              left: centro.x - radio,
              top: centro.y - radio,
            },
          ]}
        >
          {/* Ejes suaves */}
          <View style={styles.ejeH} />
          <View style={styles.ejeV} />

          {/* Anillos de distancia */}
          {ANILLOS.map(f => (
            <View
              key={f}
              style={[
                styles.anillo,
                {
                  width: radio * 2 * f,
                  height: radio * 2 * f,
                  borderRadius: radio * f,
                  left: radio - radio * f,
                  top: radio - radio * f,
                },
              ]}
            />
          ))}

          {/* Puntos cardinales (giran con tu direccion) */}
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ rotate: `${-orientacion}deg` }] },
            ]}
          >
            {[
              { e: 'N', g: 0, color: C.rojo },
              { e: 'E', g: 90, color: C.textoSuave },
              { e: 'S', g: 180, color: C.textoSuave },
              { e: 'O', g: 270, color: C.textoSuave },
            ].map(c => (
              <PuntoCardinal
                key={c.e}
                etiqueta={c.e}
                grados={c.g}
                centro={{ x: radio, y: radio }}
                radio={radio - 12}
                orientacion={orientacion}
                color={c.color}
              />
            ))}
          </View>
        </View>
      )}

      {/* Etiquetas de escala sobre el anillo vertical */}
      {ubica && radio > 0 && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {ANILLOS.map(f => (
            <Text
              key={f}
              style={[
                styles.escalaAnillo,
                {
                  left: centro.x + 6,
                  top: centro.y - radio * f - 8,
                },
              ]}
            >
              {Math.round(ALCANCE_M * f)} m
            </Text>
          ))}
        </View>
      )}

      {/* Puntos del mapeo */}
      {visibles.map(({ p, x, y }) => (
        <Pressable
          key={p.id}
          onPress={() => alSeleccionarPunto?.(p)}
          accessibilityRole="button"
          accessibilityLabel={p.nombre}
          accessibilityHint="Toca para escuchar la información del punto"
          style={[styles.puntoZona, { left: x - 16, top: y - 16 }]}
        >
          <View style={[styles.punto, { backgroundColor: p.color || '#78909C' }]} />
          {etiquetados.has(p.id) && (
            <Text style={styles.etiqueta} numberOfLines={1}>
              {p.nombre}
            </Text>
          )}
        </Pressable>
      ))}

      {/* Mi ubicacion en el centro */}
      {ubica && radio > 0 && (
        <>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pulso,
              {
                left: centro.x - 20,
                top: centro.y - 20,
                opacity: opacidadPulso,
                transform: [{ scale: escalaPulso }],
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[styles.yo, { left: centro.x - 13, top: centro.y - 13 }]}
          >
            <View style={styles.yoNucleo} />
          </View>
          <Text
            pointerEvents="none"
            style={[styles.yoTexto, { left: centro.x - 30, top: centro.y + 16 }]}
          >
            Tú
          </Text>
        </>
      )}

      {/* Mensaje mientras no hay GPS */}
      {!ubica && (
        <View style={styles.centroMensaje}>
          <View style={styles.tarjetaGps}>
            <View style={styles.iconoGps}>
              <View style={styles.iconoGpsAnillo} />
              <View style={styles.iconoGpsPunto} />
            </View>
            <Text style={styles.mensajeTitulo}>Buscando señal del GPS</Text>
            <Text style={styles.mensajeTexto}>
              Sal al aire libre o asómate a una ventana. En cuanto haya señal,
              verás tu posición y los lugares cercanos en este radar.
            </Text>
          </View>
        </View>
      )}

      {/* Leyenda y escala */}
      {mostrarLeyenda && (
        <View pointerEvents="none" style={[styles.leyenda, { top: topLeyenda }]}>
          <View style={styles.leyendaItem}>
            <View style={styles.leyendaYo} />
            <Text style={styles.leyendaTexto}>Tú</Text>
          </View>
          <View style={styles.leyendaItem}>
            <View style={styles.leyendaPunto} />
            <Text style={styles.leyendaTexto}>Lugar</Text>
          </View>
          <Text style={styles.leyendaTexto} numberOfLines={1}>
            · {visibles.length} en el radar
            {fueraDelRadar > 0 ? ` · ${fueraDelRadar} más lejos` : ''}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    flex: 1,
    backgroundColor: '#E8F1F9',
    overflow: 'hidden',
  },
  mancha: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(47,128,237,0.09)',
  },
  manchaA: { width: 320, height: 320, top: -110, right: -100 },
  manchaB: { width: 240, height: 240, bottom: 120, left: -110 },

  disco: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(11,44,77,0.12)',
  },
  ejeH: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(11,44,77,0.12)',
  },
  ejeV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(11,44,77,0.12)',
  },
  anillo: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(29,111,184,0.18)',
  },
  cardinal: {
    position: 'absolute',
    width: 18,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '900',
  },
  escalaAnillo: {
    position: 'absolute',
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(11,44,77,0.42)',
  },

  puntoZona: {
    position: 'absolute',
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  punto: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2.5,
    borderColor: C.blanco,
    ...SOMBRA_SUAVE,
  },
  etiqueta: {
    position: 'absolute',
    top: 28,
    width: 100,
    marginLeft: -34,
    textAlign: 'center',
    fontSize: 9,
    fontWeight: '800',
    color: C.navy,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 5,
    paddingVertical: 2,
    paddingHorizontal: 4,
    overflow: 'hidden',
  },

  pulso: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.azulBrillante,
  },
  yo: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.blanco,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.azulBrillante,
    ...SOMBRA_SUAVE,
  },
  yoNucleo: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: C.azulBrillante,
  },
  yoTexto: {
    position: 'absolute',
    width: 60,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '800',
    color: C.azul,
  },

  centroMensaje: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  tarjetaGps: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 20,
    paddingVertical: 22,
    paddingHorizontal: 20,
    alignItems: 'center',
    maxWidth: 300,
    borderWidth: 1,
    borderColor: C.borde,
    ...SOMBRA_SUAVE,
  },
  iconoGps: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  iconoGpsAnillo: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: C.azulBorde,
  },
  iconoGpsPunto: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: C.azul,
  },
  mensajeTitulo: {
    fontSize: 16,
    fontWeight: '800',
    color: C.navy,
    textAlign: 'center',
    marginBottom: 6,
  },
  mensajeTexto: {
    fontSize: 13,
    lineHeight: 19,
    color: C.textoMedio,
    textAlign: 'center',
  },

  leyenda: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderRadius: 999,
    alignSelf: 'center',
  },
  leyendaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  leyendaYo: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: C.azulBrillante,
    backgroundColor: C.blanco,
  },
  leyendaPunto: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.verde,
    borderWidth: 1.5,
    borderColor: C.blanco,
  },
  leyendaTexto: { fontSize: 10, fontWeight: '700', color: C.textoMedio },
});
