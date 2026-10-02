// Categorias de puntos para la app.
// Distingue LUGARES a donde ir de OBSTACULOS que solo deben
// AVISARSE para tener cuidado (no son destinos de navegacion).

// Tipos que representan riesgo de tropiezo/lesion: solo se avisan
// al usuario para que tenga cuidado, nunca son destino a donde ir.
export const TIPOS_PRECAUCION = new Set([
  'escaleras',
  'rampa',
  'escalon',
]);

// Metros: a esta distancia avisamos del obstaculo por voz
export const RADIO_PRECAUCION_M = 20;

export function esPrecaucion(punto) {
  return TIPOS_PRECAUCION.has(punto?.tipo);
}

// Frase de voz segura frente a un obstaculo
export function textoPrecaucion(punto, distanciaMencion) {
  const sustantivos = {
    escaleras: 'escaleras',
    rampa: 'una rampa',
    escalon: 'un escalón',
  };
  const cosa = sustantivos[punto.tipo] || punto.nombre;
  return `Cuidado: hay ${cosa} ${distanciaMencion}. Ten cuidado para no lastimarte.`;
}