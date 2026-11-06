// Pantalla "Buscar": lista todos los lugares del mapeo, ordenados por distancia
// a tu ubicacion. Los obstaculos (escaleras, rampas, escalones) van al final
// con etiqueta de precaucion. Al tocar un punto, se anuncia por voz.
import { useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, SectionList, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useUbicacionGlobal } from '../hooks/useUbicacion';
import { usePrecauciones } from '../hooks/usePrecauciones';
import { hablar } from '../lib/voz';
import { esPrecaucion, textoPrecaucion } from '../lib/categorias';
import { distanciaMetros, textoDistancia, rumboEntre, textoDireccion } from '../lib/geo';
import { C, SOMBRA_SUAVE, R } from '../lib/tema';
import Icono from '../components/Icono';
import datosMapa from '../datos_mapeo.json';

export default function PantallaBuscar() {
  const { ubica, rumboReferencia, permiso } = useUbicacionGlobal();
  const [puntos] = useState(datosMapa.puntos);

  // Vigilar obstaculos tambien desde aqui
  const obstaculos = useMemo(() => puntos.filter(esPrecaucion), [puntos]);
  usePrecauciones({ ubica, puntos: obstaculos, activo: true });

  // Orden: lugares primero (por distancia) y luego obstaculos
  const ordenados = useMemo(() => {
    const lugares = puntos.filter(p => !esPrecaucion(p));
    const riesgos = puntos.filter(esPrecaucion);
    const porDistancia = (lista) => {
      if (!ubica) return lista;
      return [...lista].sort(
        (a, b) =>
          distanciaMetros(ubica.lat, ubica.lng, a.lat, a.lng) -
          distanciaMetros(ubica.lat, ubica.lng, b.lat, b.lng)
      );
    };
    return { lugares: porDistancia(lugares), riesgos: porDistancia(riesgos) };
  }, [puntos, ubica]);

  const secciones = useMemo(() => [
    { titulo: 'Lugares', data: ordenados.lugares },
    { titulo: 'Precauciones', data: ordenados.riesgos },
  ].filter(s => s.data.length > 0), [ordenados]);

  const renderPunto = useCallback(
    (p) => {
      const conGps = Boolean(ubica);
      const d = conGps ? distanciaMetros(ubica.lat, ubica.lng, p.lat, p.lng) : null;
      const rumboObjetivo = conGps ? rumboEntre(ubica.lat, ubica.lng, p.lat, p.lng) : null;
      const esRiesgo = esPrecaucion(p);
      const color = p.color || C.azul;
      const mencion = conGps ? textoDistancia(d) : 'GPS pendiente';

      const alHablar = () => {
        if (esRiesgo) {
          hablar(textoPrecaucion(p, conGps ? textoDistancia(d) : 'a la distancia indicada'));
        } else if (conGps) {
          const direccion = textoDireccion(rumboReferencia, rumboObjetivo);
          hablar(`${p.nombre}. ${textoDistancia(d)}${direccion}.`);
        } else {
          hablar(`${p.nombre}. GPS pendiente: espera tu ubicación para medir la distancia.`);
        }
      };

      return (
        <Pressable
          style={({ pressed }) => [
            styles.item,
            esRiesgo && styles.itemRiesgo,
            pressed && styles.itemPresionado,
          ]}
          onPress={alHablar}
          accessibilityRole="button"
          accessibilityLabel={esRiesgo
            ? `${p.nombre}, precaución, ${mencion}`
            : `${p.nombre}, ${p.tipoNombre}, ${mencion}`}
          accessibilityHint="Toca para escuchar la información por voz"
        >
          <View
            style={[
              styles.avatar,
              { backgroundColor: esRiesgo ? C.ambarClaro : color + '22' },
            ]}
          >
            {esRiesgo
              ? <Icono nombre="alerta" tamaño={18} color={C.ambar} />
              : <View style={[styles.punto, { backgroundColor: color }]} />}
          </View>

          <View style={styles.textos}>
            <Text style={styles.nombre} numberOfLines={1}>{p.nombre}</Text>
            <Text style={styles.tipo} numberOfLines={1}>
              {esRiesgo ? 'Precaución: ten cuidado al pasar' : p.tipoNombre}
            </Text>
          </View>

          <View style={[styles.pill, esRiesgo && styles.pillRiesgo]}>
            <Text style={[styles.pillTexto, esRiesgo && styles.pillTextoRiesgo]}>
              {conGps ? `${Math.round(d)} m` : '—'}
            </Text>
          </View>

          <Icono nombre="chevron" tamaño={15} color={C.textoSuave} />
        </Pressable>
      );
    },
    [ubica, rumboReferencia]
  );

  const totalLugares = ordenados.lugares.length;
  const totalRiesgos = ordenados.riesgos.length;

  return (
    <View style={styles.contenedor}>
      <StatusBar style="light" />
      <View style={styles.cabecera}>
        <View style={styles.cabeceraTituloFila}>
          <View style={styles.cabeceraIcono}>
            <Icono nombre="lupa" tamaño={19} color={C.azul} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cabeceraTitulo}>Cerca de ti</Text>
            <Text style={styles.cabeceraSub}>
              {totalLugares} lugares · {totalRiesgos} precauciones
            </Text>
          </View>
          <View style={[styles.estadoChip, ubica ? styles.estadoChipOk : styles.estadoChipEspera]}>
            <View style={[styles.estadoPunto, { backgroundColor: ubica ? C.verdeOscuro : C.ambar }]} />
            <Text style={[styles.estadoTexto, { color: ubica ? C.verdeOscuro : C.ambar }]}>
              {ubica ? 'GPS activo' : permiso === 'denied' ? 'Sin permiso' : 'Sin GPS'}
            </Text>
          </View>
        </View>
        <Text style={styles.cabeceraAyuda} accessible={true}>
          {ubica
            ? 'Los lugares más cercanos aparecen primero. Toca uno para escucharlo.'
            : 'Esperando GPS para medir distancias. Mientras tanto puedes tocar cualquier punto.'}
        </Text>
      </View>

      <SectionList
        sections={secciones}
        keyExtractor={p => String(p.id)}
        renderItem={({ item }) => renderPunto(item)}
        initialNumToRender={15}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.lista}
        renderSectionHeader={({ section }) => (
          <View style={styles.seccionCabecera}>
            <Text style={styles.seccionTitulo}>
              {section.titulo.toUpperCase()}
            </Text>
            <View style={styles.seccionContador}>
              <Text style={styles.seccionContadorTexto}>{section.data.length}</Text>
            </View>
          </View>
        )}
        ListFooterComponent={
          <Text style={styles.pie}>
            Escaleras, rampas y escalones se avisan por voz cuando te acercas.
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: C.fondo },
  cabecera: {
    backgroundColor: C.tarjeta,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.borde,
  },
  cabeceraTituloFila: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cabeceraIcono: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.azulClaro,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cabeceraTitulo: { fontSize: 18, fontWeight: '900', color: C.navy },
  cabeceraSub: { fontSize: 12, color: C.textoSuave, marginTop: 1 },
  cabeceraAyuda: { fontSize: 13, color: C.textoMedio, lineHeight: 19, marginTop: 10 },
  estadoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: R.redondo,
  },
  estadoChipOk: { backgroundColor: C.verdeClaro },
  estadoChipEspera: { backgroundColor: C.ambarClaro },
  estadoPunto: { width: 6, height: 6, borderRadius: 3 },
  estadoTexto: { fontSize: 10, fontWeight: '800' },

  lista: { paddingHorizontal: 12, paddingBottom: 32 },
  seccionCabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 16,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  seccionTitulo: { fontSize: 12, fontWeight: '900', color: C.textoSuave, letterSpacing: 0.8 },
  seccionContador: {
    backgroundColor: C.borde,
    borderRadius: R.redondo,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  seccionContadorTexto: { fontSize: 10, fontWeight: '800', color: C.textoMedio },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.tarjeta,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: R.m,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: C.borde,
    ...SOMBRA_SUAVE,
  },
  itemRiesgo: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  itemPresionado: { backgroundColor: C.azulClaro, transform: [{ scale: 0.99 }] },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  punto: { width: 14, height: 14, borderRadius: 7 },
  textos: { flex: 1 },
  nombre: { fontSize: 16, fontWeight: '800', color: C.texto },
  tipo: { fontSize: 12, color: C.textoSuave, marginTop: 2 },
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderRadius: R.redondo,
    backgroundColor: C.fondo,
    minWidth: 52,
    alignItems: 'center',
  },
  pillRiesgo: { backgroundColor: '#FEF3C7' },
  pillTexto: { fontSize: 12, fontWeight: '900', color: C.navy },
  pillTextoRiesgo: { color: '#92400E' },

  pie: {
    fontSize: 12,
    color: C.textoSuave,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 16,
    paddingHorizontal: 20,
  },
});
