// Pantalla "Buscar": lista todos los lugares del mapeo, ordenados por distancia
// a tu ubicacion. Los obstaculos (escaleras, rampas, escalones) van al final
// con etiqueta de precaucion. Al tocar un punto, se anuncia por voz.
import { useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { useUbicacionGlobal } from '../hooks/useUbicacion';
import { usePrecauciones } from '../hooks/usePrecauciones';
import { hablar } from '../lib/voz';
import { esPrecaucion, textoPrecaucion } from '../lib/categorias';
import { distanciaMetros, textoDistancia, rumboEntre, textoRelativo } from '../lib/geo';
import datosMapa from '../datos_mapeo.json';

export default function PantallaBuscar() {
  const { ubica } = useUbicacionGlobal();
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

  const renderPunto = useCallback(
    p => {
      const conGps = Boolean(ubica);
      const d = conGps ? distanciaMetros(ubica.lat, ubica.lng, p.lat, p.lng) : null;
      const rumboObjetivo = conGps ? rumboEntre(ubica.lat, ubica.lng, p.lat, p.lng) : null;
      const esRiesgo = esPrecaucion(p);
      const mencion = conGps
        ? textoDistancia(d)
        : 'GPS pendiente';

      const alHablar = () => {
        if (esRiesgo) {
          hablar(textoPrecaucion(p, conGps ? textoDistancia(d) : 'a la distancia indicada'));
        } else if (conGps) {
          const relativo = ubica.rumbo != null ? textoRelativo(ubica.rumbo, rumboObjetivo) : '';
          hablar(`${p.nombre}. ${textoDistancia(d)}${relativo}.`);
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
          <View style={[styles.balonColor, { backgroundColor: p.color || '#78909c' }]} />
          <View style={styles.textos}>
            <Text style={styles.nombre}>{p.nombre}</Text>
            <Text style={styles.tipo}>
              {esRiesgo ? `Precaución · ${mencion}` : `${p.tipoNombre} · ${mencion}`}
            </Text>
          </View>
        </Pressable>
      );
    },
    [ubica]
  );

  return (
    <View style={styles.contenedor}>
      <View style={styles.aviso}>
        <Text style={styles.avisoTexto} accessible={true}>
          {ubica
            ? `Hay ${puntos.length} puntos. Los lugares más cercanos aparecen primero; los escalones, escaleras y rampas van al final como precaución. Toca uno para escucharlo.`
            : `Hay ${puntos.length} puntos. Esperando GPS para medir distancias...`}
        </Text>
      </View>
      <FlatList
        data={[...ordenados.lugares, ...ordenados.riesgos]}
        keyExtractor={p => String(p.id)}
        renderItem={({ item }) => renderPunto(item)}
        initialNumToRender={15}
        contentContainerStyle={styles.lista}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: '#f0f2f5' },
  aviso: {
    padding: 12,
    backgroundColor: '#1F4E79',
  },
  avisoTexto: { color: '#fff', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  lista: { padding: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginVertical: 4,
    gap: 12,
  },
  itemRiesgo: {
    backgroundColor: '#fff7ed',
    borderColor: '#f59e0b',
    borderWidth: 1,
  },
  itemPresionado: { backgroundColor: '#e5edf5' },
  balonColor: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#fff',
  },
  textos: { flex: 1 },
  nombre: { fontSize: 16, fontWeight: '700', color: '#111827' },
  tipo: { fontSize: 13, color: '#6b7280', marginTop: 2 },
});