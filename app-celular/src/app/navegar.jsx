// Pantalla "Navegar": asistente de navegacion por voz en TIEMPO REAL.
// 1. Solo se pueden elegir como destino los LUGARES (escaleras/rampas/
//    escalones son obstaculos de precaucion: se avisan, no son destinos).
// 2. Al empezar se pide una RUTA PEATONAL a la API gratuita OSRM (sin clave).
//    Si hay ruta, se guia por calles paso a paso ("En 25 metros gira a la
//    derecha") y la flecha apunta al siguiente giro. Sin internet se cae a
//    linea recta hacia el punto.
// 3. Icono de flecha que apunta hacia donde debes ir.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import { useUbicacionGlobal } from '../hooks/useUbicacion';
import { usePrecauciones } from '../hooks/usePrecauciones';
import { hablar, callar } from '../lib/voz';
import { esPrecaucion } from '../lib/categorias';
import { obtenerRutaPeatonal, metrosRestantes } from '../lib/ruta';
import Brujula from '../components/Brujula';
import {
  distanciaMetros, rumboEntre, giroRelativo, textoGiro, textoRelativo,
} from '../lib/geo';
import datosMapa from '../datos_mapeo.json';

const AVANZA_LEJOS = 25;   // metros de avance para volver a hablar estando lejos
const AVANZA_CERCA = 8;    // metros de avance para volver a hablar estando cerca
const MAX_SILENCIO = 20000;  // maximo ms sin hablar (por si el GPS no avanza)
const META_M = 10;           // metros: se considera que llegaste
const PASAR_HITO_M = 15;     // metros: se considera que pasaste un giro de la ruta
const AVISO_GIRO_M = 35;     // metros: avisar el giro que se aproxima
const AVISO_LLEGADA_M = 40;  // metros: avisar que ya casi llegas

// Cuantos hitos (giros) de la ruta ya quedaron detras de la posicion actual.
// Funcion pura de la posicion: da el mismo resultado en el render y en el
// bucle de voz, sin necesidad de estado extra.
function calcularPasados(pasos, lat, lng) {
  let p = 0;
  while (p < pasos.length - 1) {
    const hit = pasos[p + 1];
    if (distanciaMetros(lat, lng, hit.lat, hit.lng) <= PASAR_HITO_M) p += 1;
    else break;
  }
  return p;
}

export default function PantallaNavegar() {
  const { ubica } = useUbicacionGlobal();
  const [puntos] = useState(datosMapa.puntos);
  const [destino, setDestino] = useState(null);
  const [segundo, setSegundo] = useState(() => Date.now());
  const [ruta, setRuta] = useState(null);          // ruta peatonal OSRM o null
  const [rutaCargando, setRutaCargando] = useState(false);

  // Reloj del contador "actualizado hace X s" (re-renderiza cada segundo)
  useEffect(() => {
    const t = setInterval(() => setSegundo(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ultimaDistanciaHablada = useRef(0); // distancia cuando se hablo la ultima vez
  const ultimoTiempoHabla = useRef(0);      // timestamp del ultimo anuncio
  const metaAnunciada = useRef(false);
  const ultimoGiroAviso = useRef(null);     // indice del ultimo giro anunciado
  const rutaIntentadaId = useRef(null);     // id del destino cuya ruta ya se pidio

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

  // Carga la ruta peatonal (una sola vez por destino) apenas hay GPS
  useEffect(() => {
    if (!destino || !ubica?.lat) return;
    if (ruta || rutaCargando || rutaIntentadaId.current === destino.id) return;
    rutaIntentadaId.current = destino.id;
    let activo = true;
    setRutaCargando(true);
    obtenerRutaPeatonal(ubica.lat, ubica.lng, destino.lat, destino.lng).then(r => {
      if (!activo) return;
      if (r) {
        setRuta(r);
        const primerGiro = r.pasos[1];
        if (primerGiro && !primerGiro.esLlegada) {
          hablar(`Ruta calculada: ${Math.round(r.distanciaTotal)} metros. ${primerGiro.texto}.`);
        } else {
          hablar(`Ruta calculada: ${Math.round(r.distanciaTotal)} metros. Ponte en camino.`);
        }
      } else {
        hablar('Sin ruta por calles: cámbiate a la dirección directa y te iré guiando.');
      }
      setRutaCargando(false);
    });
    return () => { activo = false; };
  }, [destino, ubica, ruta, rutaCargando]);

  const elegirDestino = useCallback(p => {
    setDestino(p);
    setRuta(null);
    setRutaCargando(false);
    metaAnunciada.current = false;
    ultimaDistanciaHablada.current = 0;
    ultimoTiempoHabla.current = 0;
    ultimoGiroAviso.current = null;
    if (!ubica?.lat) {
      hablar(`Navegando hacia ${p.nombre}. Espera a que llegue el GPS para guiarte.`);
      return;
    }
    hablar(`Buscando la mejor ruta hacia ${p.nombre}.`);
  }, [ubica]);

  const cancelar = useCallback(() => {
    callar();
    setDestino(null);
    setRuta(null);
    setRutaCargando(false);
  }, []);

  // Bucle de guia en tiempo real mientras se navega
  useEffect(() => {
    if (!destino || !ubica?.lat) return;
    const lat = ubica.lat, lng = ubica.lng;
    const ahora = Date.now();

    // ---- Modo ruta peatonal (OSRM) ----
    const pasos = ruta?.pasos;
    if (pasos && pasos.length >= 3) {
      const pasados = calcularPasados(pasos, lat, lng);
      const idxSig = Math.min(pasados + 1, pasos.length - 1);
      const siguiente = pasos[idxSig];
      const dSig = distanciaMetros(lat, lng, siguiente.lat, siguiente.lng);
      const rem = metrosRestantes(pasos, lat, lng, Math.max(pasados, 0));

      // Llegada
      if (siguiente.esLlegada && dSig <= META_M) {
        if (!metaAnunciada.current) {
          metaAnunciada.current = true;
          hablar(`Llegaste a ${destino.nombre}.`);
          setDestino(null);
        }
        return;
      }

      // La guia habla: cada AVANZA metros recorridos, o si llevamos silencio.
      const umbral = rem < 100 ? AVANZA_CERCA : AVANZA_LEJOS;
      const avanzo = ultimaDistanciaHablada.current - rem;
      const sinHablar = ahora - ultimoTiempoHabla.current > MAX_SILENCIO;
      if (avanzo < umbral && !sinHablar) return;

      // Aviso de llegada proxima (una sola vez)
      if (siguiente.esLlegada && dSig <= AVISO_LLEGADA_M && ultimoGiroAviso.current !== idxSig) {
        ultimoGiroAviso.current = idxSig;
        hablar(`Estás a ${Math.round(rem)} metros de ${destino.nombre}.`);
        return;
      }

      // Aviso del giro que se acerca (una sola vez por giro)
      if (!siguiente.esLlegada && dSig <= AVISO_GIRO_M && ultimoGiroAviso.current !== idxSig) {
        ultimoGiroAviso.current = idxSig;
        hablar(`En ${Math.round(dSig)} metros, ${siguiente.texto}.`);
        return;
      }

      // Cadencia normal: distancia que falta con la indicacion del proximo giro
      ultimaDistanciaHablada.current = rem;
      ultimoTiempoHabla.current = ahora;
      hablar(`A ${Math.round(rem)} metros. ${siguiente.esLlegada ? 'Vas bien.' : siguiente.texto}.`);
      return;
    }

    // ---- Modo linea recta (respaldo) ----
    const d = distanciaMetros(lat, lng, destino.lat, destino.lng);

    if (d <= META_M) {
      if (!metaAnunciada.current) {
        metaAnunciada.current = true;
        hablar(`Llegaste a ${destino.nombre}.`);
        setDestino(null);
      }
      return;
    }

    const umbral = d < 100 ? AVANZA_CERCA : AVANZA_LEJOS;
    const avanzo = ultimaDistanciaHablada.current - d;
    const sinHablar = ahora - ultimoTiempoHabla.current > MAX_SILENCIO;
    if (avanzo < umbral && !sinHablar) return;

    ultimaDistanciaHablada.current = d;
    ultimoTiempoHabla.current = ahora;

    const rumboObjetivo = rumboEntre(lat, lng, destino.lat, destino.lng);
    const rumboActual = ubica.rumboPantalla ?? ubica.rumbo;
    const giro = rumboActual != null ? giroRelativo(rumboActual, rumboObjetivo) : null;

    if (giro != null) {
      hablar(`A ${Math.round(d)} metros.` + textoGiro(giro));
    } else {
      hablar(`A ${Math.round(d)} metros. Camina y te iré guiando`);
    }
  }, [ubica, destino, ruta]);

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
  const usandoRuta = Boolean(ruta?.pasos && ruta.pasos.length >= 3);

  let d;                 // distancia a mostrar (restante por la ruta o en linea recta)
  let rumboObjetivo;     // a donde apuntar la flecha
  if (usandoRuta && conGps) {
    const s = ruta.pasos;
    const p = calcularPasados(s, ubica.lat, ubica.lng);
    const idx = Math.min(p + 1, s.length - 1);
    const prox = s[idx];
    d = metrosRestantes(s, ubica.lat, ubica.lng, Math.max(p, 0));
    rumboObjetivo = rumboEntre(ubica.lat, ubica.lng, prox.lat, prox.lng);
  } else {
    d = conGps ? distanciaMetros(ubica.lat, ubica.lng, destino.lat, destino.lng) : null;
    rumboObjetivo = conGps ? rumboEntre(ubica.lat, ubica.lng, destino.lat, destino.lng) : null;
  }
  const rumboActual = (ubica?.rumboPantalla ?? ubica?.rumbo) ?? null;
  const giro = conGps && rumboActual != null ? giroRelativo(rumboActual, rumboObjetivo) : null;
  const relativo = conGps && rumboObjetivo != null ? textoRelativo(rumboActual, rumboObjetivo) : '';

  // Segundos desde la ultima lectura del GPS (en vivo)
  const segActualizados = ubica?.actualizadoEn
    ? Math.max(0, Math.round((segundo - ubica.actualizadoEn) / 1000))
    : null;

  const anguloFlecha = giro != null ? giro : 0;
  const estadoRuta = rutaCargando
    ? 'Calculando ruta…'
    : usandoRuta
      ? 'Ruta por calles del campus'
      : 'Dirección directa al punto';

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
                  ? (Math.abs(giro) < 20 ? 'Vas bien, sigue derecho' : anguloFlecha > 0 ? 'El giro está a tu derecha' : 'El giro está a tu izquierda')
                  : 'Camina y se ajusta la guía')
              : 'Esperando GPS...'}
          </Text>
        </View>

        <Text style={styles.navDistancia} accessible={true}>
          {d != null ? `${Math.round(d)} metros` : 'Esperando GPS...'}
        </Text>
        <Text style={styles.navRuta} accessible={true}>
          {estadoRuta}
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
  navRuta: { color: '#a7c957', fontSize: 14, fontWeight: '700', textAlign: 'center' },
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