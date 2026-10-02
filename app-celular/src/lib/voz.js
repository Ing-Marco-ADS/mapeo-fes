// Capa de voz (texto-a-voz) con expo-speech.
// Todas las frases importantes de la app pasan por aqui con idioma espanol.
import * as Speech from 'expo-speech';

const OPCIONES = {
  language: 'es-MX',
  pitch: 1,
  rate: 0.95,
};

// Habla un texto. Interrumpe lo que haya en cola para que la guia
// de navegacion nunca se atrase (importante en cruces o cambios de direccion).
export function hablar(texto) {
  if (!texto) return;
  try {
    Speech.stop();
    Speech.speak(texto, OPCIONES);
  } catch (_e) {
    console.warn('error al hablar:', _e);
  }
}

// Solo hace silencio
export function callar() {
  try {
    Speech.stop();
  } catch (_e) {
    console.warn('error al callar:', _e);
  }
}

// Indica si el sintetizador esta hablando ahora mismo
export async function estaHablando() {
  try {
    return await Speech.isSpeakingAsync();
  } catch (_e) {
    return false;
  }
}

// Lista voces en espanol disponibles (diagnostico)
export async function vocesDisponibles() {
  try {
    const voces = await Speech.getAvailableVoicesAsync();
    return voces.filter(v => v.language && v.language.toLowerCase().startsWith('es'));
  } catch (_e) {
    return [];
  }
}