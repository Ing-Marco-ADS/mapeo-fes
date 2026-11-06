// Pantalla de la brujula y del estado de los sensores.
// - Si el telefono entrega brujula, muestra la aguja hacia el norte real.
// - Si no, lo dice claro y explica que la navegacion seguira funcionando con
//   la direccion de caminata del GPS.
// - Incluye calibracion manual ("apunta al norte y confirma") y un panel de
//   diagnostico con los valores crudos de los sensores.
import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useUbicacionGlobal } from '../hooks/useUbicacion';
import { hablar } from '../lib/voz';
import { cardinalDeRumbo } from '../lib/geo';
import Brujula from '../components/Brujula';
import Icono from '../components/Icono';
import { C, SOMBRA_SUAVE, R } from '../lib/tema';

function n(valor, sufijo = '') {
  return valor == null || valor === '' ? '—' : `${valor}${sufijo}`;
}

function Fila({ etiqueta, valor, ultima = false }) {
  return (
    <View style={[styles.fila, !ultima && styles.filaBorde]}>
      <Text style={styles.filaEtiqueta}>{etiqueta}</Text>
      <Text style={styles.filaValor}>{valor}</Text>
    </View>
  );
}

export default function PantallaBrujula() {
  const {
    ubica,
    rumboSensor,
    rumboReferencia,
    fuenteRumbo,
    permiso,
    error,
    pedirPermisos,
    magnetica,
    necesitaCalibrar,
    calibrado,
    calibrarNorte,
    restablecerCalibracion,
    leerDiagnostico,
  } = useUbicacionGlobal();

  const [confirmarCal, setConfirmarCal] = useState(false);
  const [mostrarDiag, setMostrarDiag] = useState(false);

  // Diagnostico: se lee cada 700 ms sin re-renderizar toda la app.
  // El ref se actualiza dentro de un efecto (no durante el render) para que
  // el intervalo siempre use la version mas reciente de la funcion.
  const leerRef = useRef(leerDiagnostico);
  useEffect(() => {
    leerRef.current = leerDiagnostico;
  });
  const [diag, setDiag] = useState(() => leerDiagnostico());

  useEffect(() => {
    const t = setInterval(() => setDiag(leerRef.current()), 700);
    return () => clearInterval(t);
  }, []);

  // Detecta si venimos de un navegador embebido (WhatsApp, Telegram, etc.).
  let navegadorEmbebido = false;
  if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string') {
    navegadorEmbebido = /WhatsApp|FBAN|FBAV|Instagram|Messenger|Telegram|Viber|Line\//i.test(
      navigator.userAgent
    );
  }

  const grados = rumboSensor != null ? ((rumboSensor % 360) + 360) % 360 : null;
  const hayGps = ubica?.lat != null;
  const cursoGps = ubica?.rumbo != null ? ((ubica.rumbo % 360) + 360) % 360 : null;

  const activarBrujula = async () => {
    await pedirPermisos();
    hablar('Brujula activada. Manten el telefono plano y giralo despacio.');
  };

  const confirmarCalibracion = () => {
    const ok = calibrarNorte();
    setConfirmarCal(false);
    if (ok) hablar('Brujula calibrada. La aguja roja ahora apunta al norte.');
    else hablar('Todavia no hay lectura de la brujula. Espera un momento.');
  };

  return (
    <ScrollView contentContainerStyle={styles.contenedor}>
      <StatusBar style="light" />
      <Text style={styles.titulo} accessibilityRole="header">
        Tu orientación
      </Text>
      <Text style={styles.subtitulo} accessible={true}>
        La aguja roja señala el norte. Mantén el teléfono plano (boca arriba)
        y aléjate de imanes, bocinas y metal.
      </Text>

      {grados != null ? (
        <View style={styles.tarjetaBrujula}>
          <Brujula rumboPantalla={grados} tamaño={260} />

          <Text style={styles.lecturaGrados}>{Math.round(grados)}°</Text>
          <Text style={styles.lectura} accessible={true}>
            Tu pantalla apunta al {cardinalDeRumbo(grados)}
          </Text>
          <View style={styles.chipFila}>
            <View style={styles.chip}>
              <View style={[styles.chipPunto, { backgroundColor: magnetica ? C.azul : C.ambar }]} />
              <Text style={styles.chipTexto}>
                {magnetica ? 'Norte real corregido' : 'Norte magnético'}
              </Text>
            </View>
            {calibrado && (
              <View style={[styles.chip, styles.chipVerde]}>
                <View style={[styles.chipPunto, { backgroundColor: C.verdeOscuro }]} />
                <Text style={[styles.chipTexto, { color: C.verdeOscuro }]}>Calibrada</Text>
              </View>
            )}
          </View>

          {!confirmarCal ? (
            <View style={styles.filaBotones}>
              <Pressable
                style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
                onPress={() => setConfirmarCal(true)}
                accessibilityRole="button"
                accessibilityLabel="Calibrar la brújula al norte"
                accessibilityHint="Marca la dirección actual como el norte real"
              >
                <Icono nombre="brujula" tamaño={19} color={C.blanco} />
                <Text style={styles.botonTexto}>Calibrar al norte</Text>
              </Pressable>
              {calibrado && (
                <Pressable
                  style={({ pressed }) => [styles.botonSecundario, pressed && styles.botonPresionado]}
                  onPress={() => { restablecerCalibracion(); hablar('Calibración borrada.'); }}
                  accessibilityRole="button"
                  accessibilityLabel="Borrar la calibración manual"
                >
                  <Text style={styles.botonSecundarioTexto}>Borrar calibración</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={styles.confirmacion}>
              <View style={styles.confirmacionCabecera}>
                <Icono nombre="alerta" tamaño={18} color={C.ambar} />
                <Text style={styles.confirmacionTitulo}>Apunta al norte real</Text>
              </View>
              <Text style={styles.confirmacionTexto} accessible={true}>
                Apunta la parte de arriba del teléfono hacia el norte real
                (ayúdate de otra brújula o del sol) y confirma.
              </Text>
              <View style={styles.filaBotones}>
                <Pressable
                  style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
                  onPress={confirmarCalibracion}
                  accessibilityRole="button"
                  accessibilityLabel="Confirmar calibración al norte"
                >
                  <Text style={styles.botonTexto}>Sí, apunta al norte</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.botonSecundario, pressed && styles.botonPresionado]}
                  onPress={() => setConfirmarCal(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar calibración"
                >
                  <Text style={styles.botonSecundarioTexto}>Cancelar</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.sinSensor}>
          <View style={styles.sinSensorIcono}>
            <Icono nombre="brujula" tamaño={30} color={C.ambar} />
          </View>
          <Text style={styles.sinSensorTitulo}>Sin lectura de la brújula</Text>
          <Text style={styles.sinSensorTexto} accessible={true}>
            Tu teléfono tiene brújula, pero la app no está recibiendo datos del
            sensor. Puedes seguir navegando: la app usará la dirección en la que
            caminas.
          </Text>
          <Text style={styles.sinSensorTexto} accessible={true}>
            1. Mantén el teléfono plano y haz una figura de ocho (8) en el aire.
            {'\n'}2. Aléjate de imanes, bocinas, fundas con imán y metal.
            {'\n'}3. Vuelve a entrar a esta pantalla.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
            onPress={activarBrujula}
            accessibilityRole="button"
            accessibilityLabel="Activar brújula"
          >
            <Text style={styles.botonTexto}>Activar brújula</Text>
          </Pressable>
        </View>
      )}

      {necesitaCalibrar && (
        <View style={styles.avisoCalibrar}>
          <Icono nombre="alerta" tamaño={16} color={C.ambar} />
          <Text style={styles.avisoCalibrarTexto} accessible={true}>
            El sistema pidió calibrar: haz una figura de ocho (8) en el aire.
          </Text>
        </View>
      )}

      {/* Estado del GPS y dirección de referencia */}
      <View style={styles.tarjeta}>
        <View style={styles.tarjetaCabecera}>
          <View style={styles.tarjetaIcono}>
            <Icono nombre="ubicacionFija" tamaño={18} color={C.azul} />
          </View>
          <Text style={styles.tarjetaTitulo} accessibilityRole="header">
            Dirección de referencia
          </Text>
        </View>

        <View style={styles.datoFila}>
          <Text style={styles.datoEtiqueta}>GPS</Text>
          <Text style={styles.datoValor}>
            {hayGps
              ? `Activo · precisión ±${Math.round(ubica.precision ?? 0)} m`
              : permiso === 'denied'
                ? 'Sin permiso de ubicación'
                : 'Buscando señal…'}
          </Text>
        </View>

        <View style={styles.datoFila}>
          <Text style={styles.datoEtiqueta}>Dirección</Text>
          <Text style={styles.datoValor}>
            {rumboReferencia != null
              ? `${cardinalDeRumbo(rumboReferencia)} (${Math.round(rumboReferencia)}°)`
              : cursoGps != null
                ? `Última caminata: ${cardinalDeRumbo(cursoGps)}`
                : 'Camina unos pasos'}
          </Text>
        </View>

        <View style={[styles.datoFila, styles.datoFilaSinBorde]}>
          <Text style={styles.datoEtiqueta}>Fuente</Text>
          <Text style={styles.datoValor}>
            {rumboReferencia == null
              ? 'Sin rumbo todavía'
              : fuenteRumbo === 'gps'
                ? 'GPS al caminar'
                : 'Brújula'}
          </Text>
        </View>

        {permiso === 'denied' && (
          <Text style={styles.ayudaPermiso}>
            Actívalo en Ajustes › Aplicaciones › Mapeo FES › Permisos.
          </Text>
        )}
      </View>

      {error && (
        <Text style={styles.error} accessible={true}>
          {error}
        </Text>
      )}

      {navegadorEmbebido && (
        <View style={styles.avisoWebView}>
          <Text style={styles.avisoWebViewTitulo}>Estás en el navegador de WhatsApp</Text>
          <Text style={styles.avisoWebViewTexto} accessible={true}>
            WhatsApp apaga los sensores. Toca los 3 puntitos (⋮) y elige
            «Abrir en el navegador» (Chrome).
          </Text>
        </View>
      )}

      {/* Diagnostico */}
      <Pressable
        style={({ pressed }) => [styles.botonDiag, pressed && styles.botonPresionado]}
        onPress={() => setMostrarDiag(v => !v)}
        accessibilityRole="button"
        accessibilityLabel="Mostrar u ocultar el diagnóstico de sensores"
      >
        <Icono nombre="lupa" tamaño={16} color={C.blanco} />
        <Text style={styles.botonDiagTexto}>
          {mostrarDiag ? 'Ocultar diagnóstico' : 'Mostrar diagnóstico'}
        </Text>
      </Pressable>

      {mostrarDiag && (
        <View style={styles.tarjeta}>
          <Text style={styles.tarjetaTitulo}>Diagnóstico (valores crudos)</Text>
          <Fila etiqueta="Plataforma" valor={n(diag.plataforma)} />
          <Fila etiqueta="Permiso" valor={n(diag.permiso)} />
          <Fila etiqueta="GPS" valor={diag.gps.lat != null ? `${diag.gps.lat}, ${diag.gps.lng}` : 'sin datos'} />
          <Fila etiqueta="Precisión GPS" valor={n(diag.gps.precision, ' m')} />
          <Fila etiqueta="Velocidad GPS" valor={n(diag.gps.velocidad, ' m/s')} />
          <Fila etiqueta="Rumbo GPS" valor={n(diag.gps.rumbo, '°')} />
          <Fila etiqueta="Curso estimado" valor={n(diag.curso?.grados, '°')} />
          <Fila etiqueta="Vel. estimada" valor={n(diag.curso?.estimada, ' m/s')} />
          <Fila etiqueta="Sensor movimiento" valor={
            diag.movimiento
              ? `α ${n(diag.movimiento.alpha)}° · β ${n(diag.movimiento.beta)}° · γ ${n(diag.movimiento.gamma)}°`
              : 'sin datos'
          } />
          <Fila etiqueta="Magnetómetro" valor={
            diag.magnetometro
              ? `x ${n(diag.magnetometro.x)} · y ${n(diag.magnetometro.y)} · z ${n(diag.magnetometro.z)}`
              : 'sin datos'
          } />
          <Fila etiqueta="Location heading" valor={
            diag.location
              ? `verdadero ${n(diag.location.verdadero)}° · magnético ${n(diag.location.magnetico)}°`
              : 'sin datos'
          } />
          <Fila etiqueta="Rumbo sensor" valor={n(diag.sensor.grados, '°')} />
          <Fila etiqueta="Edad sensor" valor={diag.sensor.edadMs == null ? '—' : `${diag.sensor.edadMs} ms`} />
          <Fila etiqueta="Referencia" valor={`${n(diag.referencia.grados, '°')} · ${n(diag.referencia.fuente)}`} />
          <Fila etiqueta="Desfase calibración" valor={n(diag.calibracion, '°')} ultima />
          <Text style={styles.notaDiag}>
            Comparte esta pantalla si la brújula sigue fallando: con estos
            valores se puede saber si el sensor responde y qué está midiendo.
          </Text>
        </View>
      )}

      <Text style={styles.pie}>
        {Platform.OS === 'web'
          ? 'En navegadores dentro de WhatsApp/Telegram los sensores están apagados.'
          : 'La navegación por voz prioriza la dirección de caminata del GPS.'}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    backgroundColor: C.fondo,
    padding: 14,
    alignItems: 'center',
    gap: 12,
    paddingBottom: 40,
  },
  titulo: { fontSize: 24, fontWeight: '900', color: C.navy, textAlign: 'center' },
  subtitulo: { fontSize: 14, color: C.textoMedio, textAlign: 'center', lineHeight: 20, maxWidth: 340 },

  tarjetaBrujula: {
    width: '100%',
    backgroundColor: C.tarjeta,
    borderRadius: R.xl,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: C.borde,
    ...SOMBRA_SUAVE,
  },
  lecturaGrados: { fontSize: 34, fontWeight: '900', color: C.navy, lineHeight: 38 },
  lectura: { fontSize: 15, fontWeight: '700', color: C.textoMedio, textAlign: 'center' },
  chipFila: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.azulClaro,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: R.redondo,
  },
  chipVerde: { backgroundColor: C.verdeClaro },
  chipPunto: { width: 7, height: 7, borderRadius: 4 },
  chipTexto: { fontSize: 11, fontWeight: '800', color: C.azul },

  filaBotones: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 },
  boton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.verde,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: R.m,
    minHeight: 50,
  },
  botonSecundario: {
    backgroundColor: C.fondo,
    borderWidth: 1,
    borderColor: C.borde,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: R.m,
    minHeight: 50,
    justifyContent: 'center',
  },
  botonSecundarioTexto: { color: C.textoMedio, fontSize: 14, fontWeight: '700' },
  botonTexto: { color: C.blanco, fontSize: 15, fontWeight: '800' },
  botonPresionado: { opacity: 0.75, transform: [{ scale: 0.985 }] },

  confirmacion: {
    backgroundColor: C.ambarClaro,
    borderRadius: R.l,
    padding: 14,
    gap: 10,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  confirmacionCabecera: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  confirmacionTitulo: { fontSize: 14, fontWeight: '900', color: '#92400E' },
  confirmacionTexto: { fontSize: 13, color: '#78350F', textAlign: 'center', lineHeight: 19 },

  sinSensor: {
    width: '100%',
    backgroundColor: C.tarjeta,
    borderRadius: R.xl,
    padding: 18,
    gap: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.borde,
    ...SOMBRA_SUAVE,
  },
  sinSensorIcono: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: C.ambarClaro,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sinSensorTitulo: { fontSize: 17, fontWeight: '900', color: '#B45309', textAlign: 'center' },
  sinSensorTexto: { fontSize: 13, color: C.textoMedio, textAlign: 'center', lineHeight: 20 },

  avisoCalibrar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.ambarClaro,
    borderRadius: R.m,
    paddingVertical: 10,
    paddingHorizontal: 12,
    width: '100%',
  },
  avisoCalibrarTexto: { flex: 1, fontSize: 13, fontWeight: '700', color: '#92400E', lineHeight: 18 },

  tarjeta: {
    width: '100%',
    backgroundColor: C.tarjeta,
    borderRadius: R.l,
    padding: 14,
    gap: 4,
    borderWidth: 1,
    borderColor: C.borde,
    ...SOMBRA_SUAVE,
  },
  tarjetaCabecera: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  tarjetaIcono: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: C.azulClaro,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tarjetaTitulo: { fontSize: 15, fontWeight: '900', color: C.navy },
  tarjetaTexto: { fontSize: 13, color: C.textoMedio, lineHeight: 19 },

  datoFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.linea,
  },
  datoFilaSinBorde: { borderBottomWidth: 0 },
  datoEtiqueta: { fontSize: 12, fontWeight: '700', color: C.textoSuave },
  datoValor: { flex: 1, fontSize: 13, fontWeight: '700', color: C.texto, textAlign: 'right' },
  ayudaPermiso: { fontSize: 12, color: C.rojo, lineHeight: 17, marginTop: 2 },

  fila: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 6 },
  filaBorde: { borderBottomWidth: 1, borderBottomColor: C.linea },
  filaEtiqueta: { fontSize: 12, color: C.textoSuave, flexShrink: 1 },
  filaValor: { fontSize: 12, color: C.texto, fontWeight: '700', flexShrink: 1, textAlign: 'right' },

  avisoWebView: { backgroundColor: '#7F1D1D', padding: 14, borderRadius: R.m, gap: 6, width: '100%' },
  avisoWebViewTitulo: { color: C.blanco, fontSize: 15, fontWeight: '900', textAlign: 'center' },
  avisoWebViewTexto: { color: '#FECACA', fontSize: 13, lineHeight: 19, textAlign: 'center' },

  botonDiag: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.navy,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: R.m,
    minHeight: 46,
  },
  botonDiagTexto: { color: C.blanco, fontSize: 14, fontWeight: '800' },
  notaDiag: { fontSize: 12, color: C.textoSuave, lineHeight: 17, marginTop: 8 },
  error: { fontSize: 14, color: C.rojo, textAlign: 'center', lineHeight: 20 },
  pie: { fontSize: 12, color: C.textoSuave, textAlign: 'center', marginTop: 4 },
});
