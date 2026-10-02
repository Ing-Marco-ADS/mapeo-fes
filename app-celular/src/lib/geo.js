// Utilidades de geolocalizacion (metodos puros, probables con Node)

const R = 6371000; // radio de la Tierra en metros

// Distancia Haversine entre dos puntos en metros
export function distanciaMetros(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Rumbo (bearing) en grados 0-360 desde el punto 1 hacia el punto 2.
// 0 = norte, 90 = este, 180 = sur, 270 = oeste.
export function rumboEntre(lat1, lng1, lat2, lng2) {
  const f1 = lat1 * Math.PI / 180;
  const f2 = lat2 * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Nombre cardinal de un rumbo, para hablar de forma natural.
export function cardinalDeRumbo(grados) {
  const cuadrantes = ['norte', 'noreste', 'este', 'sureste',
    'sur', 'suroeste', 'oeste', 'noroeste'];
  const i = Math.round(grados / 45) % 8;
  return cuadrantes[i];
}

// Cuantos grados hay que girar (positivo = derecha, negativo = izquierda)
// desde el rumbo actual hacia el rumbo objetivo. Rango -180..180.
export function giroRelativo(rumboActual, rumboObjetivo) {
  let d = (rumboObjetivo - rumboActual) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

// Frase hablable para un giro: usada cuando hay que girar para ir a un destino.
export function textoGiro(grados) {
  if (Math.abs(grados) < 15) return ' sigue de frente. ';
  if (Math.abs(grados) < 60) return grados > 0 ? ' gira ligeramente a la derecha. ' : ' gira ligeramente a la izquierda. ';
  if (Math.abs(grados) < 150) return grados > 0 ? ' gira a la derecha. ' : ' gira a la izquierda. ';
  return grados > 0 ? ' da la vuelta a la derecha. ' : ' da la vuelta a la izquierda. ';
}

// Posicion del destino RELATIVA a la direccion en que caminas/ves.
// Comprensible para todos: en vez de "por el noroeste" decimos
// "enfrente de ti", "a tu derecha", "directamente atras de ti", etc.
export function textoRelativo(rumboActual, rumboObjetivo) {
  if (rumboActual == null) return '';
  const g = giroRelativo(rumboActual, rumboObjetivo);
  const a = Math.abs(g);
  if (a < 20) return ' enfrente de ti';
  if (a < 60) return g > 0 ? ' un poco a tu derecha' : ' un poco a tu izquierda';
  if (a < 120) return g > 0 ? ' a tu derecha' : ' a tu izquierda';
  if (a < 160) return g > 0 ? ' hacia atrás y a tu derecha' : ' hacia atrás y a tu izquierda';
  return ' directamente atrás de ti';
}

// Formatea metros de forma natural y exacta para voz (para que se
// note que la distancia va bajando al caminar)
export function textoDistancia(metros) {
  const n = Math.round(metros);
  if (n < 10) return `a ${n} metros`;
  if (n < 100) return `a ${n} metros`;
  if (n < 1000) return `a ${(n / 100).toFixed(0)}00 metros`;
  return `a ${(n / 1000).toFixed(1)} kilómetros`;
}

// Redondea para voz de forma natural (ej: 33.4 -> 33)
export function redondear(n) {
  return Math.round(n);
}