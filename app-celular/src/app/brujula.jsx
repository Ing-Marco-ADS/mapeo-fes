// Pantalla de la brujula y del estado de los sensores.
// - Si el telefono entrega brujula, muestra la aguja hacia el norte real.
// - Si no, lo dice claro y explica que la navegacion seguira funcionando con
//   la direccion de caminata del GPS.
// - Incluye calibracion manual ("apunta al norte y confirma") y un panel de
//   diagnostico con los valores crudos de los sensores.
import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform } from 'react-native';
import { useUbicacionGlobal } from '../hooks/useUbicacion';
import { hablar } from '../lib/voz';
import { cardinalDeRumbo } from '../lib/geo';
import Brujula from '../components/Brujula';

function n(valor, sufijo = '') {
  return valor == null || valor === '' ? '—' : `${valor}${sufijo}`;
}

function Fila({ etiqueta, valor }) {
  return (
    <View style={styles.fila}>
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
      <Text style={styles.titulo} accessibilityRole="header">
        Brújula
      </Text>
      <Text style={styles.subtitulo} accessible={true}>
        La aguja roja señala el norte. Mantén el teléfono plano (boca arriba)
        y aléjate de imanes, bocinas y metal.
      </Text>

      {grados != null ? (
        <>
          <Brujula rumboPantalla={grados} tamaño={260} />

          <Text style={styles.lectura} accessible={true}>
            Tu pantalla apunta al {cardinalDeRumbo(grados)} ({Math.round(grados)}°)
          </Text>
          <Text style={styles.detalle} accessible={true}>
            {magnetica
              ? 'Lectura del sensor magnético, corregida al norte real.'
              : 'Lectura del sensor (norte magnético).'}
            {calibrado ? ' Calibración manual activa.' : ''}
          </Text>

          {!confirmarCal ? (
            <View style={styles.filaBotones}>
              <Pressable
                style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
                onPress={() => setConfirmarCal(true)}
                accessibilityRole="button"
                accessibilityLabel="Calibrar la brújula al norte"
              >
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
        </>
      ) : (
        <View style={styles.sinSensor}>
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
        <Text style={styles.avisoCalibrar} accessible={true}>
          El sistema pidió calibrar: haz una figura de ocho (8) en el aire.
        </Text>
      )}

      {/* Estado del GPS y dirección de referencia */}
      <View style={styles.tarjeta}>
        <Text style={styles.tarjetaTitulo} accessibilityRole="header">
          Dirección de referencia
        </Text>
        <Text style={styles.tarjetaTexto} accessible={true}>
          {hayGps
            ? `GPS activo · precisión ±${Math.round(ubica.precision ?? 0)} m`
            : permiso === 'denied'
              ? 'Sin permiso de ubicación. Actívalo en Ajustes > Aplicaciones > Mapeo FES > Permisos.'
              : 'Buscando señal GPS…'}
        </Text>
        <Text style={styles.tarjetaTexto} accessible={true}>
          {rumboReferencia != null
            ? `Vas hacia el ${cardinalDeRumbo(rumboReferencia)} (${Math.round(rumboReferencia)}°) · fuente: ${fuenteRumbo === 'gps' ? 'GPS al caminar' : 'brújula'}`
            : cursoGps != null
              ? `Última dirección de caminata: ${cardinalDeRumbo(cursoGps)} (${Math.round(cursoGps)}°)`
              : 'Camina unos pasos y la app detectará tu dirección.'}
        </Text>
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
          <Fila etiqueta="Desfase calibración" valor={n(diag.calibracion, '°')} />
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
    backgroundColor: '#f0f2f5',
    padding: 16,
    alignItems: 'center',
    gap: 12,
    paddingBottom: 40,
  },
  titulo: { fontSize: 22, fontWeight: '800', color: '#1F4E79', textAlign: 'center' },
  subtitulo: { fontSize: 15, color: '#374151', textAlign: 'center', lineHeight: 21 },
  lectura: { fontSize: 20, fontWeight: '700', color: '#111827', textAlign: 'center' },
  detalle: { fontSize: 14, color: '#4b5563', textAlign: 'center' },
  filaBotones: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  boton: {
    backgroundColor: '#15803d',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  botonSecundario: {
    backgroundColor: '#e5e7eb',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  botonSecundarioTexto: { color: '#374151', fontSize: 15, fontWeight: '700' },
  botonTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
  botonPresionado: { opacity: 0.75 },
  confirmacion: {
    backgroundColor: '#fef3c7',
    borderRadius: 12,
    padding: 14,
    gap: 10,
    alignItems: 'center',
  },
  confirmacionTexto: { fontSize: 14, color: '#78350f', textAlign: 'center', lineHeight: 20 },
  sinSensor: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  sinSensorTitulo: { fontSize: 17, fontWeight: '800', color: '#b45309', textAlign: 'center' },
  sinSensorTexto: { fontSize: 14, color: '#374151', textAlign: 'center', lineHeight: 21 },
  tarjeta: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  tarjetaTitulo: { fontSize: 15, fontWeight: '800', color: '#1F4E79', marginBottom: 2 },
  tarjetaTexto: { fontSize: 14, color: '#374151', lineHeight: 20 },
  fila: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  filaEtiqueta: { fontSize: 12, color: '#64748b', flexShrink: 1 },
  filaValor: { fontSize: 12, color: '#0f172a', fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  avisoCalibrar: { fontSize: 14, fontWeight: '700', color: '#92400e', textAlign: 'center', lineHeight: 20 },
  avisoWebView: { backgroundColor: '#7f1d1d', padding: 14, borderRadius: 12, gap: 6, width: '100%' },
  avisoWebViewTitulo: { color: '#fff', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  avisoWebViewTexto: { color: '#fecaca', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  botonDiag: {
    backgroundColor: '#1F4E79',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  botonDiagTexto: { color: '#fff', fontSize: 14, fontWeight: '700' },
  notaDiag: { fontSize: 12, color: '#64748b', lineHeight: 17, marginTop: 6 },
  error: { fontSize: 14, color: '#b91c1c', textAlign: 'center', lineHeight: 20 },
  pie: { fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 4 },
});
