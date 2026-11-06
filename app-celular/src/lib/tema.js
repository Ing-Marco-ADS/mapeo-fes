// Sistema de diseno de Mapeo FES.
// Un solo lugar para colores, sombras y medidas: asi todas las pantallas
// se ven consistentes y es facil ajustar el estilo despues.

export const C = {
  // Azules de la institucion
  navy: '#0B2C4D',
  navySuave: '#123E66',
  azul: '#1D6FB8',
  azulBrillante: '#2F80ED',
  azulClaro: '#E8F1FB',
  azulBorde: '#C9DDF2',

  // Verdes para acciones principales y "todo bien"
  verde: '#0E9F6E',
  verdeOscuro: '#047857',
  verdeClaro: '#E3F8EF',

  // Avisos
  ambar: '#D97706',
  ambarClaro: '#FEF3C7',
  rojo: '#DC2626',
  rojoClaro: '#FEE2E2',

  // Neutros
  fondo: '#F4F7FB',
  tarjeta: '#FFFFFF',
  texto: '#0F172A',
  textoMedio: '#334155',
  textoSuave: '#64748B',
  borde: '#E2E8F0',
  linea: '#EEF2F7',
  blanco: '#FFFFFF',
  negroSuave: '#0A1B2E',
};

// Sombra estandar para tarjetas flotantes.
export const SOMBRA = {
  shadowColor: '#0B2C4D',
  shadowOpacity: 0.14,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 8 },
  elevation: 7,
};

// Sombra ligera para listas y tarjetas internas.
export const SOMBRA_SUAVE = {
  shadowColor: '#0B2C4D',
  shadowOpacity: 0.07,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 3 },
  elevation: 3,
};

export const R = {
  s: 10,
  m: 14,
  l: 20,
  xl: 28,
  redondo: 999,
};

export const E = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 20,
  xxl: 28,
};
