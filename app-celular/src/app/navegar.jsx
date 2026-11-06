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
import FlechaDestino from '../components/FlechaDestino';
import {
  distanciaMetros, rumboEntre, giroRelativo, textoGiro, textoDireccion, textoDistancia,
} from '../lib/geo';
import datosMapa from '../datos_mapeo.json';

const AVANZA_LEJOS = 25;   // metros de avance para volver a hablar estando lejos
const AVANZA_CERCA = 8;    // metros de avance para volver a hablar estando cerca
const MAX_SILENCIO = 15000;  // maximo ms sin hablar (por si el GPS no avanza)
const REHABLAR_GIRO_MS = 4000;   // minima pausa entre avisos por cambio de giro
const CAMBIO_GIRO_GRADOS = 35;   // si el rumbo cambia esto, se avisa en el acto
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
  const { ubica, rumboReferencia, fuenteRumbo, permiso } = useUbicacionGlobal();
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
  const ultimoGiroHablado = useRef(null);   // ultimo giro relativo anunciado
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
    rutaIntentadaId.current = null;
    metaAnunciada.current = false;
    ultimaDistanciaHablada.current = 0;
    ultimoTiempoHabla.current = 0;
    ultimoGiroHablado.current = null;
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

  // Bucle de guia en tiempo real mientras se navega.
  // La direccion sale de `rumboReferencia`: al caminar manda el GPS (funciona
  // en cualquier telefono) y, si estas quieto, la brujula. Si no hay ninguna,
  // igual decimos la direccion cardinal ("al noreste"), nunca nos quedamos callados.
  useEffect(() => {
    if (!destino || !ubica?.lat) return;
    const lat = ubica.lat, lng = ubica.lng;
    const ahora = Date.now();
    const rumboActual = rumboReferencia ?? null;

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
        ultimaDistanciaHablada.current = rem;
        ultimoTiempoHabla.current = ahora;
        hablar(`Estás a ${Math.round(rem)} metros de ${destino.nombre}.`);
        return;
      }

      // Aviso del giro que se acerca (una sola vez por giro)
      if (!siguiente.esLlegada && dSig <= AVISO_GIRO_M && ultimoGiroAviso.current !== idxSig) {
        ultimoGiroAviso.current = idxSig;
        ultimaDistanciaHablada.current = rem;
        ultimoTiempoHabla.current = ahora;
        hablar(`En ${Math.round(dSig)} metros, ${siguiente.texto}.`);
        return;
      }

      // Cadencia normal: distancia que falta con la indicacion del proximo giro
      ultimaDistanciaHablada.current = rem;
      ultimoTiempoHabla.current = ahora;
      hablar(`A ${Math.round(rem)} metros. ${siguiente.esLlegada ? 'Vas bien.' : siguiente.texto}.`);
      return;
    }

    // ---- Modo linea recta (respaldo si OSRM no responde) ----
    const d = distanciaMetros(lat, lng, destino.lat, destino.lng);

    if (d <= META_M) {
      if (!metaAnunciada.current) {
        metaAnunciada.current = true;
        hablar(`Llegaste a ${destino.nombre}.`);
        setDestino(null);
      }
      return;
    }

    const rumboObjetivo = rumboEntre(lat, lng, destino.lat, destino.lng);
    const giro = rumboActual != null ? giroRelativo(rumboActual, rumboObjetivo) : null;

    const umbral = d < 100 ? AVANZA_CERCA : AVANZA_LEJOS;
    const avanzo = ultimaDistanciaHablada.current - d;
    const sinHablar = ahora - ultimoTiempoHabla.current > MAX_SILENCIO;
    // Si cambias de direccion (giras), se avisa en ese momento, no despues.
    const cambioGiro = giro != null && ultimoGiroHablado.current != null
      ? Math.abs(giroRelativo(ultimoGiroHablado.current, giro))
      : 0;
    const giroNuevo = giro != null
      && cambioGiro >= CAMBIO_GIRO_GRADOS
      && ahora - ultimoTiempoHabla.current > REHABLAR_GIRO_MS;

    if (avanzo < umbral && !sinHablar && !giroNuevo) return;

    ultimaDistanciaHablada.current = d;
    ultimoTiempoHabla.current = ahora;
    ultimoGiroHablado.current = giro;

    // Sin brujula ni curso GPS: se usa el cardinal absoluto del destino.
    const donde = textoDireccion(rumboActual, rumboObjetivo);
    if (giro != null) {
      const frase = Math.abs(giro) < 20 ? 'sigue de frente.' : textoGiro(giro).trim();
      hablar(`A ${Math.round(d)} metros. ${frase} El destino está${donde}.`);
    } else {
      hablar(`A ${Math.round(d)} metros. El destino está${donde}. Camina unos pasos y te voy corrigiendo.`);
    }
  }, [ubica, destino, ruta, rumboReferencia]);

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
  const rumboActual = rumboReferencia ?? null;
  const giro = conGps && rumboActual != null && rumboObjetivo != null
    ? giroRelativo(rumboActual, rumboObjetivo)
    : null;
  // `textoDireccion` cae al cardinal absoluto ("al noreste") si aun no hay
  // rumbo, asi que SIEMPRE hay una indicacion util para la persona.
  const direccion = conGps && rumboObjetivo != null
    ? textoDireccion(rumboActual, rumboObjetivo)
    : '';

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
  const fuenteTexto = fuenteRumbo === 'gps'
    ? 'Dirección según tu caminata (GPS)'
    : fuenteRumbo === 'brujula'
      ? 'Dirección según la brújula'
      : 'Sin rumbo todavía: se usa la referencia cardinal';

  // Repite la indicacion actual a demanda (boton grande, util sin mirar).
  const repetirIndicacion = () => {
    if (!conGps) {
      hablar('Todavía no tengo tu ubicación. Espera la señal del GPS.');
      return;
    }
    const partes = [];
    if (d != null) partes.push(`Faltan ${Math.round(d)} metros.`);
    if (direccion) partes.push(`El destino está${direccion}.`);
    if (giro != null && Math.abs(giro) >= 20) partes.push(textoGiro(giro).trim());
    if (usandoRuta && ruta?.pasos) {
      const p = calcularPasados(ruta.pasos, ubica.lat, ubica.lng);
      const sig = ruta.pasos[Math.min(p + 1, ruta.pasos.length - 1)];
      if (sig && !sig.esLlegada) partes.push(sig.texto + '.');
    }
    if (partes.length === 0) partes.push('Sigue caminando y te voy guiando.');
    hablar(partes.join(' '));
  };

  return (
    <View style={styles.contenedor}>
      <View style={styles.navPanel}>
        <Text style={styles.navDestino} accessible={true}>
          Hacia: {destino.nombre}
        </Text>

        <View style={styles.flechaZona}>
          <FlechaDestino giro={anguloFlecha} tamaño={200} activo={giro != null} />
          <Text style={styles.flechaLeyenda} accessible={true}>
            {!conGps
              ? 'Esperando GPS…'
              : giro != null
                ? (Math.abs(giro) < 20
                    ? 'La flecha apunta al frente: sigue derecho'
                    : giro > 0
                      ? 'La flecha apunta a tu derecha'
                      : 'La flecha apunta a tu izquierda')
                : `La flecha se activa al caminar. Mientras tanto, el destino está${direccion}`}
          </Text>
        </View>

        <Text style={styles.navDistancia} accessible={true}>
          {d != null ? textoDistancia(d) : 'Esperando GPS...'}
        </Text>
        <Text style={styles.navRuta} accessible={true}>
          {estadoRuta}
        </Text>
        {direccion !== '' && (
          <Text style={styles.navRumbo} accessible={true}>
            El destino está{direccion}
          </Text>
        )}
        <Text style={styles.navFuente} accessible={true}>
          {fuenteTexto}
        </Text>
        <View style={styles.gpsVivo}>
          <Text style={styles.gpsVivoTexto} accessible={true}>
            {conGps
              ? `GPS activo · precisión ±${Math.round(ubica.precision ?? 0)} m`
              : permiso === 'denied'
                ? 'Sin permiso de ubicación'
                : 'Sin señal GPS aún'}
          </Text>
          <Text style={styles.gpsVivoTexto} accessible={true}>
            {segActualizados != null ? `actualizado hace ${segActualizados} s` : ''}
          </Text>
        </View>
        <View style={styles.filaBotonesNav}>
          <Pressable
            style={({ pressed }) => [styles.botonRepetir, pressed && styles.botonPresionado]}
            onPress={repetirIndicacion}
            accessibilityRole="button"
            accessibilityLabel="Repetir la indicación de navegación"
            accessibilityHint="Vuelve a decir la distancia y hacia dónde ir"
          >
            <Text style={styles.botonRepetirTexto}>Repetir</Text>
          </Pressable>
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
  flechaZona: { alignItems: 'center', marginVertical: 8 },
  flechaLeyenda: { color: '#bbf7d0', fontSize: 14, textAlign: 'center', marginTop: 12 },
  navDistancia: { color: '#dbeafe', fontSize: 26, fontWeight: '700', textAlign: 'center' },
  navRuta: { color: '#a7c957', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  navRumbo: { color: '#93c5fd', fontSize: 15, textAlign: 'center' },
  navFuente: { color: '#7dd3fc', fontSize: 12, textAlign: 'center' },
  gpsVivo: { marginTop: 10, alignItems: 'center', gap: 2 },
  gpsVivoTexto: { color: '#93c5fd', fontSize: 13, textAlign: 'center' },
  filaBotonesNav: { flexDirection: 'row', gap: 12, marginTop: 20, flexWrap: 'wrap', justifyContent: 'center' },
  botonRepetir: {
    backgroundColor: '#2563eb',
    paddingVertical: 16,
    paddingHorizontal: 30,
    borderRadius: 12,
    alignItems: 'center',
  },
  botonRepetirTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
  botonCancelar: {
    backgroundColor: '#dc2626',
    paddingVertical: 16,
    paddingHorizontal: 30,
    borderRadius: 12,
    alignItems: 'center',
  },
  botonCancelarTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
  botonPresionado: { opacity: 0.75 },
});