// Pantalla "Navegar": asistente de navegacion por voz en TIEMPO REAL.
// 1. Solo se pueden elegir como destino los LUGARES (escaleras/rampas/
//    escalones son obstaculos de precaucion: se avisan, no son destinos).
// 2. Mientras caminas, la voz te dice la distancia ACTUALIZADA y hacia
//    donde girar usando la direccion real de tu caminata (no la brujula):
//    "A 42 metros. Gira a la derecha." Cada vez que avanzas, cambia.
// 3. Icono de flecha que apunta hacia donde debes ir.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import { useUbicacionGlobal } from '../hooks/useUbicacion';
import { usePrecauciones } from '../hooks/usePrecauciones';
import { hablar, callar } from '../lib/voz';
import { esPrecaucion } from '../lib/categorias';
import Brujula from '../components/Brujula';
import {
  distanciaMetros, rumboEntre, giroRelativo, textoGiro, textoRelativo,
} from '../lib/geo';
import datosMapa from '../datos_mapeo.json';

const AVANZA_LEJOS = 25;   // metros de avance para volver a hablar estando lejos
const AVANZA_CERCA = 8;    // metros de avance para volver a hablar estando cerca
const MAX_SILENCIO = 20000;  // maximo ms sin hablar (por si el GPS no avanza)
const META_M = 10;           // metros: se considera que llegaste

export default function PantallaNavegar() {
  const { ubica } = useUbicacionGlobal();
  const [puntos] = useState(datosMapa.puntos);
  const [destino, setDestino] = useState(null);
  const [segundo, setSegundo] = useState(() => Date.now());

  // Reloj del contador "actualizado hace X s" (re-renderiza cada segundo)
  useEffect(() => {
    const t = setInterval(() => setSegundo(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ultimaDistanciaHablada = useRef(0); // distancia cuando se hablo la ultima vez
  const ultimoTiempoHabla = useRef(0);      // timestamp del ultimo anuncio
  const metaAnunciada = useRef(false);

  // Los destinos validos son solo LUGARES (sin obstaculos de precaucion)
  const lugares = useMemo(() => puntos.filter(p => !esPrecaucion(p)), [puntos]);
  const obstaculos = useMemo(() => puntos.filter(esPrecaucion), [puntos]);

  // Vigilancia de obstaculos durante la navegacion
  usePrecauciones({ ubica, puntos: obstaculos, activo: Boolean(destino) });

  // Destino mas cercano para sugerir (lugares validos)
  const puntoMasCercano = useMemo(() => {
    if (!ubica?.lat || lugares.length === 0) return null;
    let mejor = null;
    let mejorDist = Infinity;
    for (const p of lugares) {
      const d = distanciaMetros(ubica.lat, ubica.lng, p.lat, p.lng);
      if (d < mejorDist) { mejorDist = d; mejor = p; }
    }
    return { punto: mejor, distancia: mejorDist };
  }, [lugares, ubica]);

  // Lugares ordenados por distancia (si hay GPS)
  const ordenados = useMemo(() => {
    if (!ubica?.lat) return lugares;
    return [...lugares].sort(
      (a, b) =>
        distanciaMetros(ubica.lat, ubica.lng, a.lat, a.lng) -
        distanciaMetros(ubica.lat, ubica.lng, b.lat, b.lng)
    );
  }, [lugares, ubica]);

  const elegirDestino = useCallback(p => {
    setDestino(p);
    metaAnunciada.current = false;
    ultimaDistanciaHablada.current = 0;
    ultimoTiempoHabla.current = 0;
    if (!ubica?.lat) {
      hablar(`Navegando hacia ${p.nombre}. Espera a que llegue el GPS para guiarte.`);
      return;
    }
    const d = distanciaMetros(ubica.lat, ubica.lng, p.lat, p.lng);
    const rumboObjetivo = rumboEntre(ubica.lat, ubica.lng, p.lat, p.lng);
    const rumboActual = ubica.rumboPantalla ?? ubica.rumbo;
    const giro = rumboActual != null ? giroRelativo(rumboActual, rumboObjetivo) : null;
    const guia = giro != null
      ? textoGiro(giro)
      : ' Camina y te iré guiando.';
    hablar(`Navegando hacia ${p.nombre}, a ${Math.round(d)} metros.` + guia);
    ultimaDistanciaHablada.current = d;
    ultimoTiempoHabla.current = Date.now();
  }, [ubica]);

  const cancelar = useCallback(() => {
    callar();
    setDestino(null);
  }, []);

  // Bucle de guia en tiempo real mientras se navega
  useEffect(() => {
    if (!destino || !ubica?.lat) return;
    const d = distanciaMetros(ubica.lat, ubica.lng, destino.lat, destino.lng);
    const ahora = Date.now();

    // Llegada
    if (d <= META_M) {
      if (!metaAnunciada.current) {
        metaAnunciada.current = true;
        hablar(`Llegaste a ${destino.nombre}.`);
        setDestino(null);
      }
      return;
    }

    // Cuando hablar: cada AVANZA metros recorridos (y mas seguido estando cerca),
    // o si llevamos MAX_SILENCIO sin hablar (por si GPS lento).
    const umbral = d < 100 ? AVANZA_CERCA : AVANZA_LEJOS;
    const avanzo = ultimaDistanciaHablada.current - d; // positivo = te acercas
    const sinHablar = ahora - ultimoTiempoHabla.current > MAX_SILENCIO;
    if (avanzo < umbral && !sinHablar) return;

    ultimaDistanciaHablada.current = d;
    ultimoTiempoHabla.current = ahora;

    const rumboObjetivo = rumboEntre(ubica.lat, ubica.lng, destino.lat, destino.lng);
    const rumboActual = ubica.rumboPantalla ?? ubica.rumbo;
    const giro = rumboActual != null ? giroRelativo(rumboActual, rumboObjetivo) : null;

    if (giro != null) {
      hablar(`A ${Math.round(d)} metros.` + textoGiro(giro));
    } else {
      hablar(`A ${Math.round(d)} metros. Camina y te iré guiando`);
    }
  }, [ubica, destino]);

  // ---------- vista: eligiendo destino ----------
  if (!destino) {
    return (
      <View style={styles.contenedor}>
        <View style={styles.aviso}>
          <Text style={styles.avisoTexto} accessible={true}>
            {puntoMasCercano
              ? `Sugerencia: ${puntoMasCercano.punto.nombre}, a ${Math.round(puntoMasCercano.distancia)} metros. Elige un destino.`
              : 'Elige un destino de la lista para comenzar.'}
          </Text>
          <Text style={styles.avisoPrecaucion} accessible={true}>
            Escaleras, rampas y escalones no son destinos: se avisan por voz al acercarte.
          </Text>
        </View>
        <FlatList
          data={ordenados}
          keyExtractor={p => String(p.id)}
          contentContainerStyle={styles.lista}
          renderItem={({ item }) => {
            const conGps = Boolean(ubica?.lat);
            const d = conGps ? distanciaMetros(ubica.lat, ubica.lng, item.lat, item.lng) : null;
            return (
              <Pressable
                style={({ pressed }) => [styles.item, pressed && styles.itemPresionado]}
                onPress={() => elegirDestino(item)}
                accessibilityRole="button"
                accessibilityLabel={`Ir a ${item.nombre}${d != null ? `, a ${Math.round(d)} metros` : ''}`}
                accessibilityHint="Inicia la navegación por voz hacia este lugar"
              >
                <View style={[styles.balonColor, { backgroundColor: item.color || '#78909c' }]} />
                <View style={styles.textos}>
                  <Text style={styles.nombre}>{item.nombre}</Text>
                  <Text style={styles.tipo}>
                    {item.tipoNombre}{d != null ? ` · ${Math.round(d)} m` : ''}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      </View>
    );
  }

  // ---------- vista: navegando (tiempo real) ----------
  const conGps = Boolean(ubica?.lat);
  const d = conGps ? distanciaMetros(ubica.lat, ubica.lng, destino.lat, destino.lng) : null;
  const rumboObjetivo = conGps ? rumboEntre(ubica.lat, ubica.lng, destino.lat, destino.lng) : null;
  const rumboActual = (ubica?.rumboPantalla ?? ubica?.rumbo) ?? null;
  const giro = conGps && rumboActual != null ? giroRelativo(rumboActual, rumboObjetivo) : null;
  const relativo = conGps && rumboObjetivo != null ? textoRelativo(rumboActual, rumboObjetivo) : '';

  // Segundos desde la ultima lectura del GPS (en vivo)
  const segActualizados = ubica?.actualizadoEn
    ? Math.max(0, Math.round((segundo - ubica.actualizadoEn) / 1000))
    : null;

  const anguloFlecha = giro != null ? giro : 0;

  return (
    <View style={styles.contenedor}>
      <View style={styles.navPanel}>
        <Text style={styles.navDestino} accessible={true}>
          Hacia: {destino.nombre}
        </Text>

        <View style={styles.brujula}>
          <Brujula
            rumboPantalla={conGps ? (ubica.rumboPantalla ?? ubica.rumbo) : null}
            rumboDestino={rumboObjetivo}
          />
          <Text style={styles.flechaLeyenda} accessible={true}>
            {conGps
              ? (giro != null
                  ? (Math.abs(giro) < 20 ? 'Vas bien, sigue derecho' : anguloFlecha > 0 ? 'Gira a la derecha' : 'Gira a la izquierda')
                  : 'Camina y se ajusta la guía')
              : 'Esperando GPS...'}
          </Text>
        </View>

        <Text style={styles.navDistancia} accessible={true}>
          {d != null ? `${Math.round(d)} metros` : 'Esperando GPS...'}
        </Text>
        {relativo !== '' && (
          <Text style={styles.navRumbo} accessible={true}>
            El punto está{relativo}
          </Text>
        )}
        <View style={styles.gpsVivo}>
          <Text style={styles.gpsVivoTexto} accessible={true}>
            {conGps
              ? `GPS activo · precisión ±${Math.round(ubica.precision ?? 0)} m`
              : 'Sin señal GPS aún'}
          </Text>
          <Text style={styles.gpsVivoTexto} accessible={true}>
            {segActualizados != null ? `actualizado hace ${segActualizados} s` : ''}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.botonCancelar, pressed && styles.botonPresionado]}
          onPress={cancelar}
          accessibilityRole="button"
          accessibilityLabel="Cancelar navegación"
          accessibilityHint="Detiene la guía por voz"
        >
          <Text style={styles.botonCancelarTexto}>Cancelar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: '#f0f2f5' },
  aviso: { padding: 12, backgroundColor: '#15803d' },
  avisoTexto: { color: '#fff', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  avisoPrecaucion: {
    color: '#d1fae5',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 6,
  },
  lista: { padding: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 12,
    marginVertical: 4,
    gap: 12,
  },
  itemPresionado: { backgroundColor: '#e5edf5' },
  balonColor: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#fff',
  },
  textos: { flex: 1 },
  nombre: { fontSize: 16, fontWeight: '700', color: '#111827' },
  tipo: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  navPanel: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1F4E79',
    gap: 12,
  },
  navDestino: { color: '#fff', fontSize: 22, fontWeight: 'bold', textAlign: 'center' },
  brujula: { alignItems: 'center', marginVertical: 8 },
  flechaLeyenda: { color: '#bbf7d0', fontSize: 14, textAlign: 'center', marginTop: 12 },
  navDistancia: { color: '#dbeafe', fontSize: 26, fontWeight: '700', textAlign: 'center' },
  navRumbo: { color: '#93c5fd', fontSize: 15, textAlign: 'center' },
  gpsVivo: { marginTop: 10, alignItems: 'center', gap: 2 },
  gpsVivoTexto: { color: '#93c5fd', fontSize: 13, textAlign: 'center' },
  botonCancelar: {
    marginTop: 20,
    backgroundColor: '#dc2626',
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 12,
    alignItems: 'center',
  },
  botonCancelarTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
  botonPresionado: { opacity: 0.75 },
});