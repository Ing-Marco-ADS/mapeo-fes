// Pantalla principal: mapa con los puntos mapeados + tu ubicacion en vivo.
// Pensada para personas ciegas: botones grandes con etiquetas de voz.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useUbicacionGlobal } from '../hooks/useUbicacion';
import { usePrecauciones } from '../hooks/usePrecauciones';
import { hablar, callar } from '../lib/voz';
import { esPrecaucion, textoPrecaucion } from '../lib/categorias';
import { distanciaMetros, textoDistancia, rumboEntre, textoRelativo } from '../lib/geo';
import datosMapa from '../datos_mapeo.json';
import Mapa from '../components/Mapa';

const RADIO_CERCA = 40; // metros: cuando un lugar esta mas cerca, se anuncia

export default function PantallaMapa() {
  const router = useRouter();
  const { ubica, permiso } = useUbicacionGlobal();
  const [puntos] = useState(datosMapa.puntos);

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
      const relativo = ubica.rumbo != null ? textoRelativo(ubica.rumbo, rumboObjetivo) : '';
      hablar(
        `Tienes cerca ${primero.nombre}, ${textoDistancia(d)}${relativo}.`
      );
      cercanos.forEach(c => anunciadosIds.current.add(c.id));
    }
  }, [ubica, lugares]);

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
        const relativo = ubica.rumbo != null ? textoRelativo(ubica.rumbo, rumboObjetivo) : '';
        return `${i + 1}. ${p.nombre}, ${textoDistancia(d)}${relativo}.`;
      }).join(' ')
    );
  }, [ubica, ordenados]);

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

  return (
    <View style={styles.contenedor}>
      <View style={styles.contenedorMapa}>
        <Mapa puntos={puntos} ubica={ubica} alSeleccionarPunto={alSeleccionarPunto} />
      </View>

      {/* Panel de accesibilidad */}
      <View style={styles.panel}>
        <Text style={styles.tituloAccesible} accessibilityRole="header">
          Mapeo FES · Accesible
        </Text>
        <Text style={styles.subtitulo} accessible={true}>
          {ubica
            ? `Estás ${ordenados[0] ? textoDistancia(distanciaMetros(ubica.lat, ubica.lng, ordenados[0].lat, ordenados[0].lng)) : 'con lugares mapados'}.`
            : permiso === 'denied'
              ? 'Sin permiso de ubicación. Actívalo en ajustes.'
              : 'Buscando tu ubicación...'}
        </Text>
        <View style={styles.filaBotones}>
          <Pressable
            style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
            onPress={anunciarTodo}
            accessibilityRole="button"
            accessibilityLabel="Anunciar los puntos cercanos"
            accessibilityHint="Dice por voz los cinco lugares más cercanos a ti"
          >
            <Text style={styles.botonTexto}>Anunciar cercanos</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
            onPress={irABuscar}
            accessibilityRole="button"
            accessibilityLabel="Buscar punto de interés"
            accessibilityHint="Abre la lista de todos los lugares del mapeo"
          >
            <Text style={styles.botonTexto}>Buscar</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.boton, styles.botonPrincipal, pressed && styles.botonPresionado]}
            onPress={irANavegar}
            accessibilityRole="button"
            accessibilityLabel="Navegación por voz"
            accessibilityHint="Abre el asistente que te guía con la voz hacia un lugar"
          >
            <Text style={styles.botonTexto}>Navegar</Text>
          </Pressable>
        </View>
        <Pressable
          style={({ pressed }) => [styles.botonBrujula, pressed && styles.botonPresionado]}
          onPress={irABrujula}
          accessibilityRole="button"
          accessibilityLabel="Brújula de prueba"
          accessibilityHint="Abre la brújula en tiempo real para validar el sensor"
        >
          <Text style={styles.botonBrujulaTexto}>Brújula</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1 },
  contenedorMapa: { flex: 1 },
  panel: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  tituloAccesible: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1F4E79',
    marginBottom: 2,
  },
  subtitulo: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 10,
    lineHeight: 20,
  },
  filaBotones: { flexDirection: 'row', gap: 8 },
  boton: {
    flex: 1,
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  botonBrujula: {
    marginTop: 10,
    backgroundColor: '#f59e0b',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  botonBrujulaTexto: { color: '#fff', fontWeight: '700', fontSize: 14 },
  botonPrincipal: {
    backgroundColor: '#15803d',
  },
  botonPresionado: { opacity: 0.75 },
  botonTexto: { color: '#fff', fontWeight: '700', fontSize: 15 },
});