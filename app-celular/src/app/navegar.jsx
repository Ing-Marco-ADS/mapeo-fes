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
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useUbicacionGlobal } from '../hooks/useUbicacion';
import { usePrecauciones } from '../hooks/usePrecauciones';
import { hablar, callar } from '../lib/voz';
import { esPrecaucion } from '../lib/categorias';
import { obtenerRutaPeatonal, metrosRestantes } from '../lib/ruta';
import FlechaDestino from '../components/FlechaDestino';
import Icono from '../components/Icono';
import {
  distanciaMetros, rumboEntre, giroRelativo, textoGiro, textoDireccion, textoDistancia,
} from '../lib/geo';
import { C, SOMBRA_SUAVE, R } from '../lib/tema';
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

// Distancia en dos partes para mostrarla grande y clara.
function distanciaVisual(metros) {
  if (metros == null) return { numero: '—', unidad: '' };
  const n = Math.round(metros);
  if (n < 1000) return { numero: String(n), unidad: n === 1 ? 'metro' : 'metros' };
  const km = n / 1000;
  return { numero: km.toFixed(1), unidad: km === 1 ? 'kilómetro' : 'kilómetros' };
}

export default function PantallaNavegar() {
  const { ubica, rumboReferencia, rumboPantalla, fuenteRumbo, permiso } = useUbicacionGlobal();
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
    const posLat = ubica.latCruda ?? ubica.lat;
    const posLng = ubica.lngCruda ?? ubica.lng;
    let mejor = null;
    let mejorDist = Infinity;
    for (const p of lugares) {
      const d = distanciaMetros(posLat, posLng, p.lat, p.lng);
      if (d < mejorDist) { mejorDist = d; mejor = p; }
    }
    return { punto: mejor, distancia: mejorDist };
  }, [lugares, ubica]);

  // Lugares ordenados por distancia (si hay GPS)
  const ordenados = useMemo(() => {
    if (!ubica?.lat) return lugares;
    const posLat = ubica.latCruda ?? ubica.lat;
    const posLng = ubica.lngCruda ?? ubica.lng;
    return [...lugares].sort(
      (a, b) =>
        distanciaMetros(posLat, posLng, a.lat, a.lng) -
        distanciaMetros(posLat, posLng, b.lat, b.lng)
    );
  }, [lugares, ubica]);

  // Carga la ruta peatonal (una sola vez por destino) apenas hay GPS
  useEffect(() => {
    if (!destino || !ubica?.lat) return;
    if (ruta || rutaCargando || rutaIntentadaId.current === destino.id) return;
    rutaIntentadaId.current = destino.id;
    let activo = true;
    setRutaCargando(true);
    obtenerRutaPeatonal(ubica.latCruda ?? ubica.lat, ubica.lngCruda ?? ubica.lng, destino.lat, destino.lng).then(r => {
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
    // Posicion mas fresca (GPS crudo) para que la distancia reaccione al instante.
    const lat = ubica.latCruda ?? ubica.lat;
    const lng = ubica.lngCruda ?? ubica.lng;
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
        <StatusBar style="light" />
        <View style={styles.selCabecera}>
          <Text style={styles.selTitulo}>¿A dónde vas?</Text>
          <Text style={styles.selSub}>
            Elige un destino y te guío con la voz, paso a paso.
          </Text>

          {puntoMasCercano ? (
            <Pressable
              style={({ pressed }) => [styles.sugerencia, pressed && styles.presionado]}
              onPress={() => elegirDestino(puntoMasCercano.punto)}
              accessibilityRole="button"
              accessibilityLabel={`Ir al lugar más cercano: ${puntoMasCercano.punto.nombre}, a ${Math.round(puntoMasCercano.distancia)} metros`}
              accessibilityHint="Inicia la navegación por voz hacia este lugar"
            >
              <View style={styles.sugerenciaIcono}>
                <Icono nombre="ubicacionFija" tamaño={22} color={C.blanco} />
              </View>
              <View style={styles.sugerenciaTextos}>
                <Text style={styles.sugerenciaEtiqueta}>SUGERENCIA MÁS CERCANA</Text>
                <Text style={styles.sugerenciaNombre} numberOfLines={1}>
                  {puntoMasCercano.punto.nombre}
                </Text>
                <Text style={styles.sugerenciaDetalle}>
                  {textoDistancia(puntoMasCercano.distancia)} · toca para ir
                </Text>
              </View>
              <Icono nombre="chevron" tamaño={19} color={C.blanco} />
            </Pressable>
          ) : (
            <View style={styles.sinGps}>
              <View style={styles.sinGpsIcono}>
                <Icono nombre="ubicacionFija" tamaño={18} color={C.ambar} />
              </View>
              <Text style={styles.sinGpsTexto}>
                {permiso === 'denied'
                  ? 'Sin permiso de ubicación: actívalo para medir distancias.'
                  : 'Esperando GPS… igual puedes elegir un destino de la lista.'}
              </Text>
            </View>
          )}
        </View>

        <FlatList
          data={ordenados}
          keyExtractor={p => String(p.id)}
          contentContainerStyle={styles.lista}
          ListHeaderComponent={
            <View style={styles.avisoPrecaucion}>
              <Icono nombre="alerta" tamaño={16} color={C.ambar} />
              <Text style={styles.avisoPrecaucionTexto}>
                Escaleras, rampas y escalones no son destinos: se avisan por voz
                cuando te acercas.
              </Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const conGps = Boolean(ubica?.lat);
            const posLat = ubica?.latCruda ?? ubica?.lat;
            const posLng = ubica?.lngCruda ?? ubica?.lng;
            const d = conGps ? distanciaMetros(posLat, posLng, item.lat, item.lng) : null;
            const color = item.color || C.azul;
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.item,
                  index === 0 && conGps && styles.itemCercano,
                  pressed && styles.itemPresionado,
                ]}
                onPress={() => elegirDestino(item)}
                accessibilityRole="button"
                accessibilityLabel={`Ir a ${item.nombre}${d != null ? `, a ${Math.round(d)} metros` : ''}`}
                accessibilityHint="Inicia la navegación por voz hacia este lugar"
              >
                <View style={[styles.itemAvatar, { backgroundColor: color + '22' }]}>
                  <View style={[styles.itemPunto, { backgroundColor: color }]} />
                </View>
                <View style={styles.itemTextos}>
                  <View style={styles.itemNombreFila}>
                    <Text style={styles.itemNombre} numberOfLines={1}>{item.nombre}</Text>
                    {index === 0 && conGps && (
                      <View style={styles.badgeCercano}>
                        <Text style={styles.badgeCercanoTexto}>MÁS CERCANO</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.itemTipo} numberOfLines={1}>{item.tipoNombre}</Text>
                </View>
                <View style={styles.itemDistancia}>
                  <Text style={styles.itemDistanciaNumero}>{d != null ? Math.round(d) : '—'}</Text>
                  <Text style={styles.itemDistanciaUnidad}>m</Text>
                </View>
                <Icono nombre="chevron" tamaño={15} color={C.textoSuave} />
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
    const posLat = ubica.latCruda ?? ubica.lat;
    const posLng = ubica.lngCruda ?? ubica.lng;
    const p = calcularPasados(s, posLat, posLng);
    const idx = Math.min(p + 1, s.length - 1);
    const prox = s[idx];
    d = metrosRestantes(s, posLat, posLng, Math.max(p, 0));
    rumboObjetivo = rumboEntre(posLat, posLng, prox.lat, prox.lng);
  } else {
    const posLat2 = ubica.latCruda ?? ubica.lat;
    const posLng2 = ubica.lngCruda ?? ubica.lng;
    d = conGps ? distanciaMetros(posLat2, posLng2, destino.lat, destino.lng) : null;
    rumboObjetivo = conGps ? rumboEntre(posLat2, posLng2, destino.lat, destino.lng) : null;
  }
  const rumboActual = rumboReferencia ?? null;
  const rumboTelefono = rumboPantalla ?? rumboReferencia ?? null;
  const giro = conGps && rumboActual != null && rumboObjetivo != null
    ? giroRelativo(rumboActual, rumboObjetivo)
    : null;
  const giroFlecha = conGps && rumboTelefono != null && rumboObjetivo != null
    ? giroRelativo(rumboTelefono, rumboObjetivo)
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

  const anguloFlecha = giroFlecha != null ? giroFlecha : 0;
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

  const visual = distanciaVisual(d);

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
      const p = calcularPasados(ruta.pasos, ubica.latCruda ?? ubica.lat, ubica.lngCruda ?? ubica.lng);
      const sig = ruta.pasos[Math.min(p + 1, ruta.pasos.length - 1)];
      if (sig && !sig.esLlegada) partes.push(sig.texto + '.');
    }
    if (partes.length === 0) partes.push('Sigue caminando y te voy guiando.');
    hablar(partes.join(' '));
  };

  const leyendaFlecha = !conGps
    ? 'Esperando GPS…'
    : giroFlecha != null
      ? (Math.abs(giroFlecha) < 20
          ? 'Sigue derecho: el destino está al frente'
          : giroFlecha > 0
            ? 'La flecha apunta a tu derecha'
            : 'La flecha apunta a tu izquierda')
      : `La flecha se activa al caminar. Mientras tanto, el destino está${direccion}`;

  const precision = ubica?.precision ?? null;
  const calidadGps = precision == null
    ? 0.15
    : Math.max(0.15, Math.min(1, 1 - (precision - 5) / 45));

  return (
    <View style={styles.navContenedor}>
      <StatusBar style="light" />
      {/* Decoracion de fondo */}
      <View style={styles.navManchaA} pointerEvents="none" />
      <View style={styles.navManchaB} pointerEvents="none" />

      <View style={styles.navCabecera}>
        <Text style={styles.navEtiqueta}>DESTINO</Text>
        <Text style={styles.navDestino} numberOfLines={2}>{destino.nombre}</Text>
        <View style={styles.navChip}>
          <View style={styles.navChipPunto} />
          <Text style={styles.navChipTexto}>{estadoRuta}</Text>
        </View>
      </View>

      <View style={styles.flechaZona}>
        <FlechaDestino giro={anguloFlecha} tamaño={186} activo={giroFlecha != null} />
        <Text style={styles.flechaLeyenda} accessible={true}>{leyendaFlecha}</Text>
      </View>

      <View style={styles.distanciaZona}>
        <View style={styles.distanciaFila}>
          <Text style={styles.navDistanciaNumero} accessible={true}>{visual.numero}</Text>
          {visual.unidad !== '' && (
            <Text style={styles.navDistanciaUnidad}>{visual.unidad}</Text>
          )}
        </View>
        <Text style={styles.navRumbo} accessible={true}>
          {direccion !== '' ? `El destino está${direccion}` : 'Camina unos pasos y te oriento'}
        </Text>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.navPieZona}>
        <View style={styles.navPie}>
          <View style={styles.precisionFila}>
            <Text style={styles.precisionTexto}>
              {conGps
                ? `GPS activo · precisión ±${Math.round(precision ?? 0)} m`
                : permiso === 'denied'
                  ? 'Sin permiso de ubicación'
                  : 'Sin señal GPS aún'}
            </Text>
            <Text style={styles.precisionTexto}>
              {segActualizados != null ? `hace ${segActualizados} s` : ''}
            </Text>
          </View>
          <View style={styles.precisionBarra}>
            <View
              style={[
                styles.precisionRelleno,
                {
                  width: `${Math.round(calidadGps * 100)}%`,
                  backgroundColor: precision != null && precision <= 20 ? C.verde : C.ambar,
                },
              ]}
            />
          </View>
          <Text style={styles.navFuente}>{fuenteTexto}</Text>

          <View style={styles.filaBotonesNav}>
            <Pressable
              style={({ pressed }) => [styles.botonRepetir, pressed && styles.presionado]}
              onPress={repetirIndicacion}
              accessibilityRole="button"
              accessibilityLabel="Repetir la indicación de navegación"
              accessibilityHint="Vuelve a decir la distancia y hacia dónde ir"
            >
              <Icono nombre="sonido" tamaño={18} color={C.navy} />
              <Text style={styles.botonRepetirTexto}>Repetir</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.botonCancelar, pressed && styles.presionado]}
              onPress={cancelar}
              accessibilityRole="button"
              accessibilityLabel="Cancelar navegación"
              accessibilityHint="Detiene la guía por voz"
            >
              <Text style={styles.botonCancelarTexto}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: C.fondo },
  presionado: { opacity: 0.75, transform: [{ scale: 0.985 }] },

  // ---------- seleccion de destino ----------
  selCabecera: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    backgroundColor: C.tarjeta,
    borderBottomWidth: 1,
    borderBottomColor: C.borde,
    gap: 6,
  },
  selTitulo: { fontSize: 24, fontWeight: '900', color: C.navy },
  selSub: { fontSize: 14, color: C.textoMedio, lineHeight: 20 },
  sugerencia: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    padding: 14,
    borderRadius: R.l,
    backgroundColor: C.azul,
    ...SOMBRA_SUAVE,
  },
  sugerenciaIcono: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sugerenciaTextos: { flex: 1 },
  sugerenciaEtiqueta: {
    fontSize: 9,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 0.8,
  },
  sugerenciaNombre: { fontSize: 17, fontWeight: '900', color: C.blanco, marginTop: 1 },
  sugerenciaDetalle: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 1 },

  sinGps: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    padding: 12,
    borderRadius: R.m,
    backgroundColor: C.ambarClaro,
  },
  sinGpsIcono: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sinGpsTexto: { flex: 1, fontSize: 13, color: '#92400E', lineHeight: 18, fontWeight: '600' },

  lista: { paddingHorizontal: 12, paddingBottom: 32 },
  avisoPrecaucion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.ambarClaro,
    borderRadius: R.m,
    padding: 10,
    marginTop: 12,
    marginBottom: 10,
  },
  avisoPrecaucionTexto: { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 17, fontWeight: '600' },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.tarjeta,
    borderRadius: R.m,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.borde,
    ...SOMBRA_SUAVE,
  },
  itemCercano: { borderColor: C.verde, borderWidth: 1.5 },
  itemPresionado: { backgroundColor: C.azulClaro, transform: [{ scale: 0.99 }] },
  itemAvatar: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemPunto: { width: 15, height: 15, borderRadius: 8 },
  itemTextos: { flex: 1 },
  itemNombreFila: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  itemNombre: { fontSize: 16, fontWeight: '800', color: C.texto, flexShrink: 1 },
  itemTipo: { fontSize: 12, color: C.textoSuave, marginTop: 2 },
  badgeCercano: {
    backgroundColor: C.verdeClaro,
    borderRadius: R.redondo,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeCercanoTexto: { fontSize: 8, fontWeight: '900', color: C.verdeOscuro, letterSpacing: 0.4 },
  itemDistancia: { alignItems: 'center', minWidth: 38 },
  itemDistanciaNumero: { fontSize: 18, fontWeight: '900', color: C.navy, lineHeight: 20 },
  itemDistanciaUnidad: { fontSize: 10, fontWeight: '700', color: C.textoSuave },

  // ---------- navegacion en vivo ----------
  navContenedor: {
    flex: 1,
    backgroundColor: C.navy,
    paddingHorizontal: 20,
    paddingTop: 12,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  navManchaA: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(47,128,237,0.22)',
    top: -120,
    right: -110,
  },
  navManchaB: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(14,159,110,0.16)',
    bottom: 40,
    left: -130,
  },
  navCabecera: { alignItems: 'center', gap: 4 },
  navEtiqueta: {
    fontSize: 10,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.6,
  },
  navDestino: { fontSize: 24, fontWeight: '900', color: C.blanco, textAlign: 'center' },
  navChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: R.redondo,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  navChipPunto: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#34D399' },
  navChipTexto: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },

  flechaZona: { alignItems: 'center', gap: 10 },
  flechaLeyenda: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: 18,
  },

  distanciaZona: { alignItems: 'center', gap: 2 },
  distanciaFila: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  navDistanciaNumero: {
    fontSize: 62,
    fontWeight: '900',
    color: C.blanco,
    lineHeight: 66,
    letterSpacing: -1,
  },
  navDistanciaUnidad: {
    fontSize: 18,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.65)',
    marginBottom: 10,
  },
  navRumbo: {
    fontSize: 15,
    fontWeight: '600',
    color: '#BFDBFE',
    textAlign: 'center',
  },

  navPieZona: { width: '100%' },
  navPie: { gap: 8, paddingTop: 8 },
  precisionFila: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  precisionTexto: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.65)' },
  precisionBarra: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  precisionRelleno: { height: 5, borderRadius: 3 },
  navFuente: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
  },
  filaBotonesNav: { flexDirection: 'row', gap: 10, marginTop: 4 },
  botonRepetir: {
    flex: 1.4,
    height: 54,
    borderRadius: R.m,
    backgroundColor: C.blanco,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  botonRepetirTexto: { color: C.navy, fontSize: 16, fontWeight: '900' },
  botonCancelar: {
    flex: 1,
    height: 54,
    borderRadius: R.m,
    backgroundColor: 'rgba(220,38,38,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonCancelarTexto: { color: C.blanco, fontSize: 15, fontWeight: '800' },
});
