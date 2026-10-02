// Hook de precauciones: vigila en que momento el usuario se acerca
// a un obstaculo (escaleras, rampas, escalones) y lo avisa por voz
// para que tenga cuidado. Usa cooldown para no repetir cada segundo.
import { useEffect, useRef } from 'react';
import { hablar } from '../lib/voz';
import { distanciaMetros, textoDistancia } from '../lib/geo';
import { esPrecaucion, RADIO_PRECAUCION_M, textoPrecaucion } from '../lib/categorias';

const COOLDOWN_MS = 45_000; // no avisar del mismo punto antes de 45 seg

export function usePrecauciones({ ubica, puntos, activo = true }) {
  const ultimoAviso = useRef(new Map()); // id del punto -> timestamp

  useEffect(() => {
    if (!activo || !ubica) return;
    const ahora = Date.now();
    const avisables = (puntos || []).filter(esPrecaucion);

    const masCercanos = avisables
      .map(p => ({ p, d: distanciaMetros(ubica.lat, ubica.lng, p.lat, p.lng) }))
      .filter(x => x.d <= RADIO_PRECAUCION_M)
      .sort((a, b) => a.d - b.d);

    for (const { p, d } of masCercanos) {
      const previo = ultimoAviso.current.get(p.id) || 0;
      if (ahora - previo >= COOLDOWN_MS) {
        ultimoAviso.current.set(p.id, ahora);
        hablar(textoPrecaucion(p, textoDistancia(d)));
      }
    }
  }, [ubica, puntos, activo]);
}