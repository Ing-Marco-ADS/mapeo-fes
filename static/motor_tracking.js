// ============================================================
// MOTOR DE RASTREO INTELIGENTE (MotorTracking)
// - Filtro de Kalman 2D con modelo de velocidad constante
// - Deteccion de picos con compuerta de velocidad
// - Maquina de estados con histeresis: camino / libre / buscando
// - Geometria: desviacion maxima de un camino encajado vs GPS crudo
//
// Es un modulo puro (sin DOM, sin fetch) para poder probarlo por separado.
// Se expone como variable global `MotorTracking`.
// ============================================================
const MotorTracking = (function () {
    'use strict';

    // ---------------- Utilidades de matrices ----------------
    function identidad(n) {
        const M = [];
        for (let i = 0; i < n; i++) {
            M[i] = [];
            for (let j = 0; j < n; j++) M[i][j] = (i === j) ? 1 : 0;
        }
        return M;
    }
    function multiplicar(A, B) {
        const n = A.length, m = B[0].length, k = B.length;
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
        const n = A.length, m = A[0].length, T = [];
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
        const a = M[0][0], b = M[0][1], c = M[1][0], d = M[1][1];
        const det = a * d - b * c;
        if (Math.abs(det) < 1e-12) return [[0, 0], [0, 0]];
        const id = 1 / det;
        return [[d * id, -b * id], [-c * id, a * id]];
    }

    // ---------------- Geometria (en metros con proyeccion local) ----------------
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
        const aL = lat1 * Math.PI / 180, bL = lat2 * Math.PI / 180;
        const dL = (lat2 - lat1) * Math.PI / 180, dG = (lng2 - lng1) * Math.PI / 180;
        const h = Math.sin(dL / 2) ** 2 + Math.cos(aL) * Math.cos(bL) * Math.sin(dG / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }
    // Distancia perpendicular de un punto p a un segmento a-b (todos [lat,lng])
    function distanciaPuntoSegmento(p, a, b) {
        const [bx, by] = aMetros(b[0], b[1], a[0], a[1]);
        const [px, py] = aMetros(p[0], p[1], a[0], a[1]);
        const dx = bx, dy = by;
        const l2 = dx * dx + dy * dy;
        if (l2 === 0) return Math.hypot(px, py);
        let t = (px * dx + py * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - t * dx, py - t * dy);
    }
    // Desviacion maxima (metros) entre una geometria y el segmento crudo a-b
    function desviacionMaxima(geometria, a, b) {
        let max = 0;
        for (let i = 0; i < geometria.length; i++) {
            const d = distanciaPuntoSegmento(geometria[i], a, b);
            if (d > max) max = d;
        }
        return max;
    }

    // ---------------- Filtro de Kalman 2D (velocidad constante) ----------------
    function FiltroKalman() {
        this.reiniciar();
    }
    FiltroKalman.prototype.reiniciar = function () {
        this.x = [0, 0, 0, 0];          // [x, y, vx, vy] en metros
        this.P = escalar(identidad(4), 100);
        this.ultimoT = null;
    };
    FiltroKalman.prototype.predecir = function (dt) {
        if (!(dt > 0)) dt = 0.001;
        if (dt > 5) dt = 5;             // no predecir saltos enormes de tiempo
        const F = [[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]];
        const x = this.x;
        this.x = [x[0] + dt * x[2], x[1] + dt * x[3], x[2], x[3]];
        // Ruido de proceso: incertidumbre del movimiento (persona caminando)
        const q = 0.5;
        const dt2 = dt * dt, dt3 = dt2 * dt;
        const Q = [
            [dt3 / 3 * q, 0, dt2 / 2 * q, 0],
            [0, dt3 / 3 * q, 0, dt2 / 2 * q],
            [dt2 / 2 * q, 0, dt * q, 0],
            [0, dt2 / 2 * q, 0, dt * q]
        ];
        this.P = sumar(multiplicar(multiplicar(F, this.P), transpuesta(F)), Q);
    };
    FiltroKalman.prototype.corregir = function (mx, my, precision) {
        const H = [[1, 0, 0, 0], [0, 1, 0, 0]];
        const r = Math.max(precision || 5, 2); // varianza de medicion (m^2)
        const Rm = [[r * r, 0], [0, r * r]];
        const yRes = [mx - this.x[0], my - this.x[1]];
        const S = sumar(multiplicar(multiplicar(H, this.P), transpuesta(H)), Rm);
        const K = multiplicar(multiplicar(this.P, transpuesta(H)), inv2x2(S)); // 4x2
        for (let i = 0; i < 4; i++) {
            this.x[i] += K[i][0] * yRes[0] + K[i][1] * yRes[1];
        }
        const KH = multiplicar(K, H);
        this.P = multiplicar(restar(identidad(4), KH), this.P);
    };

    // ---------------- Motor principal ----------------
    // Configuracion ajustable
    const CFG = {
        VELOCIDAD_PICO_MS: 8,        // >8 m/s (28.8 km/h) es un pico imposible caminando
        VELOCIDAD_SUAVE_MS: 3,       // >3 m/s se considera sospechoso
        DESVIACION_MAX_M: 15,        // encaje valido solo si no se desvia mas de 15m
        BUENAS_PARA_CAMINO: 2,       // snaps buenos consecutivos para declarar "en camino"
        MALAS_PARA_LIBRE: 2,         // fallos consecutivos para declarar "fuera de camino"
        CONFIANZA_INICIAL: 0.5
    };

    function Motor() {
        this.kalman = new FiltroKalman();
        this.estado = 'buscando';        // 'camino' | 'libre' | 'buscando'
        this.confianza = CFG.CONFIANZA_INICIAL;
        this.buenas = 0;
        this.malas = 0;
        this.origen = null;              // [lat, lng] referencia del filtro
        this.ultimoPunto = null;         // ultima posicion filtrada aceptada
        this.ultimoTiempo = null;        // timestamp (ms) de la ultima lectura
        this.picosDescartados = 0;
    }

    Motor.prototype.reiniciar = function () {
        this.kalman.reiniciar();
        this.estado = 'buscando';
        this.confianza = CFG.CONFIANZA_INICIAL;
        this.buenas = 0;
        this.malas = 0;
        this.origen = null;
        this.ultimoPunto = null;
        this.ultimoTiempo = null;
        this.picosDescartados = 0;
    };

    // Procesa una lectura cruda y devuelve la posicion suavizada + metadatos.
    // { lat, lng, estado, confianza, esPico, precision }
    Motor.prototype.procesar = function (lat, lng, precision, ahoraMs) {
        const ahora = ahoraMs || Date.now();
        const prec = precision || 5;

        // Primera lectura: inicializar origen y filtro
        if (this.origen === null) {
            this.origen = [lat, lng];
            this.ultimoPunto = [lat, lng];
            this.ultimoTiempo = ahora;
            return { lat, lng, estado: this.estado, confianza: this.confianza, esPico: false, precision: prec };
        }

        const dt = (ahora - this.ultimoTiempo) / 1000;
        const distRaw = distanciaMetros(this.ultimoPunto[0], this.ultimoPunto[1], lat, lng);
        const velocidad = dt > 0 ? distRaw / dt : 0;

        // Compuerta de picos: descarta saltos imposibles
        if (velocidad > CFG.VELOCIDAD_PICO_MS && prec < 30) {
            this.picosDescartados++;
            return {
                lat: this.ultimoPunto[0], lng: this.ultimoPunto[1],
                estado: this.estado, confianza: this.confianza,
                esPico: true, precision: prec
            };
        }

        // Convertir a metros relativos al origen
        const [mx, my] = aMetros(lat, lng, this.origen[0], this.origen[1]);
        this.kalman.predecir(dt);
        // Si la velocidad fue sospechosa, dar menos confianza a la medicion
        const precEfectiva = (velocidad > CFG.VELOCIDAD_SUAVE_MS) ? prec * 3 : prec;
        this.kalman.corregir(mx, my, precEfectiva);

        const [flat, flng] = aLatLng(this.kalman.x[0], this.kalman.x[1], this.origen[0], this.origen[1]);
        this.ultimoPunto = [flat, flng];
        this.ultimoTiempo = ahora;

        return {
            lat: flat, lng: flng,
            estado: this.estado, confianza: this.confianza,
            esPico: false, precision: prec
        };
    };

    // Evalua un resultado de encaje y actualiza la maquina de estados.
    // snapOk: si GraphHopper devolvio una ruta; desviacion: metros de desviacion maxima.
    // Devuelve true si se debe USAR el camino encajado.
    Motor.prototype.evaluarEncaje = function (snapOk, desviacion) {
        const valido = snapOk && desviacion <= CFG.DESVIACION_MAX_M;
        if (valido) {
            this.buenas++;
            this.malas = 0;
            this.confianza = Math.min(1, this.confianza + 0.25);
            if (this.buenas >= CFG.BUENAS_PARA_CAMINO) this.estado = 'camino';
        } else {
            this.malas++;
            this.buenas = 0;
            this.confianza = Math.max(0, this.confianza - 0.4);
            if (this.malas >= CFG.MALAS_PARA_LIBRE) this.estado = 'libre';
        }
        return valido && this.estado === 'camino';
    };

    // Indica si vale la pena intentar encajar (para no gastar cuota estando libre)
    Motor.prototype.debeIntentarEncaje = function () {
        // En 'camino' o 'buscando' siempre intenta; en 'libre' prueba de vez en
        // cuando (cada 4 fallos) para detectar si volvimos a un sendero mapeado.
        if (this.estado === 'libre') {
            return (this.malas % 4) === 0;
        }
        return true;
    };

    return {
        Motor,
        FiltroKalman,
        geometria: {
            distanciaMetros,
            distanciaPuntoSegmento,
            desviacionMaxima,
            aMetros,
            aLatLng
        },
        CFG
    };
})();

// Exportar para pruebas con Node (si existe module)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MotorTracking;
}
