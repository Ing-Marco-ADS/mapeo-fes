// Pantalla principal: radar con los puntos mapeados + tu ubicacion en vivo.
// Pensada para personas ciegas: botones grandes, etiquetas de voz y toda la
// informacion importante escrita en palabras (no solo con colores).
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useUbicacionGlobal } from '../hooks/useUbicacion';
import { usePrecauciones } from '../hooks/usePrecauciones';
import { hablar, callar } from '../lib/voz';
import { esPrecaucion, textoPrecaucion } from '../lib/categorias';
import { distanciaMetros, textoDistancia, rumboEntre, textoDireccion } from '../lib/geo';
import datosMapa from '../datos_mapeo.json';
import Mapa from '../components/Mapa';
import Icono from '../components/Icono';
import { C, SOMBRA, SOMBRA_SUAVE, R } from '../lib/tema';

const RADIO_CERCA = 40; // metros: cuando un lugar esta mas cerca, se anuncia

export default function PantallaMapa() {
  const router = useRouter();
  const { ubica, permiso, rumboReferencia } = useUbicacionGlobal();
  const [puntos] = useState(datosMapa.puntos);

  // Reloj ligero: mantiene al dia el texto "actualizado hace X s".
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const lugares = useMemo(() => puntos.filter(p => !esPrecaucion(p)), [puntos]);
  const obstaculos = useMemo(() => puntos.filter(esPrecaucion), [puntos]);

  // Vigilancia permanente: avisa por voz cuando hay un obstaculo cerca
  usePrecauciones({ ubica, puntos: obstaculos, activo: true });

  // Puntos de interes (lugares) ordenados por distancia
  const ordenados = useMemo(() => {
    if (!ubica) return [];
    return [...lugares].sort(
      (a, b) =>
        distanciaMetros(ubica.lat, ubica.lng, a.lat, a.lng) -
        distanciaMetros(ubica.lat, ubica.lng, b.lat, b.lng)
    );
  }, [lugares, ubica]);

  // IDs ya anunciados por voz (ref: solo evita repetir, no afecta el render)
  const anunciadosIds = useRef(new Set());

  // Cuando la posicion cambia, si hay un LUGAR a <40m y no lo hemos anunciado, lo decimos
  useEffect(() => {
    if (!ubica) return;
    const cercanos = lugares.filter(p => {
      const d = distanciaMetros(ubica.lat, ubica.lng, p.lat, p.lng);
      return d <= RADIO_CERCA && !anunciadosIds.current.has(p.id);
    });
    if (cercanos.length > 0) {
      const primero = cercanos[0];
      const d = distanciaMetros(ubica.lat, ubica.lng, primero.lat, primero.lng);
      const rumboObjetivo = rumboEntre(ubica.lat, ubica.lng, primero.lat, primero.lng);
      const relativo = textoDireccion(rumboReferencia, rumboObjetivo);
      hablar(
        `Tienes cerca ${primero.nombre}, ${textoDistancia(d)}${relativo}.`
      );
      cercanos.forEach(c => anunciadosIds.current.add(c.id));
    }
  }, [ubica, lugares, rumboReferencia]);

  // Boton para repetir la informacion de los cercanos a demanda
  const anunciarTodo = useCallback(() => {
    callar();
    if (!ubica) {
      hablar('Esperando la señal del GPS.');
      return;
    }
    if (ordenados.length === 0) {
      hablar('No hay lugares cargados todavía.');
      return;
    }
    const top = ordenados.slice(0, 5);
    hablar(
      top.map((p, i) => {
        const d = distanciaMetros(ubica.lat, ubica.lng, p.lat, p.lng);
        const rumboObjetivo = rumboEntre(ubica.lat, ubica.lng, p.lat, p.lng);
        const relativo = textoDireccion(rumboReferencia, rumboObjetivo);
        return `${i + 1}. ${p.nombre}, ${textoDistancia(d)}${relativo}.`;
      }).join(' ')
    );
  }, [ubica, ordenados, rumboReferencia]);

  const irANavegar = useCallback(() => {
    callar();
    router.push('/navegar');
  }, [router]);

  const irABuscar = useCallback(() => {
    callar();
    router.push('/buscar');
  }, [router]);

  const irABrujula = useCallback(() => {
    callar();
    router.push('/brujula');
  }, [router]);

  const alSeleccionarPunto = useCallback((p) => {
    if (esPrecaucion(p)) {
      const d = ubica ? distanciaMetros(ubica.lat, ubica.lng, p.lat, p.lng) : null;
      hablar(textoPrecaucion(p, d != null ? textoDistancia(d) : 'a la distancia indicada'));
      return;
    }
    const d = ubica ? distanciaMetros(ubica.lat, ubica.lng, p.lat, p.lng) : 0;
    hablar(`${p.nombre}, ${textoDistancia(d)}.`);
  }, [ubica]);

  // ---- Textos de estado (siempre en palabras, nunca solo color) ----
  const cercano = ordenados[0] || null;
  const distanciaCercano = cercano && ubica
    ? distanciaMetros(ubica.lat, ubica.lng, cercano.lat, cercano.lng)
    : null;
  const direccionCercano = cercano && ubica
    ? textoDireccion(
        rumboReferencia,
        rumboEntre(ubica.lat, ubica.lng, cercano.lat, cercano.lng)
      )
    : '';

  const segDesdeGps = ubica?.actualizadoEn
    ? Math.max(0, Math.round((ahora - ubica.actualizadoEn) / 1000))
    : null;

  let estadoGps;
  if (permiso === 'denied') {
    estadoGps = { texto: 'Sin permiso', color: C.rojo, fondo: C.rojoClaro };
  } else if (!ubica) {
    estadoGps = { texto: 'Buscando GPS', color: C.ambar, fondo: C.ambarClaro };
  } else if (segDesdeGps != null && segDesdeGps > 30) {
    estadoGps = { texto: 'GPS débil', color: C.ambar, fondo: C.ambarClaro };
  } else {
    estadoGps = { texto: 'GPS activo', color: C.verdeOscuro, fondo: C.verdeClaro };
  }

  return (
    <View style={styles.contenedor}>
      <StatusBar style="dark" />

      <View style={styles.contenedorMapa}>
        <Mapa
          puntos={puntos}
          ubica={ubica}
          rumboPantalla={rumboReferencia}
          alSeleccionarPunto={alSeleccionarPunto}
          margenInferior={300}
        />
      </View>

      {/* Marca y estado, flotando arriba */}
      <SafeAreaView style={styles.zonaArriba} edges={['top']} pointerEvents="box-none">
        <View style={styles.marca}>
          <View style={styles.logo}>
            <Text style={styles.logoTexto}>M</Text>
          </View>
          <View style={styles.marcaTextos}>
            <Text style={styles.marcaTitulo}>Mapeo FES</Text>
            <Text style={styles.marcaSub}>Guía por voz en el campus</Text>
          </View>
          <View style={[styles.chip, { backgroundColor: estadoGps.fondo }]}>
            <View style={[styles.chipPunto, { backgroundColor: estadoGps.color }]} />
            <Text style={[styles.chipTexto, { color: estadoGps.color }]}>
              {estadoGps.texto}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      {/* Panel de accesibilidad, abajo */}
      <SafeAreaView style={styles.zonaAbajo} edges={['bottom']} pointerEvents="box-none">
        <View style={styles.panel}>
          <View style={styles.cercanoFila}>
            <View style={[styles.cercanoIcono, { backgroundColor: (cercano?.color || C.azul) + '22' }]}>
              <View style={[styles.cercanoPunto, { backgroundColor: cercano?.color || C.azul }]} />
            </View>
            <View style={styles.cercanoTextos}>
              <Text style={styles.cercanoEtiqueta}>
                {cercano ? 'LUGAR MÁS CERCANO' : 'SIN UBICACIÓN'}
              </Text>
              <Text style={styles.cercanoNombre} numberOfLines={1}>
                {cercano ? cercano.nombre : 'Buscando tu posición…'}
              </Text>
              <Text style={styles.cercanoDetalle} numberOfLines={1}>
                {cercano && distanciaCercano != null
                  ? `Queda${direccionCercano}`
                  : 'Activa el GPS para empezar'}
              </Text>
            </View>
            {cercano && distanciaCercano != null && (
              <View style={styles.distanciaCaja}>
                <Text style={styles.distanciaNumero}>{Math.round(distanciaCercano)}</Text>
                <Text style={styles.distanciaUnidad}>metros</Text>
              </View>
            )}
          </View>

          <View style={styles.filaPrincipal}>
            <Pressable
              style={({ pressed }) => [styles.botonPrincipal, pressed && styles.presionado]}
              onPress={irANavegar}
              accessibilityRole="button"
              accessibilityLabel="Navegación por voz"
              accessibilityHint="Abre el asistente que te guía con la voz hacia un lugar"
            >
              <Icono nombre="flecha" tamaño={20} color={C.blanco} />
              <Text style={styles.botonPrincipalTexto}>Navegar</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.botonSecundario, pressed && styles.presionado]}
              onPress={irABuscar}
              accessibilityRole="button"
              accessibilityLabel="Buscar punto de interés"
              accessibilityHint="Abre la lista de todos los lugares del mapeo"
            >
              <Icono nombre="lupa" tamaño={19} color={C.azul} />
              <Text style={styles.botonSecundarioTexto}>Buscar</Text>
            </Pressable>
          </View>

          <View style={styles.filaSecundaria}>
            <Pressable
              style={({ pressed }) => [styles.botonAnunciar, pressed && styles.presionado]}
              onPress={anunciarTodo}
              accessibilityRole="button"
              accessibilityLabel="Anunciar los puntos cercanos"
              accessibilityHint="Dice por voz los cinco lugares más cercanos a ti"
            >
              <Icono nombre="sonido" tamaño={18} color={C.navy} />
              <Text style={styles.botonAnunciarTexto}>Anunciar cercanos</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.botonBrujula, pressed && styles.presionado]}
              onPress={irABrujula}
              accessibilityRole="button"
              accessibilityLabel="Brújula y sensores"
              accessibilityHint="Abre la brújula en tiempo real para validar el sensor"
            >
              <Icono nombre="brujula" tamaño={18} color={C.textoMedio} />
              <Text style={styles.botonBrujulaTexto}>Brújula</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: C.fondo },
  contenedorMapa: { flex: 1 },

  zonaArriba: { position: 'absolute', top: 0, left: 0, right: 0 },
  marca: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 12,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: R.l,
    borderWidth: 1,
    borderColor: C.borde,
    ...SOMBRA_SUAVE,
  },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoTexto: { color: C.blanco, fontSize: 19, fontWeight: '900' },
  marcaTextos: { flex: 1 },
  marcaTitulo: { fontSize: 16, fontWeight: '800', color: C.navy, letterSpacing: 0.2 },
  marcaSub: { fontSize: 12, color: C.textoSuave, marginTop: 1 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderRadius: R.redondo,
  },
  chipPunto: { width: 7, height: 7, borderRadius: 4 },
  chipTexto: { fontSize: 11, fontWeight: '800' },

  zonaAbajo: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  panel: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 14,
    backgroundColor: C.tarjeta,
    borderRadius: R.xl,
    borderWidth: 1,
    borderColor: C.borde,
    ...SOMBRA,
  },
  cercanoFila: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cercanoIcono: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cercanoPunto: { width: 16, height: 16, borderRadius: 8 },
  cercanoTextos: { flex: 1 },
  cercanoEtiqueta: {
    fontSize: 10,
    fontWeight: '800',
    color: C.textoSuave,
    letterSpacing: 0.7,
  },
  cercanoNombre: { fontSize: 17, fontWeight: '800', color: C.texto, marginTop: 2 },
  cercanoDetalle: { fontSize: 13, color: C.textoMedio, marginTop: 1 },
  distanciaCaja: { alignItems: 'flex-end', minWidth: 56 },
  distanciaNumero: { fontSize: 26, fontWeight: '900', color: C.navy, lineHeight: 28 },
  distanciaUnidad: { fontSize: 11, fontWeight: '700', color: C.textoSuave },

  filaPrincipal: { flexDirection: 'row', gap: 10, marginTop: 14 },
  botonPrincipal: {
    flex: 1.3,
    height: 56,
    borderRadius: R.m,
    backgroundColor: C.verde,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  botonPrincipalTexto: { color: C.blanco, fontSize: 17, fontWeight: '800' },
  botonSecundario: {
    flex: 1,
    height: 56,
    borderRadius: R.m,
    backgroundColor: C.azulClaro,
    borderWidth: 1,
    borderColor: C.azulBorde,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  botonSecundarioTexto: { color: C.azul, fontSize: 16, fontWeight: '800' },

  filaSecundaria: { flexDirection: 'row', gap: 10, marginTop: 10 },
  botonAnunciar: {
    flex: 1,
    height: 46,
    borderRadius: R.m,
    backgroundColor: C.fondo,
    borderWidth: 1,
    borderColor: C.borde,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  botonAnunciarTexto: { color: C.navy, fontSize: 14, fontWeight: '700' },
  botonBrujula: {
    height: 46,
    paddingHorizontal: 14,
    borderRadius: R.m,
    backgroundColor: C.fondo,
    borderWidth: 1,
    borderColor: C.borde,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  botonBrujulaTexto: { color: C.textoMedio, fontSize: 14, fontWeight: '700' },

  presionado: { opacity: 0.72, transform: [{ scale: 0.985 }] },
});
