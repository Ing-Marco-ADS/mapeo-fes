// Planificador de ruta peatonal con OSRM publico (gratis, SIN clave).
// - Servidor: https://routing.openstreetmap.de/routed-foot (perfil foot,
//   datos de OpenStreetMap, actualizado cada ~2 dias; uso ligero permitido).
// - Devuelve indicaciones paso a paso (giros, calles, distancias) para guiar
//   por voz. Si algo falla (sin internet, timeout) la app usa la direccion
//   directa en linea recta como respaldo.
import { distanciaMetros } from './geo';

const OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';

// Traduce el modificador de OSRM a una frase hablada natural.
function fraseGiro(mod) {
  switch (mod) {
    case 'left': return 'gira a la izquierda';
    case 'right': return 'gira a la derecha';
    case 'slight left': return 'gira ligeramente a la izquierda';
    case 'slight right': return 'gira ligeramente a la derecha';
    case 'sharp left': return 'da una vuelta cerrada a la izquierda';
    case 'sharp right': return 'da una vuelta cerrada a la derecha';
    case 'uturn': return 'da la vuelta completa';
    case 'straight': return 'sigue de frente';
    default: return '';
  }
}

function ordinal(n) {
  const o = ['primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta'];
  return o[n - 1] || `${n}.ª`;
}

// Construye la instruccion hablada de un paso de OSRM.
function textoInstruccion(paso) {
  const tipo = paso.maneuver.type;
  const mod = paso.maneuver.modifier;
  const nombre = (paso.name || '').trim();
  const en = nombre ? ` en ${nombre}` : '';
  let verbo = '';
  switch (tipo) {
    case 'turn':
    case 'forced':
    case 'not for':
      verbo = (fraseGiro(mod) || 'gira') + en;
      break;
    case 'end of road':
      verbo = (fraseGiro(mod) || 'sigue de frente') + en;
      break;
    case 'continue':
      verbo = 'sigue de frente' + en;
      break;
    case 'merge':
      verbo = `incorpórate${en}`;
      break;
    case 'on ramp':
      verbo = (mod === 'left' ? 'toma la entrada de la izquierda' : mod === 'right' ? 'toma la entrada de la derecha' : 'toma la entrada') + en;
      break;
    case 'off ramp':
      verbo = (mod === 'left' ? 'toma la salida de la izquierda' : mod === 'right' ? 'toma la salida de la derecha' : 'toma la salida') + en;
      break;
    case 'roundabout':
    case 'rotary':
      verbo = paso.maneuver.exit != null
        ? `toma la ${ordinal(paso.maneuver.exit)} salida de la glorieta`
        : 'toma la glorieta';
      break;
    case 'depart':
      verbo = `ponte en camino${en}`;
      break;
    case 'arrive':
      verbo = 'has llegado a tu destino';
      break;
    default:
      verbo = (fraseGiro(mod) || 'continúa') + en;
  }
  return verbo;
}

// Busca una ruta peatonal entre dos puntos. Devuelve:
//   { distanciaTotal, pasos: [{ lat, lng, segmento, texto, esInicio, esLlegada }] }
// pasos[0] es el punto de partida y el ultimo la llegada. O null si falla.
export async function obtenerRutaPeatonal(latOrigen, lngOrigen, latDestino, lngDestino) {
  const url =
    `${OSRM_FOOT}/${lngOrigen},${latOrigen};${lngDestino},${latDestino}` +
    '?steps=true&overview=false&alternatives=false&continue_straight=false';
  try {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), 9000);
    const res = await fetch(url, { signal: controlador.signal });
    clearTimeout(temporizador);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.code !== 'Ok') return null;
    const ruta = json.routes?.[0];
    const pasosCrudos = ruta?.legs?.[0]?.steps;
    if (!ruta || !Array.isArray(pasosCrudos) || pasosCrudos.length < 2) return null;

    const pasos = pasosCrudos.map((paso, i) => {
      const [lng, lat] = paso.maneuver.location;
      return {
        lat,
        lng,
        segmento: paso.distance || 0,
        texto: textoInstruccion(paso),
        esInicio: i === 0,
        esLlegada: paso.maneuver.type === 'arrive',
      };
    });

    // Ruta demasiado corta en reales (p. ej. <80 m) o con un solo giro:
    // mejor guiar en linea recta que dar rodeos.
    if (pasos.length <= 4 || ruta.distance < 80) return null;

    return { distanciaTotal: ruta.distance, pasos };
  } catch (_e) {
    return null;
  }
}

// Distancia que falta por recorrer SIGUIENDO la ruta, desde la posicion actual
// (suma la distancia al siguiente giro + los tramos restantes).
export function metrosRestantes(pasos, posLat, posLng, pasadoHasta) {
  const primero = pasos[Math.min(pasadoHasta + 1, pasos.length - 1)];
  let restante = distanciaMetros(posLat, posLng, primero.lat, primero.lng);
  for (let i = pasadoHasta + 1; i < pasos.length; i++) {
    restante += pasos[i].segmento || 0;
  }
  return restante;
}