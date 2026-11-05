// Ubicación en tiempo real (contexto global para toda la app).
// - En web usa navigator.geolocation DIRECTAMENTE (alta precision,
//   maximumAge 0, sondeo cada 1s): el watchPosition de los navegadores
//   moviles no puede forzar lecturas frescas seguidas.
// - En Android/iOS usa expo-location (watchPositionAsync + brújula).
// - Toda lectura pasa por un filtro Kalman 2D (src/lib/filtro.js)
//   que quita el ruido del GPS y calcula la direccion real de caminata.
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import FiltroGPS from '../lib/filtro';

const WEB_SONDEO_MS = 1000; // una lectura fresca por segundo en web

const Contexto = createContext(null);

export function UbicacionProvider({ children }) {
  const ubicacion = useUbicacion();
  return <Contexto.Provider value={ubicacion}>{children}</Contexto.Provider>;
}

export function useUbicacionGlobal() {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useUbicacionGlobal debe usarse dentro de UbicacionProvider');
  return ctx;
}

const RAD = Math.PI / 180;

function cortarAngulo(g) {
  return ((g % 360) + 360) % 360;
}

// Suavizado circular del rumbo: evita que la aguja "vibre" con el ruido del
// sensor. Los giros grandes y reales (>40 grados) se muestran de inmediato.
function suavizarRumbo(previo, nuevo) {
  if (previo == null) return nuevo;
  let d = ((nuevo - previo + 540) % 360) - 180; // diferencia mas corta, -180..180
  if (Math.abs(d) > 40) return nuevo;
  return cortarAngulo(previo + d * 0.35);
}

// ---------- Declinacion magnetica (API gratuita sin clave) --------------
// La brujula de Android mide el NORTE MAGNETICO; el norte verdadero difiere
// unos grados segun el lugar. Se ajusta llamando una vez por sesion a la API
// gratuita randomapi.dev (modelo WMM2025, CORS abierto, sin clave).
let declinacionCache = null;   // grados (este positivo); null = todavia sin cargar
let declinacionPromise = null;

async function cargarDeclinacion(lat, lng) {
  if (declinacionCache != null) return declinacionCache;
  if (declinacionPromise) return declinacionPromise;
  declinacionPromise = (async () => {
    try {
      const controlador = new AbortController();
      const temporizador = setTimeout(() => controlador.abort(), 6000);
      const res = await fetch(
        `https://randomapi.dev/api/magnetic-declination?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`,
        { signal: controlador.signal }
      );
      clearTimeout(temporizador);
      const json = res.ok ? await res.json() : null;
      const d = Number(json?.data?.declinationDegrees);
      declinacionCache = Number.isFinite(d) ? d : 0;
    } catch (_e) {
      declinacionCache = 0; // sin internet: se queda con el norte magnetico
    }
    return declinacionCache;
  })();
  return declinacionPromise;
}

// Bearing en grados (0-360) a partir de un evento de orientacion.
// Devuelve { grados, tipo } o null si el evento no trae datos utilizables.
// - tipo 'webkit': iOS entrega ya el norte VERDADERO (webkitCompassHeading).
// - tipo 'magnetico': lectura respecto al norte magnetico (ev.absolute true).
// - tipo 'relativo': lectura respecto al giroscopio/ultimo arranque. Muchos
//   Android (Chrome) solo dan esto. NO se descarta: se alinea despues con la
//   direccion real del GPS mientras caminas, asi la aguja funciona igual.
//   Para angulo: si el telefono esta casi plano se usa (360 - alpha); con
//   inclinacion se aplica la formula oficial del W3C (compensacion de inclinacion).
function brújulaWebGrados(ev) {
  if (typeof ev.webkitCompassHeading === 'number') {
    return { grados: cortarAngulo(ev.webkitCompassHeading), tipo: 'webkit' };
  }
  const a = ev.alpha, b = ev.beta, g = ev.gamma;
  if (a == null || b == null || g == null) return null;
  const tipo = ev.absolute === true ? 'magnetico' : 'relativo';
  let grados;
  if (Math.abs(b) < 15 && Math.abs(g) < 15) {
    grados = cortarAngulo(360 - a); // telefono casi plano: basta girar alpha
  } else {
    const x = b * RAD, y = g * RAD, z = a * RAD;
    const cY = Math.cos(y), cZ = Math.cos(z);
    const sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);
    const Vx = -cZ * sY - sZ * sX * cY;
    const Vy = -sZ * sY + cZ * sX * cY;
    let rumbo = Math.atan(Vx / Vy);
    if (Vy < 0) rumbo += Math.PI;
    else if (Vx < 0) rumbo += 2 * Math.PI;
    rumbo *= 180 / Math.PI;
    grados = cortarAngulo(360 - rumbo);
  }
  return { grados, tipo };
}

const VELOCIDAD_RUMBO_GPS = 0.8; // m/s minimos para usar el rumbo de caminata
const DESFASE_FRESCURA_MS = 2500; // el desfase solo se calcula con lectura reciente

export function useUbicacion() {
  const [ubica, setUbica] = useState(null);   // { lat, lng, precision, velocidad, rumbo, rumboPantalla, actualizadoEn }
  const [permiso, setPermiso] = useState(null);
  const [error, setError] = useState(null);
  // Indica si la brujula llega del sensor magnetico (true) o del rumbo de
  // caminata del GPS (false), y si iOS pide calibrar en ocho.
  const [magnetica, setMagnetica] = useState(false);
  const [necesitaCalibrar, setNecesitaCalibrar] = useState(false);
  // Rumbo del sensor, independiente del GPS: asi la brujula funciona aunque
  // todavia no haya señal de ubicacion (antes se descartaba y la aguja
  // se quedaba fija apuntando hacia arriba).
  const [rumboSensor, setRumboSensor] = useState(null);

  const filtroRef = useRef(null);
  const activo = useRef(true);
  const webWatchId = useRef(null);
  const webIntervalo = useRef(null);
  const subNativo = useRef(null);
  const subRumboNativo = useRef(null);
  // Sensor de movimiento (Android) y control del respaldo.
  const subMovimiento = useRef(null);
  const temporizadorRespaldo = useRef(null);
  const rumboSuaveRef = useRef(null);          // ultimo rumbo ya suavizado
  const ultimoRumboEstadoRef = useRef(null);   // ultimo valor publicado al estado
  // Suavizado de la brujula: guarda la ultima lectura aceptada y su momento.
  const rumboRef = useRef(null);
  const rumboMomentoRef = useRef(0);
  // True cuando el sensor magnetico entrego al menos una lectura real.
  const hayMagneticaRef = useRef(false);
  // Ultima lectura RELATIVA cruda (sin corregir) y cuando paso: sirve para
  // alinear el norte relativo con el rumbo real del GPS mientras caminas.
  const crudoRelativoRef = useRef(null);
  const crudoRelativoMomentoRef = useRef(0);
  const desfaseRef = useRef(null); // grados a sumar a un relativo para apuntar al norte

  // Aplica una lectura de brujula: suaviza y publica el rumbo.
  // Actualiza SIEMPRE `rumboSensor` (funciona sin GPS) y, si ya hay posicion,
  // tambien lo copia dentro de `ubica` para las pantallas de navegacion.
  const aplicarRumbo = useCallback((grados) => {
    if (!activo.current || grados == null || !Number.isFinite(grados)) return;
    const suave = suavizarRumbo(rumboSuaveRef.current, cortarAngulo(grados));
    rumboSuaveRef.current = suave;
    hayMagneticaRef.current = true;
    setMagnetica(true);

    // Publica solo si cambio al menos 1 grado: evita re-renders inutiles.
    const previo = ultimoRumboEstadoRef.current;
    const cambio = previo == null
      ? 180
      : Math.abs(((suave - previo + 540) % 360) - 180);
    if (cambio < 1) return;

    ultimoRumboEstadoRef.current = suave;
    setRumboSensor(suave);
    setUbica(prev => (prev ? { ...prev, rumboPantalla: suave } : prev));
  }, []);

  const aplicarLectura = useCallback((lat, lng, precision, heading, velocidad) => {
    if (!activo.current) return;
    if (!filtroRef.current) filtroRef.current = new FiltroGPS();
    const r = filtroRef.current.procesar(lat, lng, precision, Date.now());
    // Una sola carga por sesion de la declinacion magnetica del lugar.
    // En web se suma al sensor magnetico; en Android la usa DeviceMotion.
    cargarDeclinacion(lat, lng);
    const rumbo = heading ?? r.bearing ?? null;
    const velocidadUsar = velocidad ?? r.velocidad ?? null;

    // Si el sensor solo da lecturas RELATIVAS, mientras caminamos conocemos el
    // rumbo real por el GPS: guardamos el desfase para que la brujula apunte
    // realmente al norte (el rumbo del GPS es ya respecto al norte verdadero).
    if (Platform.OS === 'web' &&
        !hayMagneticaRef.current &&
        rumbo != null &&
        velocidadUsar != null &&
        velocidadUsar >= VELOCIDAD_RUMBO_GPS &&
        crudoRelativoRef.current != null &&
        Date.now() - crudoRelativoMomentoRef.current < DESFASE_FRESCURA_MS) {
      const deseado = cortarAngulo(rumbo - crudoRelativoRef.current);
      if (desfaseRef.current == null) desfaseRef.current = deseado;
      else {
        let diff = deseado - desfaseRef.current;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        desfaseRef.current = cortarAngulo(desfaseRef.current + diff * 0.3); // suaviza
      }
    }

    setUbica(prev => {
      // Respaldo GPS: si el sensor magnetico nunca contesto y estas caminando,
      // se usa la direccion de tu caminata como "rumbo en pantalla".
      let rumboPantalla = prev?.rumboPantalla ?? null;
      if (!hayMagneticaRef.current &&
          rumboPantalla == null &&
          velocidadUsar != null &&
          velocidadUsar >= VELOCIDAD_RUMBO_GPS) {
        rumboPantalla = rumbo;
      }
      return {
        lat: r.esPico ? (prev?.lat ?? lat) : r.lat,
        lng: r.esPico ? (prev?.lng ?? lng) : r.lng,
        precision: r.precision ?? null,
        velocidad: velocidadUsar,
        rumbo,
        rumboPantalla,
        actualizadoEn: Date.now(),
      };
    });
    setPermiso(p => (p === 'granted' ? p : 'granted'));
  }, []);

  // ---------- Web: sondeo directo del navegador ----------
  const iniciarWeb = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      // Diferido para no llamar setState sincrono dentro del efecto.
      setTimeout(() => setError('Tu navegador no tiene geolocalización disponible.'), 0);
      return;
    }
    const opciones = { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 };
    const onPos = (pos) => {
      const c = pos.coords;
      aplicarLectura(c.latitude, c.longitude, c.accuracy, c.heading ?? null, c.speed ?? null);
    };
    const onErr = () => { /* sin señal todavia */ };

    // Primera lectura inmediata (ademas dispara el prompt del navegador)
    navigator.geolocation.getCurrentPosition(onPos, onErr, opciones);
    try {
      webWatchId.current = navigator.geolocation.watchPosition(onPos, onErr, opciones);
    } catch (_e) { /* watchPosition opcional */ }

    // SONDEO FORZADO: una lectura fresca cada segundo. Es lo que garantiza
    // que la distancia y los metros se actualicen en tiempo real.
    webIntervalo.current = setInterval(() => {
      if (!activo.current) return;
      navigator.geolocation.getCurrentPosition(onPos, onErr, { ...opciones });
    }, WEB_SONDEO_MS);
  }, [aplicarLectura]);

  // ---------- Android/iOS: expo-location ----------
  // Respaldo: rumbo con expo-location. En iOS es fiable (trueHeading); en
  // Android solo se usa si DeviceMotion no esta disponible.
  const iniciarRumboLocation = useCallback(async () => {
    if (subRumboNativo.current) return;
    try {
      subRumboNativo.current = await Location.watchHeadingAsync((h) => {
        if (!h) return;
        // trueHeading es norte verdadero; si no esta (-1 en Android), magnetico.
        const g = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
        if (g != null && g >= 0) aplicarRumbo(g);
      });
    } catch (_e) { /* sin brujula de location */ }
  }, [aplicarRumbo]);

  // Principal en Android: vector de rotacion fusionado (acelerometro +
  // giroscopio + magnetometro) via DeviceMotion. Es mucho mas estable que
  // Location.watchHeadingAsync, que "salta" en muchos Android.
  //
  // NO se usa DeviceMotion.isAvailableAsync(): ese metodo exige que existan
  // CINCO sensores a la vez (incluido TYPE_LINEAR_ACCELERATION), y si a un
  // telefono le falta uno devuelve false aunque el vector de rotacion (el que
  // de verdad sirve para la brujula) SI exista. Suscribirse es seguro: Expo
  // ignora los sensores que el equipo no tenga.
  const iniciarMovimiento = useCallback(async () => {
    try {
      DeviceMotion.setUpdateInterval(100);
      let recibio = false;
      subMovimiento.current = DeviceMotion.addListener(({ rotation }) => {
        if (!rotation || typeof rotation.alpha !== 'number') return;
        recibio = true;
        if (temporizadorRespaldo.current) {
          clearTimeout(temporizadorRespaldo.current);
          temporizadorRespaldo.current = null;
        }
        // En Android `alpha` viene en RADIANES y es el azimut negado.
        const magnetico = cortarAngulo((-rotation.alpha * 180) / Math.PI);
        // Suma la declinacion del lugar para apuntar al norte verdadero.
        aplicarRumbo(cortarAngulo(magnetico + (declinacionCache ?? 0)));
      });
      // Si en 4 s no llega ninguna lectura, se apaga este sensor y se activa
      // el respaldo (expo-location / iOS).
      temporizadorRespaldo.current = setTimeout(() => {
        if (recibio) return;
        subMovimiento.current?.remove();
        subMovimiento.current = null;
        iniciarRumboLocation();
      }, 4000);
      return true;
    } catch (_e) {
      return false;
    }
  }, [aplicarRumbo, iniciarRumboLocation]);

  const iniciarNativo = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setPermiso(status);

    // La brujula se activa aparte del GPS: en Android no necesita permiso de
    // ubicacion. Asi la aguja funciona aunque el GPS tarde o no tenga señal.
    if (Platform.OS === 'android') {
      const ok = await iniciarMovimiento();
      if (!ok) iniciarRumboLocation();
    } else if (status === 'granted') {
      iniciarRumboLocation();
    }

    if (status !== 'granted') return;

    try {
      const una = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      if (una?.coords && activo.current) {
        const c = una.coords;
        aplicarLectura(c.latitude, c.longitude, c.accuracy, c.heading ?? null, c.speed ?? null);
      }
    } catch (_e) { /* no pasa nada */ }

    subNativo.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
      (loc) => {
        const c = loc.coords;
        aplicarLectura(c.latitude, c.longitude, c.accuracy, c.heading ?? null, c.speed ?? null);
      },
      (razon) => setError(typeof razon === 'string' ? razon : 'Fallo el GPS')
    );
  }, [aplicarLectura, iniciarMovimiento, iniciarRumboLocation]);

  useEffect(() => {
    activo.current = true;

    let limpiarBrujula = null;

    // La suscripcion al GPS se activa al siguiente tick: asi todos los
    // setState ocurren en callbacks asincronos (patron recomendado por React).
    setTimeout(() => {
      if (!activo.current) return;
      if (Platform.OS === 'web') iniciarWeb();
      else iniciarNativo();
    }, 0);

    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      const onOrientar = (ev) => {
        const leido = brújulaWebGrados(ev);
        if (leido == null) return; // sin datos de orientacion: ignorar

        const ahora = Date.now();

        // Si es relativo, guardamos la lectura cruda para afinarla con el GPS.
        let grados;
        if (leido.tipo === 'webkit') {
          grados = leido.grados; // ya es norte verdadero
          hayMagneticaRef.current = true;
          setMagnetica(true);
        } else if (leido.tipo === 'magnetico') {
          grados = cortarAngulo(leido.grados + (declinacionCache ?? 0)); // a norte verdadero
          hayMagneticaRef.current = true;
          setMagnetica(true);
        } else {
          // relativo: se le suma el desfase aprendido del GPS (si ya existe).
          crudoRelativoRef.current = leido.grados;
          crudoRelativoMomentoRef.current = ahora;
          grados = cortarAngulo(leido.grados + (desfaseRef.current ?? 0));
        }

        const previo = rumboRef.current;
        // Snap ante giros bruscos (>25 grados); suaviza el resto con media
        // movil para que la aguja no vibre.
        let aceptado;
        if (previo == null) {
          aceptado = grados;
        } else {
          let diff = grados - previo;
          if (diff > 180) diff -= 360;
          if (diff < -180) diff += 360;
          aceptado = Math.abs(diff) > 25 ? grados : cortarAngulo(previo + diff * 0.5);
        }
        // Limite de 100 ms entre actualizaciones (los eventos llegan a ~60/s).
        if (aceptado === previo || ahora - rumboMomentoRef.current < 100) return;
        rumboMomentoRef.current = ahora;
        rumboRef.current = aceptado;
        setRumboSensor(cortarAngulo(aceptado));
        setUbica(prev => (prev ? { ...prev, rumboPantalla: cortarAngulo(aceptado) } : prev));
      };
      const onCalibrar = (ev) => {
        ev.preventDefault();
        setNecesitaCalibrar(true);
      };
      // Se escuchan los dos eventos posibles (iOS dispara `deviceorientation`
      // con webkitCompassHeading; Android dispara `deviceorientationabsolute`
      // cuando es absoluto). El filtro de arriba descarta los relativos, asi
      // que ya no compiten entre si.
      window.addEventListener('deviceorientation', onOrientar, true);
      window.addEventListener('deviceorientationabsolute', onOrientar, true);
      window.addEventListener('compassneedscalibration', onCalibrar, true);
      limpiarBrujula = () => {
        window.removeEventListener('deviceorientation', onOrientar, true);
        window.removeEventListener('deviceorientationabsolute', onOrientar, true);
        window.removeEventListener('compassneedscalibration', onCalibrar, true);
        rumboRef.current = null;
        crudoRelativoRef.current = null;
      };
    }

    return () => {
      activo.current = false;
      if (Platform.OS === 'web') {
        if (webWatchId.current != null && navigator.geolocation) {
          navigator.geolocation.clearWatch(webWatchId.current);
        }
        if (webIntervalo.current) clearInterval(webIntervalo.current);
      } else {
        subNativo.current?.remove();
        subRumboNativo.current?.remove();
        subMovimiento.current?.remove();
        if (temporizadorRespaldo.current) clearTimeout(temporizadorRespaldo.current);
      }
      if (limpiarBrujula) limpiarBrujula();
    };
  }, [iniciarWeb, iniciarNativo]);

  const pedirPermisos = useCallback(async () => {
    if (Platform.OS === 'web') {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return false;
      // Permiso de giroscopio (iOS pide autorizacion dentro de un toque).
      try {
        if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
          await DeviceOrientationEvent.requestPermission();
        }
      } catch (_e) { /* ignorar */ }
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => { setPermiso('granted'); resolve(true); },
          (err) => {
            if (err && err.code === 1) { setPermiso('denied'); resolve(false); }
            else { setPermiso('granted'); resolve(true); }
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    setPermiso(status);
    return status === 'granted';
  }, []);

  return { ubica, rumboPantalla: rumboSensor, permiso, error, pedirPermisos, magnetica, necesitaCalibrar };
}