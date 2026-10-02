// Componente de mapa para WEB: react-native-maps no existe en web,
// por eso aqui usamos Leaflet + OpenStreetMap con DOM real.
import { useEffect, useRef } from 'react';

const CDN = {
  css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
};

const CENTRO = [19.4752, -99.046];

// Carga Leaflet una sola vez desde CDN y resuelve con la variable global L
let cargandoLeaflet = null;
function obtenerLeaflet() {
  if (typeof window !== 'undefined' && window.L) return Promise.resolve(window.L);
  if (cargandoLeaflet) return cargandoLeaflet;
  cargandoLeaflet = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CDN.css;
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = CDN.js;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error('no se pudo cargar Leaflet'));
    document.head.appendChild(script);
  });
  return cargandoLeaflet;
}

export default function Mapa({ puntos, ubica, alSeleccionarPunto }) {
  const contenedorRef = useRef(null);   // el <div> donde crece el mapa
  const mapaRef = useRef(null);         // instancia L.map
  const marcadorRef = useRef(null);     // marcador de mi ubicacion
  const puntosRef = useRef(null);       // congunto de marcadores de puntos

  // 1) Crear el mapa una sola vez
  useEffect(() => {
    let activo = true;
    obtenerLeaflet().then(L => {
      if (!activo || !contenedorRef.current || mapaRef.current) return;
      const mapa = L.map(contenedorRef.current).setView(CENTRO, 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(mapa);
      mapaRef.current = mapa;

      // Leaflet necesita recalcular el tamano despues de montarse
      setTimeout(() => mapa.invalidateSize(), 120);
    });
    return () => {
      activo = false;
      if (mapaRef.current) {
        mapaRef.current.remove();
        mapaRef.current = null;
      }
    };
  }, []);

  // 2) Dibujar/actualizar los puntos de interes
  useEffect(() => {
    const L = window.L;
    const mapa = mapaRef.current;
    if (!L || !mapa) return;

    if (puntosRef.current) {
      puntosRef.current.remove();
    }
    puntosRef.current = L.layerGroup().addTo(mapa);

    puntos.forEach(p => {
      const marcador = L.circleMarker([p.lat, p.lng], {
        radius: 8,
        color: '#1f2937',
        weight: 1,
        fillColor: p.color || '#78909c',
        fillOpacity: 0.9,
      })
        .bindPopup(`<b>${p.nombre}</b><br/>${p.tipoNombre}`)
        .addTo(puntosRef.current);
      if (alSeleccionarPunto) {
        marcador.on('click', () => alSeleccionarPunto(p));
      }
    });
  }, [puntos, alSeleccionarPunto]);

  // 3) Actualizar mi ubicacion en vivo
  useEffect(() => {
    const L = window.L;
    const mapa = mapaRef.current;
    if (!L || !mapa) return;

    if (marcadorRef.current) {
      mapa.removeLayer(marcadorRef.current);
      marcadorRef.current = null;
    }
    if (ubica) {
      const grupo = L.layerGroup().addTo(mapa);
      if (ubica.precision) {
        L.circle([ubica.lat, ubica.lng], {
          radius: ubica.precision,
          color: '#2563eb',
          weight: 1,
          fillColor: '#2563eb',
          fillOpacity: 0.12,
        }).addTo(grupo);
      }
      L.marker([ubica.lat, ubica.lng], {
        icon: L.divIcon({
          className: 'mapa-fes-ubicacion',
          html: '<div style="width:20px;height:20px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 6px #00000055"></div>',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      }).addTo(grupo);
      marcadorRef.current = grupo;
      mapa.panTo([ubica.lat, ubica.lng]);
    }
  }, [ubica]);

  return <div ref={contenedorRef} style={{ flex: 1, minHeight: 300, backgroundColor: '#e5e7eb' }} />;
}