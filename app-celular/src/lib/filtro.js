// Filtro de Kalman 2D para suavizar el GPS en tiempo real.
// Portado del motor de rastreo de la app de mapeo (static/motor_tracking.js).
// Estado = [x, y, vx, vy] en metros (origen local) y metros/segundo.
// Tambien calcula la direccion de caminata (bearing) sobre la posicion
// suavizada, que es la que usamos para guiar ("gira a la derecha").

function identidad(n) {
  const M = [];
  for (let i = 0; i < n; i++) {
    M[i] = [];
    for (let j = 0; j < n; j++) M[i][j] = i === j ? 1 : 0;
  }
  return M;
}
function multiplicar(A, B) {
  const n = A.length; const m = B[0].length; const k = B.length;
  const C = [];
  for (let i = 0; i < n; i++) {
    C[i] = [];
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let x = 0; x < k; x++) s += A[i][x] * B[x][j];
      C[i][j] = s;
    }
  }
  return C;
}
function transpuesta(A) {
  const n = A.length; const m = A[0].length; const T = [];
  for (let j = 0; j < m; j++) {
    T[j] = [];
    for (let i = 0; i < n; i++) T[j][i] = A[i][j];
  }
  return T;
}
function sumar(A, B) { return A.map((f, i) => f.map((v, j) => v + B[i][j])); }
function restar(A, B) { return A.map((f, i) => f.map((v, j) => v - B[i][j])); }
function escalar(A, s) { return A.map(f => f.map(v => v * s)); }
function inv2x2(M) {
  const a = M[0][0]; const b = M[0][1]; const c = M[1][0]; const d = M[1][1];
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return [[0, 0], [0, 0]];
  const id = 1 / det;
  return [[d * id, -b * id], [-c * id, a * id]];
}

const R = 6371000;
function aMetros(lat, lng, lat0, lng0) {
  const x = (lng - lng0) * Math.PI / 180 * R * Math.cos(lat0 * Math.PI / 180);
  const y = (lat - lat0) * Math.PI / 180 * R;
  return [x, y];
}
function aLatLng(x, y, lat0, lng0) {
  const lat = lat0 + (y / R) * 180 / Math.PI;
  const lng = lng0 + (x / (R * Math.cos(lat0 * Math.PI / 180))) * 180 / Math.PI;
  return [lat, lng];
}
function distanciaMetros(lat1, lng1, lat2, lng2) {
  const aL = lat1 * Math.PI / 180; const bL = lat2 * Math.PI / 180;
  const dL = (lat2 - lat1) * Math.PI / 180; const dG = (lng2 - lng1) * Math.PI / 180;
  const h = Math.sin(dL / 2) ** 2 + Math.cos(aL) * Math.cos(bL) * Math.sin(dG / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const CFG = {
  PICO_MS: 8,          // >8 m/s es un pico imposible caminando
  PICO_DIST_M: 20,     // salto >20m en UNA lectura = pico
  VELOCIDAD_SUAVE: 3,  // velocidad sospechosa
};

export default class FiltroGPS {
  constructor() {
    this.reiniciar();
  }

  reiniciar() {
    this.x = [0, 0, 0, 0];
    this.P = escalar(identidad(4), 100);
    this.origen = null;
    this.ultimoPunto = null;
    this.ultimoTiempo = null;
    this.picos = 0;
    this.bearing = null;
    this.precision = 8;
  }

  // Procesa una lectura cruda GPS y devuelve la posicion suavizada + bearing.
  // Devuelve { lat, lng, precision, esPico, bearing, velocidad }
  procesar(lat, lng, precision, ahoraMs) {
    const ahora = ahoraMs || Date.now();
    const prec = precision || 8;
    this.precision = prec;

    if (this.origen === null) {
      this.origen = [lat, lng];
      this.ultimoPunto = [lat, lng];
      this.ultimoTiempo = ahora;
      return { lat, lng, precision: prec, esPico: false, bearing: null, velocidad: 0 };
    }

    const dt = (ahora - this.ultimoTiempo) / 1000;
    const distRaw = distanciaMetros(this.ultimoPunto[0], this.ultimoPunto[1], lat, lng);
    const velocidad = dt > 0 ? distRaw / dt : 0;

    // Rechazo DURO de picos: salto imposible.
    if ((velocidad > CFG.PICO_MS || distRaw > CFG.PICO_DIST_M) && prec < 30) {
      this.picos += 1;
      return {
        lat: this.ultimoPunto[0], lng: this.ultimoPunto[1],
        precision: prec, esPico: true, bearing: this.bearing, velocidad: 0,
      };
    }

    const [mx, my] = aMetros(lat, lng, this.origen[0], this.origen[1]);
    this.predecir(Math.max(dt, 0.001));
    let precEfectiva = prec;
    if (velocidad > CFG.VELOCIDAD_SUAVE || prec > 8) precEfectiva = prec * 1.8;
    this.corregir(mx, my, precEfectiva);

    const [flat, flng] = aLatLng(this.x[0], this.x[1], this.origen[0], this.origen[1]);

    // Bearing: direccion del desplazamiento suavizado (0=N, 90=E). Se ignora
    // el micro-movimiento (ruido de GPS parado).
    if (this.ultimoPunto) {
      const d = distanciaMetros(this.ultimoPunto[0], this.ultimoPunto[1], flat, flng);
      if (d > 0.3) {
        const [lx, ly] = aMetros(this.ultimoPunto[0], this.ultimoPunto[1], this.origen[0], this.origen[1]);
        const dx = this.x[0] - lx;
        const dy = this.x[1] - ly;
        this.bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
      }
    }

    this.ultimoPunto = [flat, flng];
    this.ultimoTiempo = ahora;
    return { lat: flat, lng: flng, precision: prec, esPico: false, bearing: this.bearing, velocidad };
  }

  predecir(dt) {
    if (dt > 5) dt = 5;
    const F = [[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]];
    const x = this.x;
    this.x = [x[0] + dt * x[2], x[1] + dt * x[3], x[2], x[3]];
    const q = 0.25;
    const dt2 = dt * dt; const dt3 = dt2 * dt;
    const Q = [
      [dt3 / 3 * q, 0, dt2 / 2 * q, 0],
      [0, dt3 / 3 * q, 0, dt2 / 2 * q],
      [dt2 / 2 * q, 0, dt * q, 0],
      [0, dt2 / 2 * q, 0, dt * q],
    ];
    this.P = sumar(multiplicar(multiplicar(F, this.P), transpuesta(F)), Q);
  }

  corregir(mx, my, precision) {
    const H = [[1, 0, 0, 0], [0, 1, 0, 0]];
    let r = Math.max(precision || 5, 4);
    const yRes = [mx - this.x[0], my - this.x[1]];
    const innov = Math.hypot(yRes[0], yRes[1]);
    if (innov > 2 * r) r = Math.max(r, innov);
    const Rm = [[r * r, 0], [0, r * r]];
    const S = sumar(multiplicar(multiplicar(H, this.P), transpuesta(H)), Rm);
    const K = multiplicar(multiplicar(this.P, transpuesta(H)), inv2x2(S));
    for (let i = 0; i < 4; i++) {
      this.x[i] += K[i][0] * yRes[0] + K[i][1] * yRes[1];
    }
    const KH = multiplicar(K, H);
    this.P = multiplicar(restar(identidad(4), KH), this.P);
  }
}