// ============================================================
// MOTOR DE RASTREO INTELIGENTE (MotorTracking)
// ------------------------------------------------------------
// Responsabilidades:
//  1. Suavizar el GPS con un filtro de Kalman 2D (velocidad const.)
//  2. Descartar picos: saltos imposibles caminando (>8 m/s o >20 m)
//  3. Rechazar suavemente saltos medianos (innovacion grande):
//     se amplifica la varianza de medicion para no "saltar" al lerdo.
//  4. Maquina de estados con histeresis: 'buscando' -> 'camino'|'libre'
//  5. Decidir cuando vale la pena gastar cuota de encaje (GraphHopper)
//  6. Medir desviacion de un camino encajado vs el GPS crudo
//
// Es un modulo puro (sin DOM, sin fetch) para poder probarlo en Node.
// Se expone como variable global `MotorTracking`.
//
// NOTA: los comentarios NO llevan acentos a proposito (ASCII puro,
// para no romper nada en la lectura del codigo).
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
    // Inversa de una matriz 2x2 (la usamos con la covarianza de innovacion S)
    function inv2x2(M) {
        const a = M[0][0], b = M[0][1], c = M[1][0], d = M[1][1];
        const det = a * d - b * c;
        if (Math.abs(det) < 1e-12) return [[0, 0], [0, 0]];
        const id = 1 / det;
        return [[d * id, -b * id], [-c * id, a * id]];
    }

    // ---------------- Geometria (proyeccion local en metros) ----------------
    const R = 6371000;

    // Convierte (lat,lng) a (x,y) en metros respecto a un origen cercano (lat0,lng0).
    // Asi el filtro de Kalman trabaja en unidades lineales y estables.
    function aMetros(lat, lng, lat0, lng0) {
        const x = (lng - lng0) * Math.PI / 180 * R * Math.cos(lat0 * Math.PI / 180);
        const y = (lat - lat0) * Math.PI / 180 * R;
        return [x, y];
    }
    // Inverso de aMetros: de metros locales a (lat,lng)
    function aLatLng(x, y, lat0, lng0) {
        const lat = lat0 + (y / R) * 180 / Math.PI;
        const lng = lng0 + (x / (R * Math.cos(lat0 * Math.PI / 180))) * 180 / Math.PI;
        return [lat, lng];
    }
    // Distancia Haversine entre dos puntos (lat,lng) en metros
    function distanciaMetros(lat1, lng1, lat2, lng2) {
        const aL = lat1 * Math.PI / 180, bL = lat2 * Math.PI / 180;
        const dL = (lat2 - lat1) * Math.PI / 180, dG = (lng2 - lng1) * Math.PI / 180;
        const h = Math.sin(dL / 2) ** 2 + Math.cos(aL) * Math.cos(bL) * Math.sin(dG / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }
    // Distancia perpendicular de un punto p a un segmento a-b (todos [lat,lng]).
    // Sirve para saber si el GPS crudo coincide con el camino encajado.
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
    // Desviacion maxima (metros) entre una geometria y el segmento crudo a-b.
    // Si el sendero encajado se aleja del GPS real, la desviacion crece y
    // el motor decide NO usar ese encaje.
    function desviacionMaxima(geometria, a, b) {
        let max = 0;
        for (let i = 0; i < geometria.length; i++) {
            const d = distanciaPuntoSegmento(geometria[i], a, b);
            if (d > max) max = d;
        }
        return max;
    }

    // ---------------- Filtro de Kalman 2D (velocidad constante) ----------------
    // Estado x = [x, y, vx, vy] en metros (origen local) y metros/segundo.
    // P  = covarianza del estado (incertidumbre).
    function FiltroKalman() {
        this.reiniciar();
    }
    FiltroKalman.prototype.reiniciar = function () {
        this.x = [0, 0, 0, 0];          // [x, y, vx, vy]
        this.P = escalar(identidad(4), 100); // covarianza inicial alta: no conocemos nada
        this.ultimoT = null;
    };
    // Paso de prediccion: empuja el estado segun la velocidad acumulada.
    // dt en segundos; se acota para no predecir saltos enormes de tiempo
    // (cuando el celular se queda sin ticks de GPS por unos segundos).
    FiltroKalman.prototype.predecir = function (dt) {
        if (!(dt > 0)) dt = 0.001;
        if (dt > 5) dt = 5;
        const F = [[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]];
        const x = this.x;
        this.x = [x[0] + dt * x[2], x[1] + dt * x[3], x[2], x[3]];
        // Ruido de proceso (incertidumbre del movimiento de una persona caminando).
        // q bajo = el filtro confia en la trayectoria y suaviza mucho el ruido;
        // esto hace la linea mucho mas estable (probado con datos reales).
        const q = 0.25;
        const dt2 = dt * dt, dt3 = dt2 * dt;
        const Q = [
            [dt3 / 3 * q, 0, dt2 / 2 * q, 0],
            [0, dt3 / 3 * q, 0, dt2 / 2 * q],
            [dt2 / 2 * q, 0, dt * q, 0],
            [0, dt2 / 2 * q, 0, dt * q]
        ];
        this.P = sumar(multiplicar(multiplicar(F, this.P), transpuesta(F)), Q);
    };
    // Paso de correccion: fusiona la medicion (mx,my) con el estado predicho.
    // precision = error estimado del GPS en metros.
    FiltroKalman.prototype.corregir = function (mx, my, precision) {
        const H = [[1, 0, 0, 0], [0, 1, 0, 0]];
        // Varianza de medicion: nunca menor a 4m^2 para no sobreconfiar en el GPS.
        let r = Math.max(precision || 5, 4);
        const yRes = [mx - this.x[0], my - this.x[1]];

        // INNOVACION suave: si la medicion se aleja mucho de lo predicho,
        // amplificamos la varianza de medicion. El filtro asi "no salta"
        // ante mid-jumps (5-20 m) que no superan la compuerta dura de picos.
        const innov = Math.hypot(yRes[0], yRes[1]);
        if (innov > 2 * r) {
            // Incertidumbre del tamaño del salto: el punto se aleja despacio.
            r = Math.max(r, innov);
        }

        const Rm = [[r * r, 0], [0, r * r]];
        const S = sumar(multiplicar(multiplicar(H, this.P), transpuesta(H)), Rm);
        const K = multiplicar(multiplicar(this.P, transpuesta(H)), inv2x2(S)); // ganancia 4x2
        for (let i = 0; i < 4; i++) {
            this.x[i] += K[i][0] * yRes[0] + K[i][1] * yRes[1];
        }
        const KH = multiplicar(K, H);
        this.P = multiplicar(restar(identidad(4), KH), this.P);
    };

    // ---------------- Motor principal ----------------
    // Configuracion ajustable (se expone para pruebas y calibracion)
    const CFG = {
        VELOCIDAD_PICO_MS: 8,        // >8 m/s (28.8 km/h) es un pico imposible caminando
        VELOCIDAD_SUAVE_MS: 3,       // >3 m/s se considera sospechoso
        DISTANCIA_PICO_M: 20,        // salto >20m en UNA lectura = pico (aunque la velocidad calcule baja)
        DESVIACION_MAX_M: 15,        // encaje valido solo si no se desvia mas de 15m
        BUENAS_PARA_CAMINO: 2,       // snaps buenos consecutivos para declarar "en camino"
        MALAS_PARA_LIBRE: 2,         // fallos consecutivos para declarar "fuera de camino"
        CONFIANZA_INICIAL: 0.5,
        RECUPERA_LIBRE_CADA: 4       // reintentar encaje cada N tramos cuando estamos "libre"
    };

    function Motor() {
        this.reiniciar();
    }
    Motor.prototype.reiniciar = function () {
        this.kalman = new FiltroKalman();
        this.estado = 'buscando';        // 'camino' | 'libre' | 'buscando'
        this.confianza = CFG.CONFIANZA_INICIAL;
        this.buenas = 0;                 // encajes buenos consecutivos
        this.malas = 0;                  // encajes malos consecutivos
        this.intentosLibre = 0;          // tramos procesados estando "libre" (para reintentar)
        this.origen = null;              // [lat, lng] referencia local del filtro
        this.ultimoPunto = null;         // ultima posicion filtrada aceptada [lat,lng]
        this.ultimoTiempo = null;        // timestamp (ms) de la ultima lectura aceptada
        this.picosDescartados = 0;       // estadisticas (diagnostico)
        this.ultimoBearing = null;       // direccion del movimiento en grados 0-360 (N)
    };

    // Procesa una lectura cruda y devuelve la posicion suavizada + metadatos.
    // Entrada:  lat, lng, precision (m), ahoraMs (timestamp opcional)
    // Salida:   { lat, lng, estado, confianza, esPico, precision, bearing }
    //           - esPico=true: la lectura se descarto (devuelve el ultimo punto valido)
    //           - bearing: direccion del desplazamiento en grados (0=N, 90=E)
    Motor.prototype.procesar = function (lat, lng, precision, ahoraMs) {
        const ahora = ahoraMs || Date.now();
        const prec = precision || 5;

        // Primera lectura: no hay historia, se acepta tal cual como origen.
        if (this.origen === null) {
            this.origen = [lat, lng];
            this.ultimoPunto = [lat, lng];
            this.ultimoTiempo = ahora;
            return { lat, lng, estado: this.estado, confianza: this.confianza, esPico: false, precision: prec, bearing: this.ultimoBearing };
        }

        const dt = (ahora - this.ultimoTiempo) / 1000;
        const distRaw = distanciaMetros(this.ultimoPunto[0], this.ultimoPunto[1], lat, lng);
        const velocidad = dt > 0 ? distRaw / dt : 0;

        // Compuerta de picos (rechazo DURO): descarta saltos imposibles.
        // Se activa por velocidad (>8 m/s) O por distancia (>20m en una sola
        // lectura), porque si el celular salta ticks la velocidad sola engana.
        if ((velocidad > CFG.VELOCIDAD_PICO_MS || distRaw > CFG.DISTANCIA_PICO_M) && prec < 30) {
            this.picosDescartados++;
            return {
                lat: this.ultimoPunto[0], lng: this.ultimoPunto[1],
                estado: this.estado, confianza: this.confianza,
                esPico: true, precision: prec, bearing: this.ultimoBearing
            };
        }

        const [mx, my] = aMetros(lat, lng, this.origen[0], this.origen[1]);
        this.kalman.predecir(dt);

        // Precision efectiva de la medicion:
        // - Si la velocidad fue sospechosa (>3 m/s) -> menos confianza (x1.8)
        // - Si la precision del GPS es mala (>8m) -> menos confianza (x1.8)
        let precEfectiva = prec;
        if (velocidad > CFG.VELOCIDAD_SUAVE_MS || prec > 8) precEfectiva = prec * 1.8;
        this.kalman.corregir(mx, my, precEfectiva);

        const [flat, flng] = aLatLng(this.kalman.x[0], this.kalman.x[1], this.origen[0], this.origen[1]);

        // Bearing del movimiento: direccion del vector desplazamiento
        // (delta local x=este, y=norte) convertida a grados con 0=N.
        if (this.ultimoPunto) {
            const [lx, ly] = aMetros(this.ultimoPunto[0], this.ultimoPunto[1], this.origen[0], this.origen[1]);
            const dx = this.kalman.x[0] - lx;
            const dy = this.kalman.x[1] - ly;
            const norma = Math.hypot(dx, dy);
            if (norma > 0.3) { // ignora micro-movimientos (ruido parado)
                this.ultimoBearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
            }
        }

        this.ultimoPunto = [flat, flng];
        this.ultimoTiempo = ahora;

        return {
            lat: flat, lng: flng,
            estado: this.estado, confianza: this.confianza,
            esPico: false, precision: prec, bearing: this.ultimoBearing
        };
    };

    // Evalua un resultado de encaje y actualiza la maquina de estados.
    // snapOk: si GraphHopper devolvio una ruta; desviacion: metros de desviacion maxima.
    // Devuelve true SOLO si el encaje es valido Y el estado es 'camino'
    // (es decir, es confiable pegarse a ese sendero).
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

    // Indica si vale la pena intentar encajar (para no gastar cuota de GraphHopper).
    // IMPORTANTE (bug corregido): usamos un contador propio (intentosLibre) en vez
    // de depender de "malas", porque malas se queda quieto estando libre y antes
    // el motor nunca volvia a intentar recuperar el camino. Ahora reintenta
    // cada RECUPERA_LIBRE_CADA tramos procesados.
    Motor.prototype.debeIntentarEncaje = function () {
        if (this.estado === 'libre') {
            this.intentosLibre++;
            return (this.intentosLibre % CFG.RECUPERA_LIBRE_CADA) === 0;
        }
        this.intentosLibre = 0;
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