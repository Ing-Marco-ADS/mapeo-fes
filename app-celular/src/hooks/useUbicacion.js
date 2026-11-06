// Ubicacion y rumbo en tiempo real (contexto global para toda la app).
//
// OBJETIVO: que la navegacion funcione SIEMPRE, aunque la brujula falle.
// Fuentes de direccion, en orden de prioridad:
//   1. Curso de caminata por GPS (direccion real del desplazamiento). No
//      necesita magnetometro y funciona en cualquier telefono mientras caminas.
//   2. Brujula del telefono (DeviceMotion / watchHeadingAsync). Sirve tambien
//      parado, y es la unica que puede dibujar una aguja hacia el norte.
//   3. Si no hay ninguna, la pantalla usa la direccion cardinal del destino.
//
// Si la brujula entrega datos raros, el usuario puede calibrarla a mano
// (apuntar el telefono al norte y pulsar "Calibrar"): se guarda un desfase.
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { DeviceMotion, Magnetometer } from 'expo-sensors';
import FiltroGPS from '../lib/filtro';

const WEB_SONDEO_MS = 1000;       // una lectura fresca por segundo en web
const CURSO_MIN_VEL = 0.6;        // m/s minimos para creerle al curso del GPS
const CURSO_VIGENCIA_MS = 12000;  // el curso del GPS vale 12 s sin refrescarse
const SENSOR_VIGENCIA_MS = 6000;  // la brujula vale 6 s sin refrescarse

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

// ---------- Utilidades de angulos ----------
function cortarAngulo(g) {
  return ((g % 360) + 360) % 360;
}

// Diferencia mas corta entre dos angulos, en el rango -180..180.
function diferenciaCorta(a, b) {
  return ((b - a + 540) % 360) - 180;
}

// Suavizado circular: quita el temblor del sensor sin retrasar los giros
// grandes (que se muestran de inmediato).
function suavizarRumbo(previo, nuevo, factor = 0.35, salto = 40) {
  if (previo == null) return cortarAngulo(nuevo);
  const d = diferenciaCorta(previo, nuevo);
  if (Math.abs(d) > salto) return cortarAngulo(nuevo);
  return cortarAngulo(previo + d * factor);
}

function redondear(n, decimales = 1) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** decimales;
  return Math.round(n * f) / f;
}

// ---------- Declinacion magnetica ----------
// La brujula mide el norte MAGNETICO; el norte verdadero difiere unos grados.
// Se intenta una API gratuita (sin clave) y, si no responde, se usa un valor
// aproximado para la zona de la FES (Ciudad de Mexico, ~4 grados al este).
let declinacionCache = null;
let declinacionPromise = null;

function declinacionAproximada(lat, lng) {
  const enMexico = lat > 14 && lat < 33 && lng > -118 && lng < -86;
  return enMexico ? 4 : 0;
}

async function cargarDeclinacion(lat, lng) {
  if (declinacionCache != null) return declinacionCache;
  if (declinacionPromise) return declinacionPromise;
  declinacionPromise = (async () => {
    try {
      const controlador = new AbortController();
      const temporizador = setTimeout(() => controlador.abort(), 5000);
      const res = await fetch(
        `https://randomapi.dev/api/magnetic-declination?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`,
        { signal: controlador.signal }
      );
      clearTimeout(temporizador);
      const json = res.ok ? await res.json() : null;
      const d = Number(json?.data?.declinationDegrees);
      declinacionCache = Number.isFinite(d) ? d : declinacionAproximada(lat, lng);
    } catch (_e) {
      declinacionCache = declinacionAproximada(lat, lng);
    }
    return declinacionCache;
  })();
  return declinacionPromise;
}

// ---------- Web: interpretar eventos de orientacion ----------
// Devuelve { grados, tipo } o null.
//   'webkit'    -> iOS ya entrega el norte verdadero.
//   'magnetico' -> respecto al norte magnetico (se le suma la declinacion).
//   'relativo'  -> respecto al arranque del giroscopio; se alinea con el GPS.
function brujulaWebGrados(ev) {
  if (typeof ev.webkitCompassHeading === 'number') {
    return { grados: cortarAngulo(ev.webkitCompassHeading), tipo: 'webkit' };
  }
  const a = ev.alpha, b = ev.beta, g = ev.gamma;
  if (a == null || b == null || g == null) return null;
  const tipo = ev.absolute === true ? 'magnetico' : 'relativo';
  let grados;
  if (Math.abs(b) < 15 && Math.abs(g) < 15) {
    grados = cortarAngulo(360 - a); // telefono casi plano
  } else {
    const RAD = Math.PI / 180;
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

// Diagnostico crudo para la pantalla de pruebas (ref, no re-renderiza).
function diagInicial() {
  return {
    gps: { lat: null, lng: null, precision: null, velocidad: null, heading: null, rumbo: null, en: null },
    movimiento: null,
    magnetometro: null,
    location: null,
    curso: null,
  };
}

export function useUbicacion() {
  const [ubica, setUbica] = useState(null); // { lat, lng, precision, velocidad, rumbo, rumboEn, actualizadoEn }
  const [permiso, setPermiso] = useState(null);
  const [error, setError] = useState(null);
  // Brujula: { grados, en }. `en` = cuando llego la ultima lectura.
  const [sensorRumbo, setSensorRumbo] = useState({ grados: null, en: 0 });
  const [magnetica, setMagnetica] = useState(false);
  const [necesitaCalibrar, setNecesitaCalibrar] = useState(false);
  const [calibrado, setCalibrado] = useState(false);
  // Reloj interno: recalcula la vigencia del rumbo cada segundo. Se guarda la
  // hora en el estado (y no se llama Date.now() en el render).
  const [reloj, setReloj] = useState(() => Date.now());

  const activo = useRef(true);
  const filtroRef = useRef(null);
  const webWatchId = useRef(null);
  const webIntervalo = useRef(null);
  const subNativo = useRef(null);
  const subMovimiento = useRef(null);
  const subMagnetometro = useRef(null);
  const subRumboNativo = useRef(null);
  const temporizadorRespaldo = useRef(null);

  // Calibracion manual (grados a sumar a la brujula).
  const offsetRef = useRef(0);
  // Ultima lectura cruda de la brujula (sin calibracion) y su momento.
  const sensorCrudoRef = useRef(null);
  const rumboSuaveRef = useRef(null);
  const ultimoPublicadoRef = useRef(null);
  const hayMagneticaRef = useRef(false);
  // Momento de la ultima lectura del sensor de movimiento (vigilante).
  const ultimoMovimientoRef = useRef(0);

  // Curso de caminata calculado con el GPS.
  const cursoRef = useRef(null);
  const cursoEnRef = useRef(0);

  // Web relativo: desfase aprendido comparando con el rumbo real del GPS.
  const crudoRelativoRef = useRef(null);
  const crudoRelativoMomentoRef = useRef(0);
  const desfaseRef = useRef(null);

  const diagRef = useRef(diagInicial());

  // Publica el rumbo de la brujula solo si cambio de verdad (evita re-renders
  // a 10 Hz, que hacen que la app se sienta lenta).
  const publicarSensor = useCallback((valor, en) => {
    const previo = ultimoPublicadoRef.current;
    if (previo != null && Math.abs(diferenciaCorta(previo, valor)) < 0.7) {
      // Sin cambio real: solo refresca el momento cada ~900 ms.
      setSensorRumbo(s => (s.grados != null && en - s.en < 900 ? s : { ...s, en }));
      return;
    }
    ultimoPublicadoRef.current = valor;
    setSensorRumbo({ grados: valor, en });
  }, []);

  // Aplica una lectura de brujula.
  // opciones.magnetico = true -> sumar declinacion.
  // opciones.relativo   = true -> no marcar como brujula absoluta.
  const aplicarRumbo = useCallback((grados, opciones = {}) => {
    if (!activo.current || grados == null || !Number.isFinite(grados)) return;
    const decl = opciones.magnetico ? (declinacionCache ?? 0) : 0;
    const crudo = cortarAngulo(grados + decl);
    const ahora = Date.now();

    sensorCrudoRef.current = crudo;
    if (!opciones.relativo) {
      hayMagneticaRef.current = true;
      setMagnetica(true);
    }

    const corregido = cortarAngulo(crudo + offsetRef.current);
    const suave = suavizarRumbo(rumboSuaveRef.current, corregido, 0.4, 45);
    rumboSuaveRef.current = suave;

    publicarSensor(suave, ahora);
  }, [publicarSensor]);

  // ---------- Brujula de respaldo: expo-location ----------
  const iniciarRumboLocation = useCallback(async () => {
    if (subRumboNativo.current) return;
    try {
      subRumboNativo.current = await Location.watchHeadingAsync((h) => {
        if (!h) return;
        const verdadero = h.trueHeading;
        const magnetico = h.magHeading;
        diagRef.current.location = {
          verdadero: verdadero != null && verdadero >= 0 ? redondear(verdadero) : null,
          magnetico: magnetico != null && magnetico >= 0 ? redondear(magnetico) : null,
          precision: h.accuracy ?? null,
        };
        if (verdadero != null && verdadero >= 0) {
          aplicarRumbo(verdadero, { fuente: 'location', magnetico: false });
        } else if (magnetico != null && magnetico >= 0) {
          aplicarRumbo(magnetico, { fuente: 'location', magnetico: true });
        }
      });
    } catch (_e) { /* sin brujula de location */ }
  }, [aplicarRumbo]);

  // ---------- Brujula principal en Android: vector de rotacion ----------
  const iniciarMovimiento = useCallback(async () => {
    try {
      DeviceMotion.setUpdateInterval(100);
      subMovimiento.current = DeviceMotion.addListener((m) => {
        const rot = m?.rotation;
        if (!rot || typeof rot.alpha !== 'number') return;
        ultimoMovimientoRef.current = Date.now();
        diagRef.current.movimiento = {
          alpha: redondear((rot.alpha * 180) / Math.PI),
          beta: redondear((rot.beta * 180) / Math.PI),
          gamma: redondear((rot.gamma * 180) / Math.PI),
        };
        // Expo Android ya invierte el azimut de Android (que crece hacia el
        // este), asi que el rumbo brújula es -alpha. 0 = norte, 90 = este.
        const rumbo = cortarAngulo((-rot.alpha * 180) / Math.PI);
        aplicarRumbo(rumbo, { fuente: 'movimiento', magnetico: true });
      });

      // Magnetometro crudo: solo para la pantalla de diagnostico.
      try {
        Magnetometer.setUpdateInterval(500);
        subMagnetometro.current = Magnetometer.addListener(({ x, y, z }) => {
          diagRef.current.magnetometro = { x: redondear(x), y: redondear(y), z: redondear(z) };
        });
      } catch (_e) { /* opcional */ }

      // Vigilante: si el sensor de movimiento nunca responde o deja de
      // responder, se activa en paralelo la brujula de expo-location.
      if (temporizadorRespaldo.current) clearInterval(temporizadorRespaldo.current);
      temporizadorRespaldo.current = setInterval(() => {
        if (ultimoMovimientoRef.current && Date.now() - ultimoMovimientoRef.current < 8000) return;
        iniciarRumboLocation();
      }, 5000);
      return true;
    } catch (_e) {
      return false;
    }
  }, [aplicarRumbo, iniciarRumboLocation]);

  // ---------- Lecturas de GPS ----------
  const aplicarLectura = useCallback((lat, lng, precision, heading, velocidad) => {
    if (!activo.current) return;
    if (!filtroRef.current) filtroRef.current = new FiltroGPS();
    const ahora = Date.now();
    const r = filtroRef.current.procesar(lat, lng, precision, ahora);

    // Declinacion (una sola vez por sesion; no bloquea).
    cargarDeclinacion(lat, lng);

    // Curso de caminata: direccion del vector velocidad del filtro Kalman.
    const vx = r.vx || 0;
    const vy = r.vy || 0;
    const velEstimada = Math.hypot(vx, vy);
    const velocidadReal = velocidad ?? r.velocidad ?? null;

    let rumboCaminata = null;
    let rumboEn = null;

    if (velEstimada >= CURSO_MIN_VEL) {
      const bruto = cortarAngulo((Math.atan2(vx, vy) * 180) / Math.PI);
      cursoRef.current = suavizarRumbo(cursoRef.current, bruto, 0.45, 55);
      cursoEnRef.current = ahora;
    } else if (heading != null && heading >= 0 && velocidadReal != null && velocidadReal >= CURSO_MIN_VEL) {
      // Respaldo: el rumbo que reporta el propio GPS al caminar.
      cursoRef.current = suavizarRumbo(cursoRef.current, cortarAngulo(heading), 0.3, 45);
      cursoEnRef.current = ahora;
    }

    if (cursoRef.current != null && ahora - cursoEnRef.current <= CURSO_VIGENCIA_MS) {
      rumboCaminata = cursoRef.current;
      rumboEn = cursoEnRef.current;
    }

    diagRef.current.gps = {
      lat: redondear(r.lat, 6),
      lng: redondear(r.lng, 6),
      precision: redondear(r.precision),
      velocidad: redondear(velocidadReal, 2),
      heading: heading == null ? null : redondear(heading),
      rumbo: rumboCaminata == null ? null : redondear(rumboCaminata),
      en: ahora,
    };
    diagRef.current.curso = {
      estimada: redondear(velEstimada, 2),
      grados: rumboCaminata == null ? null : redondear(rumboCaminata),
      edadMs: rumboEn == null ? null : ahora - rumboEn,
    };

    // Web con sensor "relativo": aprender el desfase contra el GPS real.
    if (Platform.OS === 'web' &&
        !hayMagneticaRef.current &&
        rumboCaminata != null &&
        crudoRelativoRef.current != null &&
        ahora - crudoRelativoMomentoRef.current < 3000) {
      const deseado = cortarAngulo(rumboCaminata - crudoRelativoRef.current);
      if (desfaseRef.current == null) desfaseRef.current = deseado;
      else {
        const diff = diferenciaCorta(desfaseRef.current, deseado);
        desfaseRef.current = cortarAngulo(desfaseRef.current + diff * 0.3);
      }
    }

    setUbica(prev => ({
      lat: r.esPico ? (prev?.lat ?? lat) : r.lat,
      lng: r.esPico ? (prev?.lng ?? lng) : r.lng,
      precision: r.precision ?? null,
      velocidad: velocidadReal,
      rumbo: rumboCaminata,
      rumboEn,
      actualizadoEn: ahora,
    }));
    setPermiso(p => (p === 'granted' ? p : 'granted'));
  }, []);

  // ---------- Web: sondeo directo del navegador ----------
  const iniciarWeb = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setTimeout(() => setError('Tu navegador no tiene geolocalizacion disponible.'), 0);
      return;
    }
    const opciones = { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 };
    const onPos = (pos) => {
      const c = pos.coords;
      aplicarLectura(c.latitude, c.longitude, c.accuracy, c.heading ?? null, c.speed ?? null);
    };
    const onErr = () => { /* sin señal todavia */ };

    navigator.geolocation.getCurrentPosition(onPos, onErr, opciones);
    try {
      webWatchId.current = navigator.geolocation.watchPosition(onPos, onErr, opciones);
    } catch (_e) { /* watchPosition opcional */ }

    webIntervalo.current = setInterval(() => {
      if (!activo.current) return;
      navigator.geolocation.getCurrentPosition(onPos, onErr, { ...opciones });
    }, WEB_SONDEO_MS);
  }, [aplicarLectura]);

  // ---------- Android/iOS ----------
  const iniciarNativo = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setPermiso(status);

    // La brujula se activa aparte del GPS.
    if (Platform.OS === 'android') {
      const ok = await iniciarMovimiento();
      if (!ok) iniciarRumboLocation();
    } else if (status === 'granted') {
      iniciarRumboLocation();
    }

    if (status !== 'granted') {
      setError('Sin permiso de ubicacion. Activalo en Ajustes > Aplicaciones > Mapeo FES > Permisos.');
      return;
    }

    try {
      const servicios = await Location.hasServicesEnabledAsync();
      if (!servicios) {
        setError('El GPS del telefono esta apagado. Enciendelo en los ajustes rapidos.');
      }
    } catch (_e) { /* opcional */ }

    // 1) PRIMERO el seguimiento continuo. Antes se esperaba una lectura
    //    unica con "BestForNavigation", que en interiores puede tardar
    //    minutos o no llegar nunca, y dejaba la app sin GPS para siempre.
    subNativo.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
      (loc) => {
        const c = loc.coords;
        aplicarLectura(c.latitude, c.longitude, c.accuracy, c.heading ?? null, c.speed ?? null);
      },
      (razon) => setError(typeof razon === 'string' ? razon : 'Fallo el GPS')
    );

    // 2) Ademas, un intento de posicion inmediata que NO bloquea el arranque.
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      .then((una) => {
        if (una?.coords && activo.current) {
          const c = una.coords;
          aplicarLectura(c.latitude, c.longitude, c.accuracy, c.heading ?? null, c.speed ?? null);
        }
      })
      .catch(() => { /* la lectura continua ya esta trabajando */ });
  }, [aplicarLectura, iniciarMovimiento, iniciarRumboLocation]);

  // Reloj interno: permite que la "vigencia" del rumbo caduque sola.
  useEffect(() => {
    const t = setInterval(() => setReloj(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Arranque y limpieza.
  useEffect(() => {
    activo.current = true;
    let limpiarBrujula = null;

    const t = setTimeout(() => {
      if (!activo.current) return;
      if (Platform.OS === 'web') iniciarWeb();
      else iniciarNativo();
    }, 0);

    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      const onOrientar = (ev) => {
        const leido = brujulaWebGrados(ev);
        if (leido == null) return;
        const ahora = Date.now();

        if (leido.tipo === 'relativo') {
          crudoRelativoRef.current = leido.grados;
          crudoRelativoMomentoRef.current = ahora;
          const grados = cortarAngulo(leido.grados + (desfaseRef.current ?? 0));
          aplicarRumbo(grados, { fuente: 'web-relativo', relativo: true });
        } else {
          aplicarRumbo(leido.grados, {
            fuente: 'web-' + leido.tipo,
            magnetico: leido.tipo === 'magnetico',
          });
        }
      };
      const onCalibrar = (ev) => {
        ev.preventDefault();
        setNecesitaCalibrar(true);
      };
      window.addEventListener('deviceorientation', onOrientar, true);
      window.addEventListener('deviceorientationabsolute', onOrientar, true);
      window.addEventListener('compassneedscalibration', onCalibrar, true);
      limpiarBrujula = () => {
        window.removeEventListener('deviceorientation', onOrientar, true);
        window.removeEventListener('deviceorientationabsolute', onOrientar, true);
        window.removeEventListener('compassneedscalibration', onCalibrar, true);
        crudoRelativoRef.current = null;
      };
    }

    return () => {
      activo.current = false;
      clearTimeout(t);
      if (Platform.OS === 'web') {
        if (webWatchId.current != null && typeof navigator !== 'undefined' && navigator.geolocation) {
          navigator.geolocation.clearWatch(webWatchId.current);
        }
        if (webIntervalo.current) clearInterval(webIntervalo.current);
      } else {
        subNativo.current?.remove();
        subMovimiento.current?.remove();
        subMagnetometro.current?.remove();
        subRumboNativo.current?.remove();
      }
      if (temporizadorRespaldo.current) clearInterval(temporizadorRespaldo.current);
      if (limpiarBrujula) limpiarBrujula();
    };
  }, [iniciarWeb, iniciarNativo, aplicarRumbo]);

  // ---------- Calibracion manual ----------
  const calibrarNorte = useCallback(() => {
    const crudo = sensorCrudoRef.current;
    if (crudo == null) return false;
    offsetRef.current = cortarAngulo(-crudo);
    rumboSuaveRef.current = 0;
    ultimoPublicadoRef.current = null;
    setSensorRumbo({ grados: 0, en: Date.now() });
    setCalibrado(true);
    return true;
  }, []);

  const restablecerCalibracion = useCallback(() => {
    offsetRef.current = 0;
    rumboSuaveRef.current = null;
    ultimoPublicadoRef.current = null;
    setCalibrado(false);
  }, []);

  const pedirPermisos = useCallback(async () => {
    if (Platform.OS === 'web') {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return false;
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

  // ---------- Valores derivados (se recalculan cada segundo) ----------
  const ahora = reloj;
  const rumboGPS = ubica?.rumbo != null && ubica?.rumboEn != null &&
    ahora - ubica.rumboEn <= CURSO_VIGENCIA_MS
    ? ubica.rumbo
    : null;
  const rumboSensor = sensorRumbo.grados != null &&
    sensorRumbo.en > 0 &&
    ahora - sensorRumbo.en <= SENSOR_VIGENCIA_MS
    ? sensorRumbo.grados
    : null;

  // Referencia para decir "a tu derecha": mientras caminas manda el GPS
  // (siempre funciona); parado manda la brujula.
  const rumboReferencia = rumboGPS ?? rumboSensor;
  const fuenteRumbo = rumboGPS != null ? 'gps' : (rumboSensor != null ? 'brujula' : null);

  const leerDiagnostico = useCallback(() => {
    const d = diagRef.current;
    return {
      plataforma: Platform.OS,
      permiso,
      gps: { ...d.gps },
      curso: d.curso ? { ...d.curso } : null,
      movimiento: d.movimiento ? { ...d.movimiento } : null,
      magnetometro: d.magnetometro ? { ...d.magnetometro } : null,
      location: d.location ? { ...d.location } : null,
      sensor: {
        grados: sensorRumbo.grados == null ? null : redondear(sensorRumbo.grados),
        edadMs: sensorRumbo.en ? Date.now() - sensorRumbo.en : null,
      },
      referencia: { grados: rumboReferencia == null ? null : redondear(rumboReferencia), fuente: fuenteRumbo },
      calibracion: redondear(offsetRef.current),
      magnetica,
    };
  }, [permiso, sensorRumbo, rumboReferencia, fuenteRumbo, magnetica]);

  return {
    ubica,
    rumboSensor,
    rumboReferencia,
    fuenteRumbo,
    rumboPantalla: rumboSensor, // compatibilidad con pantallas anteriores
    permiso,
    error,
    pedirPermisos,
    magnetica,
    necesitaCalibrar,
    calibrado,
    calibrarNorte,
    restablecerCalibracion,
    leerDiagnostico,
  };
}
